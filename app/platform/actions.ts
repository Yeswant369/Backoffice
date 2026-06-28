"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformAdmin } from "@/lib/platform";
import { ROLES } from "@/lib/roles";
import { siteUrl } from "@/lib/site";

export interface TenantState {
  error?: string;
  success?: string;
  /** Shareable set-password link returned on creation (no email needed). */
  link?: string;
}

const DEFAULT_DEPARTMENTS = ["Store", "Kitchen", "Bar", "Bakery"];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Provision a brand-new customer tenant with ZERO manual SQL:
 *   organization → first outlet → default departments → owner account.
 *
 * The first user is granted Admin + Owner so they can operate their outlet AND
 * self-manage their org (invite staff, etc.) — no vendor SQL ever needed. Runs
 * entirely on the service role; on any failure the partial tenant is rolled
 * back (org delete cascades to outlet/departments; the auth user is removed).
 */
export async function createTenant(
  _prev: TenantState | undefined,
  formData: FormData,
): Promise<TenantState> {
  if (!(await isPlatformAdmin())) {
    return { error: "Not authorized." };
  }

  const orgName = String(formData.get("org_name") ?? "").trim();
  const outletName = String(formData.get("outlet_name") ?? "").trim();
  const ownerName = String(formData.get("owner_name") ?? "").trim();
  const ownerEmail = String(formData.get("owner_email") ?? "")
    .trim()
    .toLowerCase();

  if (!orgName || !outletName || !ownerName || !ownerEmail) {
    return { error: "Restaurant, outlet, owner name and owner email are all required." };
  }
  if (!EMAIL_RE.test(ownerEmail)) {
    return { error: "Enter a valid owner email." };
  }

  const admin = createAdminClient();

  // 1. Organization (the tenant root).
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: orgName })
    .select("id")
    .single();
  if (orgErr || !org) {
    return { error: orgErr?.message ?? "Could not create the organization." };
  }
  const orgId = org.id as string;

  // Only ever clean up an auth user WE created — never a pre-existing account.
  let createdUserId: string | null = null;
  let inviteLink: string | null = null;

  try {
    // 2. First outlet.
    const { data: loc, error: locErr } = await admin
      .from("locations")
      .insert({ organization_id: orgId, name: outletName })
      .select("id")
      .single();
    if (locErr || !loc) {
      throw new Error(locErr?.message ?? "Could not create the outlet.");
    }
    const locId = loc.id as string;

    // 3. Default departments (IDENTITY assigns ids; explicit location_id is
    //    required — departments has no auto-stamp trigger).
    const { error: deptErr } = await admin
      .from("departments")
      .insert(DEFAULT_DEPARTMENTS.map((name) => ({ name, location_id: locId })));
    if (deptErr) throw new Error(deptErr.message);

    // 4. Owner account — created directly, with NO email (decoupled from the
    //    email provider / its rate limits). Email is pre-confirmed (operator-
    //    vouched); the owner sets a password via the link returned below.
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email: ownerEmail,
      email_confirm: true,
      user_metadata: { full_name: ownerName, location_id: locId },
    });
    if (cErr || !created?.user) {
      throw new Error(cErr?.message ?? "Could not create the owner account.");
    }
    createdUserId = created.user.id;

    // 5. Authoritative owner profile (Admin + Owner). Source of truth for roles
    //    (bypasses the signup clamp; corrects the trigger's clamped Store row).
    const { error: pErr } = await admin.from("profiles").upsert({
      id: created.user.id,
      full_name: ownerName,
      roles: [ROLES.ADMIN, ROLES.OWNER],
      location_id: locId,
    });
    if (pErr) throw new Error(pErr.message);

    // 6. Shareable set-password link (no email send) — Copy / WhatsApp it.
    const { data: linkData } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: ownerEmail,
      options: { redirectTo: `${siteUrl()}/auth/set-password` },
    });
    inviteLink = linkData?.properties?.action_link ?? null;
  } catch (e) {
    // Any failure (returned error OR thrown) rolls back the partial tenant.
    if (createdUserId) {
      await admin.auth.admin.deleteUser(createdUserId).catch(() => {});
    }
    await admin.from("organizations").delete().eq("id", orgId).then(
      () => {},
      () => {},
    );
    return {
      error: e instanceof Error ? e.message : "Could not create the tenant.",
    };
  }

  revalidatePath("/platform");
  return {
    success: `Created "${orgName}" with outlet "${outletName}". Share the set-password link below with ${ownerEmail}.`,
    link: inviteLink ?? undefined,
  };
}

export interface OutletState {
  error?: string;
  success?: string;
}

/**
 * Add an outlet to an EXISTING tenant. Operator-only by design: an outlet is the
 * billable unit (pricing is tiered per location), so owners must not self-serve
 * outlet creation — that would be a revenue leak. The org's Owner automatically
 * sees the new outlet (role 6 = whole org); staffing it is done by the owner via
 * the Phase 2c staff-assignment UI.
 */
