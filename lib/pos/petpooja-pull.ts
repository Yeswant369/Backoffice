import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { explodeSale, type RecipeNode } from "./explosion";

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

interface OrderFacts {
  order_key: string;
  pos_order_id: string | null;
  ref_id: string | null;
  online_order_id: string | null;
  order_type: string | null;
  channel: string | null;
  sub_order_type: string | null;
  payment_type: string | null;
  custom_payment_type: string | null;
  gross_amount: number;
  discount_amount: number;
  tax_amount: number;
  round_off: number;
  net_amount: number;
  status: string | null;
  sold_at: string | null;
  order_date: string | null;
  raw_payload: unknown;
}
interface ParsedLine {
  posItemCode: string | null;
  name: string | null;
  quantity: number;
  raw: unknown;
}
interface ParsedOrder {
  facts: OrderFacts;
  items: ParsedLine[];
  shouldDeplete: boolean; // consumed ingredients (not cancelled) → deplete stock
  isRevenue: boolean; // a real paid sale (Success) → counts as sales (pos_sales)
  saleTs: string; // business timestamp for pos_sales.sold_at (created_on, else day)
}

// Statuses whose food was NOT served → do not deplete stock. Everything else
// (Success, Complimentary/comped, Due/Part payment …) consumed ingredients and
// must reduce inventory, even if it isn't counted as revenue.
const CANCELLED_STATUSES = new Set([
  "cancel", "cancelled", "canceled", "failed", "rejected", "void", "voided",
]);

/** created_on "2026-06-30 23:44:08" (IST) → ISO "2026-06-30T23:44:08+05:30". */
function toIstIso(created: string | null): string | null {
  if (!created) return null;
  const m = created.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (!m) return null;
  return `${m[1]}T${m[2]}+05:30`;
}

/** Parse ONE Petpooja `order_json` element into facts + sold line items. */
export function parsePetpoojaOrder(raw: unknown): ParsedOrder {
  const root = (raw ?? {}) as Record<string, unknown>;
  const O = (root.Order ?? {}) as Record<string, unknown>;

  const posOrderId = str(O.orderID);
  const onlineOrderId = str(O.online_order_id);
  const refId = str(O.refId);
  const orderDate =
    str(O.order_date) ?? (str(O.created_on)?.slice(0, 10) ?? null);
  // Petpooja's orderID is a per-DAY counter (can even repeat across terminals),
  // so date-qualify it AND append a stable per-order discriminator (refId /
  // online id) so two orders sharing an orderID don't collide into one key. The
  // discriminator is stable across re-pulls (same source fields → same key).
  const disc =
    refId ??
    onlineOrderId ??
    createHash("sha256")
      .update(`${orderDate}|${JSON.stringify(root.OrderItem ?? [])}`)
      .digest("hex")
      .slice(0, 16);
  const order_key = `${orderDate ?? "nodate"}#${posOrderId ?? "x"}#${disc}`;

  const rawItems = (root.OrderItem ?? root.order_item ?? []) as unknown[];
  const items: ParsedLine[] = [];
  for (const it of Array.isArray(rawItems) ? rawItems : []) {
    const o = (it ?? {}) as Record<string, unknown>;
    const posItemCode = str(o.itemid) ?? str(o.itemcode) ?? str(o.item_code);
    const quantity = Math.round(num(o.quantity ?? o.qty ?? 1));
    if (quantity <= 0) continue;
    items.push({ posItemCode, name: str(o.name), quantity, raw: it });
  }

  const status = str(O.status);
  const soldAt = toIstIso(str(O.created_on));
  const facts: OrderFacts = {
    order_key,
    pos_order_id: posOrderId,
    ref_id: refId,
    online_order_id: onlineOrderId,
    order_type: str(O.order_type),
    channel: str(O.order_from),
    sub_order_type: str(O.sub_order_type),
    payment_type: str(O.payment_type),
    custom_payment_type: str(O.custom_payment_type),
    gross_amount: num(O.core_total),
    discount_amount: num(O.discount_total),
    tax_amount: num(O.tax_total),
    round_off: num(O.round_off),
    net_amount: num(O.total),
    status,
    sold_at: soldAt,
    order_date: orderDate,
    raw_payload: raw,
  };
  // Business timestamp for pos_sales.sold_at: the real sale time, else the
  // order's day at IST midnight — NEVER the ingest time (which would mis-date
  // every time-bucketed sales/COGS view onto the sync-run date).
  const saleTs = soldAt ?? `${orderDate ?? "1970-01-01"}T00:00:00+05:30`;
  return {
    facts,
    items,
    shouldDeplete: !CANCELLED_STATUSES.has((status ?? "").toLowerCase().trim()),
    isRevenue: (status ?? "").toLowerCase().trim() === "success",
    saleTs,
  };
}

interface RecipeRow {
  id: string;
  pos_item_code: string | null;
  yield_portions: number | null;
  recipe_ingredients: {
    raw_material_id: string | null;
    sub_recipe_id: string | null;
    quantity_needed: number | null;
  }[];
}

export interface IngestResult {
  orders: number;
  depleted: number;
  unmapped: number;
}

