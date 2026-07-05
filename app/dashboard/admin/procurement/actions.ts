"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserAndRoles, isAdmin } from "@/lib/auth";

export interface ActionState {
  error?: string;
  success?: string;
  token?: string;
}

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const orNull = (v: string) => (v === "" ? null : v);

async function locationId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  // Home location via rpc — RLS read-scope spans the org for hybrid Admin+Owner
  // users, so an unfiltered .maybeSingle() would error (multi-row).
  const { data } = await supabase.rpc("current_location_id");
  return (data as string | null) ?? null;
}

/** Create a vendor (tenant-scoped). UI triggers the sheet sync on success. */
export async function createVendor(
  _prev: ActionState | undefined,
  fd: FormData,
): Promise<ActionState> {
  if (!(await isAdmin())) return { error: "Only administrators can add vendors." };

  const vendor_code = str(fd, "vendor_code");
  const name = str(fd, "name");
  if (!vendor_code) return { error: "Vendor code is required." };
  if (!name) return { error: "Name is required." };

  const supabase = await createClient();
  const loc = await locationId(supabase);
  if (!loc) return { error: "Your account isn't assigned to a location." };

  const { error } = await supabase.from("vendors").insert({
    vendor_code,
    name,
    nature_of_supply: orNull(str(fd, "nature_of_supply")),
    contact_person: orNull(str(fd, "contact_person")),
    phone: orNull(str(fd, "phone")),
    alt_phone: orNull(str(fd, "alt_phone")),
    email: orNull(str(fd, "email")),
    category: orNull(str(fd, "category")),
    bank_name: orNull(str(fd, "bank_name")),
    account_number: orNull(str(fd, "account_number")),
    ifsc_code: orNull(str(fd, "ifsc_code")),
    upi_id: orNull(str(fd, "upi_id")),
    payment_terms: orNull(str(fd, "payment_terms")),
    address: orNull(str(fd, "address")),
    gstin: orNull(str(fd, "gstin")),
    notes: orNull(str(fd, "notes")),
    dormancy_note: orNull(str(fd, "dormancy_note")),
    status: str(fd, "status") || "ACTIVE",
    location_id: loc,
  });

  if (error) {
    return {
      error:
        error.code === "23505"
          ? `Vendor code "${vendor_code}" already exists.`
          : error.message,
    };
  }

  revalidatePath("/dashboard/admin/procurement/vendors");
  return { success: `Vendor "${name}" created.`, token: crypto.randomUUID() };
}

/**
 * Log a purchase → immutable inventory_ledger row (type PURCHASE), credited to
 * the Store department. UI triggers the sheet sync on success.
 */
