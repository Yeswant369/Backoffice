"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth";
import { resolvePetpoojaCreds } from "@/lib/pos/petpooja";
import { syncLocationPos, datesBetween, istDate } from "@/lib/pos/petpooja-sync";

export interface PosState {
  error?: string;
  success?: string;
}

const pct = (fd: FormData, k: string) => {
  const n = Number(fd.get(k) ?? 0);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 0;
};

/** Save the outlet's Petpooja restID + per-platform commission %. */
export async function savePosConfig(
  _prev: PosState | undefined,
  fd: FormData,
): Promise<PosState> {
  if (!(await isAdmin())) return { error: "Only administrators can configure POS." };

  const restId = String(fd.get("rest_id") ?? "").trim();
  const commissions: Record<string, number> = {};
  const swiggy = pct(fd, "commission_swiggy");
  const zomato = pct(fd, "commission_zomato");
  if (swiggy > 0) commissions.Swiggy = swiggy;
  if (zomato > 0) commissions.Zomato = zomato;

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_pos_config", {
    p_rest_id: restId,
    p_commissions: commissions,
  });
  if (error) {
    if (error.code === "23505") {
      return { error: "That Restaurant ID is already linked to another outlet." };
    }
    return { error: error.message };
  }

  // Credentials (write-only vault): only send fields the user actually typed —
  // a blank field keeps the stored value (see set_pos_creds).
  const appKey = String(fd.get("app_key") ?? "").trim();
  const appSecret = String(fd.get("app_secret") ?? "").trim();
  const accessToken = String(fd.get("access_token") ?? "").trim();
  if (appKey || appSecret || accessToken) {
    const { error: cErr } = await supabase.rpc("set_pos_creds", {
      p_app_key: appKey,
      p_app_secret: appSecret,
      p_access_token: accessToken,
    });
    if (cErr) return { error: cErr.message };
  }

  revalidatePath("/dashboard/admin/settings", "layout");
  return { success: restId ? "POS integration saved." : "Restaurant ID cleared." };
}

/** Pull + ingest the last N days for THIS outlet on demand (backfill / catch-up). */
export async function syncPosNow(
  _prev: PosState | undefined,
  fd: FormData,
): Promise<PosState> {
  if (!(await isAdmin())) return { error: "Only administrators can sync." };

  const days = Math.min(Math.max(Math.round(Number(fd.get("days") ?? 2)), 1), 90);

  const supabase = await createClient();
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? null;
  if (!loc) return { error: "Your account isn't assigned to a location." };

  // Read the outlet incl. its (secret) creds via the service-role client — the
  // cred columns aren't readable by `authenticated`.
  const admin = createAdminClient();
  const { data: locRow } = await admin
    .from("locations")
    .select("id, petpooja_rest_id, petpooja_app_key, petpooja_app_secret, petpooja_access_token")
    .eq("id", loc)
    .maybeSingle();
  const restId = (locRow?.petpooja_rest_id as string | null) ?? null;
  if (!restId) return { error: "Set and save your Petpooja Restaurant ID first." };

  const creds = resolvePetpoojaCreds(locRow);
  if (!creds) {
    return {
      error:
        "Petpooja credentials aren't set — paste your app key / secret / access token above (or set them in server env).",
    };
  }
  // T-1 back through T-days (Petpooja serves T-1; today isn't available yet).
  const dates = datesBetween(istDate(-days), istDate(-1));
  const r = await syncLocationPos(
    admin,
    { id: locRow!.id as string, petpooja_rest_id: restId },
    dates,
    creds,
  );

  revalidatePath("/dashboard/admin/settings", "layout");
  const base = `Synced ${r.days} day(s): ${r.orders} orders, ${r.depleted} stock deductions, ${r.unmapped} unmapped.`;
  if (r.errors.length && r.orders === 0) {
    return { error: `${base} Issues: ${r.errors.slice(0, 2).join("; ")}` };
  }
  return {
    success: r.errors.length ? `${base} (some days had issues)` : base,
  };
}
