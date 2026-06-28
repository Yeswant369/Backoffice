import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  parsePetpoojaPayload,
  explodeSale,
  type RecipeNode,
} from "@/lib/pos/explosion";
import { mirrorSalesDepletion } from "@/lib/pos/depletion-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const num = (v: unknown) => Number(v ?? 0);

interface IngredientRow {
  raw_material_id: string | null;
  sub_recipe_id: string | null;
  quantity_needed: number;
}
interface RecipeRow {
  id: string;
  pos_item_code: string | null;
  yield_portions: number;
  recipe_ingredients: IngredientRow[];
}

/**
 * Petpooja POS webhook. NOT session-authenticated. Each request carries a
 * per-tenant secret (header `x-petpooja-secret`, falling back to ?secret=). The
 * SERVICE ROLE client resolves the owning location by that secret (RLS bypass),
 * then every read/write is scoped to that location_id EXPLICITLY.
 *
 * IDEMPOTENT: every write carries a per-order key (the POS order id, or a sha256
 * of the raw body when the POS omits one — identical retries hash identically).
 * pos_sales/unmapped_sales are keyed by (location, order, line_no) and the
 * SALES_DEPLETION ledger by (location, source_ref=order, raw_material). All
 * inserts upsert-ignore-duplicates, so a retry (failed write → 500, or a lost
 * ACK) is a safe no-op — no double sales volume, no double stock depletion.
 */