export async function logPurchase(
  _prev: ActionState | undefined,
  fd: FormData,
): Promise<ActionState> {
  const { user, roles } = await getCurrentUserAndRoles();
  if (!user || !(roles.includes(1) || roles.includes(2) || roles.includes(3))) {
    return { error: "You are not authorized to log purchases." };
  }

  const raw_material_id = str(fd, "raw_material_id");
  const vendor_id = str(fd, "vendor_id");
  const quantity = Number(fd.get("quantity") ?? 0);
  const unit_price = Number(fd.get("unit_price") ?? 0);
  // Invoice date chosen by the manager (may be days in the past). Validated to
  // the YYYY-MM-DD shape; the sheet "Date" column is driven by this value.
  const purchase_date = str(fd, "purchase_date");
  const transaction_date = /^\d{4}-\d{2}-\d{2}$/.test(purchase_date)
    ? purchase_date
    : null;

  if (!raw_material_id) return { error: "Select a raw material." };
  if (!vendor_id) return { error: "Select a vendor." };
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity >= 1e10) {
    return { error: "Quantity must be a number greater than zero." };
  }
  if (!Number.isFinite(unit_price) || unit_price < 0 || unit_price >= 1e10) {
    return { error: "Unit price must be a valid non-negative number." };
  }
  if (!transaction_date) return { error: "Select a valid invoice date." };
  const todayISTSingle = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  if (transaction_date > todayISTSingle) return { error: "Invoice date cannot be in the future." };
  if (transaction_date < "2000-01-01") return { error: "Invoice date looks wrong." };

  const supabase = await createClient();
  const loc = await locationId(supabase);
  if (!loc) return { error: "Your account isn't assigned to a location." };

  // Enforce "approved vendors only" server-side (the dropdown filter is not a
  // control). Also pins the vendor to this location.
  const { data: vend } = await supabase
    .from("vendors")
    .select("id, approved")
    .eq("id", vendor_id)
    .eq("location_id", loc)
    .maybeSingle();
  if (!vend) return { error: "Vendor not found in your location." };
  if (!(vend as { approved: boolean }).approved) {
    return { error: "This vendor isn't approved yet — approve it in the Vendor Hub first." };
  }

  // Pin the material to this location too — a crafted/stale id must never
  // write a cross-outlet ledger row.
  const { data: mat } = await supabase
    .from("raw_materials")
    .select("id")
    .eq("id", raw_material_id)
    .eq("location_id", loc)
    .maybeSingle();
  if (!mat) return { error: "Raw material not found in your location." };

  // Store department for THIS location (pin — RLS spans the org for hybrids).
  const { data: store } = await supabase
    .from("departments")
    .select("id")
    .eq("location_id", loc)
    .ilike("name", "store")
    .maybeSingle();

  const { error } = await supabase.from("inventory_ledger").insert({
    raw_material_id,
    vendor_id,
    from_department_id: null,
    to_department_id: store?.id ?? null,
    type: "PURCHASE",
    quantity,
    unit_price,
    transaction_date,
    location_id: loc,
    created_by: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin/procurement/purchase-log");
  return { success: "Purchase logged to the ledger.", token: crypto.randomUUID() };
}

interface BillLine {
  raw_material_id: string;
  quantity: number;
  unit_price: number;
}

/**
 * Log a multi-line purchase BILL: one vendor, one invoice number, optional bill
 * and delivered-goods photos, many material lines — one purchase_bills row plus
 * one immutable PURCHASE ledger row per line (all linked via bill_id).
 */
export async function logPurchaseBill(
  _prev: ActionState | undefined,
  fd: FormData,
): Promise<ActionState> {
  const { user, roles } = await getCurrentUserAndRoles();
  if (!user || !(roles.includes(1) || roles.includes(2) || roles.includes(3))) {
    return { error: "You are not authorized to log purchases." };
  }

  const vendor_id = str(fd, "vendor_id");
  const invoice_no = orNull(str(fd, "invoice_no"));
  const purchase_date = str(fd, "purchase_date");
  const transaction_date = /^\d{4}-\d{2}-\d{2}$/.test(purchase_date)
    ? purchase_date
    : null;
  if (!vendor_id) return { error: "Select a vendor." };
  if (!transaction_date) return { error: "Select a valid bill date." };
  // Business-date sanity: no future bills, no ancient typos (client max= is not
  // a control). IST calendar day.
  const todayIST = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  if (transaction_date > todayIST) return { error: "Bill date cannot be in the future." };
  if (transaction_date < "2000-01-01") return { error: "Bill date looks wrong." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(str(fd, "lines"));
  } catch {
    return { error: "Invalid line items." };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { error: "Add at least one line item." };
  }
  if (parsed.length > 100) return { error: "Too many lines on one bill." };
  // Coerce + validate every element — JSON can smuggle null/strings/1e999,
  // which Number() would pass through the old >0/<0 checks as Infinity/NaN and
  // then serialize to NULL in the insert (silently corrupting spend).
  const MAX = 1e10; // numeric(14,4) ceiling
  const lines: BillLine[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") return { error: "Invalid line items." };
    const l = raw as Record<string, unknown>;
    const raw_material_id = typeof l.raw_material_id === "string" ? l.raw_material_id : "";
    const quantity = Number(l.quantity);
    const unit_price = Number(l.unit_price);
    if (!raw_material_id) return { error: "Every line needs a material." };
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity >= MAX) {
      return { error: "Every quantity must be a number greater than zero." };
    }
    if (!Number.isFinite(unit_price) || unit_price < 0 || unit_price >= MAX) {
      return { error: "Unit prices must be valid non-negative numbers." };
    }
    lines.push({ raw_material_id, quantity, unit_price });
  }

  const supabase = await createClient();
  const loc = await locationId(supabase);
  if (!loc) return { error: "Your account isn't assigned to a location." };

  // Photos were uploaded straight to storage by the browser; only accept paths
  // inside THIS outlet's folder (matches the storage RLS, defense-in-depth).
  // An invalid non-empty path is an ERROR — silently dropping it would save the
  // bill while the user believes the photo evidence was attached.
  const photoPath = (key: string): { ok: true; path: string | null } | { ok: false } => {
    const p = str(fd, key);
    if (!p) return { ok: true, path: null };
    return p.startsWith(`${loc}/`) && !p.includes("..")
      ? { ok: true, path: p }
      : { ok: false };
  };
  const billPhoto = photoPath("bill_photo_path");
  const deliveryPhoto = photoPath("delivery_photo_path");
  if (!billPhoto.ok || !deliveryPhoto.ok) {
    return { error: "Invalid photo reference — retake the photo and try again." };
  }

  // Vendor: home + approved (dropdown filtering is not a control).
  const { data: vend } = await supabase
    .from("vendors")
    .select("id, approved")
    .eq("id", vendor_id)
    .eq("location_id", loc)
    .maybeSingle();
  if (!vend) return { error: "Vendor not found in your location." };
  if (!(vend as { approved: boolean }).approved) {
    return { error: "This vendor isn't approved yet — approve it in the Vendor Hub first." };
  }

  // Every material must belong to this outlet.
  const ids = [...new Set(lines.map((l) => l.raw_material_id))];
  const { data: mats } = await supabase
    .from("raw_materials")
    .select("id")
    .in("id", ids)
    .eq("location_id", loc);
  if ((mats ?? []).length !== ids.length) {
    return { error: "One or more materials weren't found in your location." };
  }

  const { data: store } = await supabase
    .from("departments")
    .select("id")
    .eq("location_id", loc)
    .ilike("name", "store")
    .maybeSingle();

  const { data: bill, error: billErr } = await supabase
    .from("purchase_bills")
    .insert({
      location_id: loc,
      vendor_id,
      invoice_no,
      bill_date: transaction_date,
      bill_photo_path: billPhoto.path,
      delivery_photo_path: deliveryPhoto.path,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (billErr || !bill) return { error: billErr?.message ?? "Could not save the bill." };

  const { error: linesErr } = await supabase.from("inventory_ledger").insert(
    lines.map((l) => ({
      raw_material_id: l.raw_material_id,
      vendor_id,
      from_department_id: null,
      to_department_id: store?.id ?? null,
      type: "PURCHASE" as const,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      transaction_date,
      bill_id: bill.id,
      location_id: loc,
      created_by: user.id,
    })),
  );
  if (linesErr) {
    // Ledger lines failed. Bills are append-only (no delete policy), so the
    // header row stays — harmless: every read joins FROM the ledger, so a bill
    // with zero lines never surfaces anywhere.
    return { error: linesErr.message };
  }

  revalidatePath("/dashboard/admin/procurement/purchase-log");
  return {
    success: `Bill logged — ${lines.length} item(s).`,
    token: crypto.randomUUID(),
  };
}

/**
 * Record a vendor payment (admin) → append-only vendor_payments row, pinned to
 * the caller's home location and re-validated against the vendor.
 */
export async function recordVendorPayment(
  _prev: ActionState | undefined,
  fd: FormData,
): Promise<ActionState> {
  if (!(await isAdmin())) {
    return { error: "Only administrators can record payments." };
  }

  const vendor_id = str(fd, "vendor_id");
  const amount_paid = Number(fd.get("amount_paid") ?? 0);
  const payment_mode = str(fd, "payment_mode") || "CASH";
  const payment_date = str(fd, "payment_date");
  const pdate = /^\d{4}-\d{2}-\d{2}$/.test(payment_date) ? payment_date : null;

  if (!vendor_id) return { error: "Missing vendor." };
  if (!(amount_paid > 0)) return { error: "Amount must be greater than zero." };

  const supabase = await createClient();
  const loc = await locationId(supabase);
  if (!loc) return { error: "Your account isn't assigned to a location." };

  // Re-validate the vendor belongs to this location before recording.
  const { data: v } = await supabase
    .from("vendors")
    .select("id")
    .eq("id", vendor_id)
    .eq("location_id", loc)
    .maybeSingle();
  if (!v) return { error: "Vendor not found in your location." };

  const { error } = await supabase.from("vendor_payments").insert({
    vendor_id,
    amount_paid,
    payment_mode,
    reference_utr: orNull(str(fd, "reference_utr")),
    payment_date: pdate ?? undefined,
    location_id: loc,
  });
  if (error) return { error: error.message };

  revalidatePath(`/dashboard/admin/procurement/vendors/${vendor_id}`);
  revalidatePath("/dashboard/admin/procurement/vendors");
  return { success: "Payment recorded.", token: crypto.randomUUID() };
}

/**
 * Approve a vendor ("fixed unless added & approved"). Until approved a vendor
 * cannot be selected for purchases. Admin/owner only, location-scoped.
 */
export async function approveVendor(id: string): Promise<ActionState> {
  if (!(await isAdmin())) return { error: "Only administrators can approve vendors." };
  if (!id) return { error: "Missing vendor." };

  const supabase = await createClient();
  const loc = await locationId(supabase);
  if (!loc) return { error: "Your account isn't assigned to a location." };
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: updated, error } = await supabase
    .from("vendors")
    .update({
      approved: true,
      approved_at: new Date().toISOString(),
      approved_by: user?.id ?? null,
    })
    .eq("id", id)
    .eq("location_id", loc)
    .select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) {
    return { error: "Vendor not found in your location." };
  }

  revalidatePath("/dashboard/admin/procurement/vendors");
  return { success: "Vendor approved." };
}