export async function addOutlet(
  _prev: OutletState | undefined,
  formData: FormData,
): Promise<OutletState> {
  if (!(await isPlatformAdmin())) {
    return { error: "Not authorized." };
  }

  const orgId = String(formData.get("org_id") ?? "").trim();
  const outletName = String(formData.get("outlet_name") ?? "").trim();
  if (!orgId || !outletName) {
    return { error: "Select a tenant and enter an outlet name." };
  }

  const admin = createAdminClient();

  // Re-validate the tenant exists (the action is directly invocable).
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .maybeSingle();
  if (orgErr) return { error: orgErr.message };
  if (!org) return { error: "That tenant no longer exists." };

  // Create the outlet, then seed its departments (roll the outlet back on failure;
  // deleting the location cascades any departments).
  const { data: loc, error: locErr } = await admin
    .from("locations")
    .insert({ organization_id: orgId, name: outletName })
    .select("id")
    .single();
  if (locErr || !loc) {
    return { error: locErr?.message ?? "Could not create the outlet." };
  }
  const locId = loc.id as string;

  const { error: deptErr } = await admin
    .from("departments")
    .insert(DEFAULT_DEPARTMENTS.map((name) => ({ name, location_id: locId })));
  if (deptErr) {
    await admin.from("locations").delete().eq("id", locId).then(
      () => {},
      () => {},
    );
    return { error: deptErr.message };
  }

  revalidatePath("/platform");
  return {
    success: `Added outlet "${outletName}" to ${org.name as string}.`,
  };
}

/**
 * Re-send the set-password invite to a tenant owner whose invite expired or was
 * never accepted. Operator-only. inviteUserByEmail issues a fresh, single-use
 * link; it errors if the account is already active.
 */
export async function resendInvite(
  _prev: TenantState | undefined,
  formData: FormData,
): Promise<TenantState> {
  if (!(await isPlatformAdmin())) {
    return { error: "Not authorized." };
  }
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email) return { error: "Missing email." };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl()}/auth/set-password`,
  });
  if (error) {
    return { error: error.message };
  }

  revalidatePath("/platform");
  return { success: `Fresh invite sent to ${email}.` };
}

export interface LinkState {
  error?: string;
  link?: string;
}

/**
 * Generate a set-password link WITHOUT sending an email (bypasses the email
 * provider entirely — share it over WhatsApp/SMS, or as an email fallback).
 * Uses a recovery link, which works for an already-created owner and lands them
 * on /auth/set-password. The link is single-use and time-limited.
 */
export async function generateInviteLink(
  _prev: LinkState | undefined,
  formData: FormData,
): Promise<LinkState> {
  if (!(await isPlatformAdmin())) {
    return { error: "Not authorized." };
  }
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email) return { error: "Missing email." };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${siteUrl()}/auth/set-password` },
  });
  if (error) return { error: error.message };

  const link = data.properties?.action_link;
  if (!link) return { error: "Could not generate a link." };
  return { link };
}

/**
 * Offboard a customer: delete the organization (cascades its outlets,
 * departments and operational rows) plus every member's auth account.
 * Operator-only and destructive. A tenant with ledger history is protected by
 * the append-only trigger — the cascade fails and we report it clearly rather
 * than wiping an audit trail.
 */
export async function deleteTenant(
  _prev: TenantState | undefined,
  formData: FormData,
): Promise<TenantState> {
  if (!(await isPlatformAdmin())) {
    return { error: "Not authorized." };
  }
  const orgId = String(formData.get("org_id") ?? "").trim();
  if (!orgId) return { error: "Missing tenant." };

  const admin = createAdminClient();

  // Capture member auth-user ids BEFORE the org delete cascades their profiles.
  const { data: locs } = await admin
    .from("locations")
    .select("id")
    .eq("organization_id", orgId);
  const locIds = (locs ?? []).map((l) => l.id as string);

  let memberIds: string[] = [];
  if (locIds.length > 0) {
    const { data: members } = await admin
      .from("profiles")
      .select("id")
      .in("location_id", locIds);
    memberIds = (members ?? []).map((m) => m.id as string);
  }

  const { error: delErr } = await admin
    .from("organizations")
    .delete()
    .eq("id", orgId);
  if (delErr) {
    const msg = /append-only/i.test(delErr.message)
      ? "This tenant has transaction history (the ledger is append-only) and can't be deleted from the console."
      : delErr.message;
    return { error: `Couldn't delete tenant: ${msg}` };
  }

  // Org delete cascaded the profiles; now remove the orphaned auth accounts.
  for (const id of memberIds) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }

  revalidatePath("/platform");
  return { success: "Tenant deleted." };
}