export async function POST(req: NextRequest) {
  const headerSecret = req.headers.get("x-petpooja-secret")?.trim();
  const url = new URL(req.url);
  const querySecret = url.searchParams.get("secret")?.trim();
  const secret = headerSecret || querySecret || "";
  if (!secret) {
    return NextResponse.json({ error: "Missing POS secret." }, { status: 401 });
  }

  const admin = createAdminClient();

  // Tenant resolution by secret (service role bypasses RLS). Unknown → 401.
  const { data: loc, error: locErr } = await admin
    .from("locations")
    .select("id")
    .eq("pos_webhook_secret", secret)
    .maybeSingle();
  if (locErr) {
    return NextResponse.json({ error: "Auth lookup failed." }, { status: 500 });
  }
  if (!loc) {
    return NextResponse.json({ error: "Invalid POS secret." }, { status: 401 });
  }
  const locationId = loc.id as string;

  // Read the RAW body once (needed for the idempotency hash) then parse.
  let rawText: string;
  let body: unknown;
  try {
    rawText = await req.text();
    body = JSON.parse(rawText);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = parsePetpoojaPayload(body);
  if (parsed.items.length === 0) {
    return NextResponse.json(
      { ok: true, message: "No sale lines to process.", consumed: 0, unmapped: 0 },
      { status: 200 },
    );
  }

  // Idempotency key for this order: the POS order id, else a stable hash of the
  // raw payload (Petpooja resends the identical body on retry → same hash).
  const orderId =
    parsed.orderId ??
    `sha:${createHash("sha256").update(rawText).digest("hex").slice(0, 40)}`;

  // Kitchen department = the depleted on-hand bucket (live_stock from_department).
  const { data: kitchen } = await admin
    .from("departments")
    .select("id")
    .eq("location_id", locationId)
    .ilike("name", "kitchen")
    .maybeSingle();
  if (!kitchen) {
    return NextResponse.json(
      { error: "No 'Kitchen' department configured for this location." },
      { status: 500 },
    );
  }
  const kitchenId = kitchen.id as number;

  // Lines already recorded as pos_sales for this order — by an earlier delivery
  // OR by a manual map-and-replay — must NOT deplete again. Skipping them keeps a
  // re-delivered order idempotent across BOTH paths (the replay posts depletion
  // under a different source_ref, so the ledger key alone wouldn't catch it).
  const { data: existingSales } = await admin
    .from("pos_sales")
    .select("line_no")
    .eq("location_id", locationId)
    .eq("order_id", orderId);
  const alreadyRecorded = new Set(
    (existingSales ?? []).map((r) => r.line_no as number),
  );

  // Load the full recipe graph for this location ONCE (recursion is in-memory).
  const { data: recipeRows, error: recErr } = await admin
    .from("recipes")
    .select(
      "id, pos_item_code, yield_portions, recipe_ingredients!recipe_id ( raw_material_id, sub_recipe_id, quantity_needed )",
    )
    .eq("location_id", locationId);
  if (recErr) {
    return NextResponse.json({ error: recErr.message }, { status: 500 });
  }

  const byId = new Map<string, RecipeNode>();
  const byPosCode = new Map<string, RecipeNode>();
  for (const r of (recipeRows ?? []) as unknown as RecipeRow[]) {
    const node: RecipeNode = {
      id: r.id,
      yieldPortions: num(r.yield_portions) || 1,
      ingredients: (r.recipe_ingredients ?? []).map((ri) => ({
        rawMaterialId: ri.raw_material_id ?? null,
        subRecipeId: ri.sub_recipe_id ?? null,
        quantityNeeded: num(ri.quantity_needed),
      })),
    };
    byId.set(node.id, node);
    if (r.pos_item_code) byPosCode.set(r.pos_item_code, node);
  }

  // Explode every sold line. Matched lines also become pos_sales facts. line_no
  // (the line's index in the order) is part of the idempotency key.
  const consumed = new Map<string, number>(); // raw_material_id -> total qty
  const posSalesRows: {
    location_id: string;
    recipe_id: string;
    quantity: number;
    pos_item_code: string | null;
    order_id: string;
    line_no: number;
    raw_payload: unknown;
  }[] = [];
  const unmappedRows: {
    location_id: string;
    pos_item_code: string | null;
    item_name: string | null;
    quantity: number;
    order_id: string;
    line_no: number;
    raw_payload: unknown;
  }[] = [];

  parsed.items.forEach((line, lineNo) => {
    if (alreadyRecorded.has(lineNo)) return; // already depleted (delivery or replay)
    const recipe = line.posItemCode ? byPosCode.get(line.posItemCode) : undefined;
    if (!recipe) {
      unmappedRows.push({
        location_id: locationId,
        pos_item_code: line.posItemCode,
        item_name: line.name,
        quantity: line.quantity,
        order_id: orderId,
        line_no: lineNo,
        raw_payload: line.raw,
      });
      return;
    }
    posSalesRows.push({
      location_id: locationId,
      recipe_id: recipe.id,
      quantity: line.quantity,
      pos_item_code: line.posItemCode,
      order_id: orderId,
      line_no: lineNo,
      raw_payload: line.raw,
    });
    try {
      explodeSale(recipe, line.quantity, byId, consumed);
    } catch (e) {
      // A cyclic/over-deep recipe shouldn't fail the whole order — triage it.
      unmappedRows.push({
        location_id: locationId,
        pos_item_code: line.posItemCode,
        item_name: `${line.name ?? ""} (explosion error: ${e instanceof Error ? e.message : "unknown"})`,
        quantity: line.quantity,
        order_id: orderId,
        line_no: lineNo,
        raw_payload: line.raw,
      });
    }
  });

  // Per-recipe portions-sold fact (Epic 3). Idempotent on (location, order, line).
  if (posSalesRows.length > 0) {
    const { error } = await admin
      .from("pos_sales")
      .upsert(posSalesRows, { onConflict: "location_id,order_id,line_no", ignoreDuplicates: true });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Triage queue for unmatched POS codes (discrepancy detection). Best-effort.
  if (unmappedRows.length > 0) {
    await admin
      .from("unmapped_sales")
      .upsert(unmappedRows, { onConflict: "location_id,order_id,line_no", ignoreDuplicates: true });
  }

  // One SALES_DEPLETION ledger row per consumed raw material (append-only).
  // Idempotent on (location, source_ref=order, raw_material).
  const ledgerRows = [...consumed.entries()]
    .filter(([, qty]) => qty > 0)
    .map(([rawMaterialId, qty]) => ({
      raw_material_id: rawMaterialId,
      vendor_id: null,
      from_department_id: kitchenId,
      to_department_id: null,
      type: "SALES_DEPLETION" as const,
      quantity: Number(qty.toFixed(4)),
      unit_price: null,
      wastage_reason: null,
      location_id: locationId,
      created_by: null,
      source_ref: orderId,
    }));

  if (ledgerRows.length > 0) {
    const { error: insErr } = await admin
      .from("inventory_ledger")
      .upsert(ledgerRows, {
        onConflict: "location_id,source_ref,raw_material_id",
        ignoreDuplicates: true,
      });
    if (insErr) {
      // Failure to record depletion → 500 so Petpooja retries (safely, idempotent).
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  // Best-effort sheet mirror; a Google failure must not fail the POS ack.
  try {
    await mirrorSalesDepletion(admin, locationId);
  } catch {
    // ledger is source of truth; next sync reconciles the sheet.
  }

  return NextResponse.json(
    {
      ok: true,
      order_id: orderId,
      recipes_sold: posSalesRows.length,
      consumed: ledgerRows.length,
      unmapped: unmappedRows.length,
    },
    { status: 200 },
  );
}
