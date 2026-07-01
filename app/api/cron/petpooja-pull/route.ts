import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePetpoojaCreds } from "@/lib/pos/petpooja";
import { syncLocationPos, istDate } from "@/lib/pos/petpooja-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Nightly Petpooja PULL. Vercel Cron hits this once a day; it fetches the
 * previous day (T-1, IST) for every outlet that has a restID and ingests it.
 * Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}` when CRON_SECRET is
 * configured; we also accept ?secret= for manual triggering.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(req.url).searchParams.get("secret") ??
    "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret ?? "");
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: locs, error } = await admin
    .from("locations")
    .select("id, petpooja_rest_id, petpooja_app_key, petpooja_app_secret, petpooja_access_token")
    .not("petpooja_rest_id", "is", null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const yesterday = istDate(-1);
  const results: unknown[] = [];
  for (const loc of locs ?? []) {
    const restId = loc.petpooja_rest_id as string | null;
    if (!restId) continue;
    // Per-location creds (Petpooja may issue per restaurant), else env fallback.
    const creds = resolvePetpoojaCreds(loc);
    if (!creds) {
      results.push({ location: loc.id, error: "no Petpooja credentials (per-outlet or env)" });
      continue;
    }
    const r = await syncLocationPos(admin, { id: loc.id as string, petpooja_rest_id: restId }, [yesterday], creds);
    results.push({ location: loc.id, ...r });
  }

  return NextResponse.json({ ok: true, date: yesterday, outlets: results.length, results });
}