/**
 * Ingest a batch of raw Petpooja orders for ONE location: upsert order facts
 * into pos_orders, and (for Successful orders) explode line items into
 * pos_sales + unmapped_sales + SALES_DEPLETION — reusing the SAME idempotency
 * keys as the live webhook, so re-pulling a day never double-counts. Caller must
 * pass a service-role client (writes bypass RLS).
 */
export async function ingestPetpoojaOrders(
  admin: SupabaseClient,
  locationId: string,
  rawOrders: unknown[],
): Promise<IngestResult> {
  const parsed = rawOrders.map(parsePetpoojaOrder);

  const { data: kitchen } = await admin
    .from("departments")
    .select("id")
    .eq("location_id", locationId)
    .ilike("name", "kitchen")
    .maybeSingle();
  const kitchenId = (kitchen?.id as string | undefined) ?? null;

  const { data: recipeRows, error: recErr } = await admin
    .from("recipes")
    .select(
      "id, pos_item_code, yield_portions, recipe_ingredients!recipe_id ( raw_material_id, sub_recipe_id, quantity_needed )",
    )
    .eq("location_id", locationId);
  if (recErr) throw new Error(recErr.message);

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

  const posOrderRows: (OrderFacts & { location_id: string })[] = [];
  const posSalesRows: Record<string, unknown>[] = [];
  const unmappedRows: Record<string, unknown>[] = [];
  const ledgerRows: Record<string, unknown>[] = [];

  for (const p of parsed) {
    posOrderRows.push({ location_id: locationId, ...p.facts });
    if (!p.shouldDeplete || !kitchenId) continue; // cancelled orders don't deplete

    const consumed = new Map<string, number>();
    p.items.forEach((line, lineNo) => {
      const recipe = line.posItemCode ? byPosCode.get(line.posItemCode) : undefined;
      if (!recipe) {
        unmappedRows.push({
          location_id: locationId,
          pos_item_code: line.posItemCode,
          item_name: line.name,
          quantity: line.quantity,
          order_id: p.facts.order_key,
          line_no: lineNo,
          raw_payload: line.raw,
        });
        return;
      }
      // Only real paid sales become sales facts (revenue). Complimentary orders
      // still deplete stock (below) but are NOT revenue, keeping pos_sales — and
      // every view built on it (recipe_sales_volume, department_sales, pl_daily
      // revenue) — consistent with the status='Success' financial views.
      if (p.isRevenue) {
        posSalesRows.push({
          location_id: locationId,
          recipe_id: recipe.id,
          quantity: line.quantity,
          pos_item_code: line.posItemCode,
          order_id: p.facts.order_key,
          line_no: lineNo,
          sold_at: p.saleTs, // business time, NOT ingest time
          raw_payload: line.raw,
        });
      }
      try {
        explodeSale(recipe, line.quantity, byId, consumed);
      } catch (e) {
        unmappedRows.push({
          location_id: locationId,
          pos_item_code: line.posItemCode,
          item_name: `${line.name ?? ""} (explosion error: ${e instanceof Error ? e.message : "unknown"})`,
          quantity: line.quantity,
          order_id: p.facts.order_key,
          line_no: lineNo,
          raw_payload: line.raw,
        });
      }
    });
    for (const [rawMaterialId, qty] of consumed.entries()) {
      if (qty > 0) {
        ledgerRows.push({
          raw_material_id: rawMaterialId,
          vendor_id: null,
          from_department_id: kitchenId,
          to_department_id: null,
          type: "SALES_DEPLETION",
          quantity: Number(qty.toFixed(4)),
          unit_price: null,
          transaction_date: p.facts.order_date, // business day → pl_daily/reorder date correctly
          location_id: locationId,
          created_by: null,
          source_ref: p.facts.order_key,
        });
      }
    }
  }

  // Order facts: upsert (a re-pull refreshes them). Line/ledger facts: append
  // only, ignoreDuplicates (never re-deplete a re-pulled order).
  if (posOrderRows.length > 0) {
    const { error } = await admin
      .from("pos_orders")
      .upsert(posOrderRows, { onConflict: "location_id,order_key" });
    if (error) throw new Error(error.message);
  }
  if (posSalesRows.length > 0) {
    const { error } = await admin
      .from("pos_sales")
      .upsert(posSalesRows, {
        onConflict: "location_id,order_id,line_no",
        ignoreDuplicates: true,
      });
    if (error) throw new Error(error.message);
  }
  if (unmappedRows.length > 0) {
    await admin
      .from("unmapped_sales")
      .upsert(unmappedRows, {
        onConflict: "location_id,order_id,line_no",
        ignoreDuplicates: true,
      });
  }
  if (ledgerRows.length > 0) {
    const { error } = await admin
      .from("inventory_ledger")
      .upsert(ledgerRows, {
        onConflict: "location_id,source_ref,raw_material_id",
        ignoreDuplicates: true,
      });
    if (error) throw new Error(error.message);
  }

  return {
    orders: posOrderRows.length,
    depleted: ledgerRows.length,
    unmapped: unmappedRows.length,
  };
}
