import "server-only";

export const MAX_EXPLOSION_DEPTH = 12;

export interface RecipeIngredientNode {
  rawMaterialId: string | null;
  subRecipeId: string | null;
  quantityNeeded: number;
}
export interface RecipeNode {
  id: string;
  yieldPortions: number; // coerced >= 1 by caller
  ingredients: RecipeIngredientNode[];
}

export interface ParsedLine {
  posItemCode: string | null;
  name: string | null;
  quantity: number;
  raw: unknown;
}
export interface ParsedPayload {
  orderId: string | null;
  items: ParsedLine[];
}

const asNum = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const asStr = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

/**
 * Tolerant Petpooja parser. Accepts several historically-seen shapes:
 *   { items: [{ pos_item_code, quantity, name }] }
 *   { Items: [{ itemid, qty, name }] }            (legacy casing)
 *   { order: { items: [...] }, order_id }
 * Unknown extra fields are ignored; the whole line object is preserved in `raw`
 * for triage. Never throws.
 */
export function parsePetpoojaPayload(body: unknown): ParsedPayload {
  const root = (body ?? {}) as Record<string, unknown>;
  const order = (root.order ?? root.Order ?? {}) as Record<string, unknown>;
  const orderId =
    asStr(root.order_id) ?? asStr(root.orderID) ?? asStr(order.order_id) ?? null;

  const rawItems =
    (root.items as unknown[]) ??
    (root.Items as unknown[]) ??
    (order.items as unknown[]) ??
    (order.Items as unknown[]) ??
    [];

  const items: ParsedLine[] = [];
  for (const it of Array.isArray(rawItems) ? rawItems : []) {
    const o = (it ?? {}) as Record<string, unknown>;
    const posItemCode =
      asStr(o.pos_item_code) ??
      asStr(o.itemid) ??
      asStr(o.item_code) ??
      asStr(o.code) ??
      asStr(o.sku);
    // Portions are whole units. Round so pos_sales/unmapped_sales (int columns)
    // and the exploded ledger consume the SAME quantity — no silent divergence,
    // and never a sub-0.5 value that would round to 0 and violate quantity > 0.
    const qty = Math.round(asNum(o.quantity ?? o.qty ?? o.Qty ?? 1));
    if (qty <= 0) continue; // skip voids / zero / sub-portion lines
    items.push({
      posItemCode,
      name: asStr(o.name ?? o.item_name ?? o.itemname),
      quantity: qty,
      raw: it,
    });
  }
  return { orderId, items };
}

/**
 * Recursively flatten one sold recipe into raw-material consumption, mutating
 * `acc` (raw_material_id -> total qty). See lib/pos/explosion full algorithm in
 * coreLogic. Exposed so the route and tests share ONE implementation.
 */
export function explodeSale(
  recipe: RecipeNode,
  soldPortions: number,
  byId: Map<string, RecipeNode>,
  acc: Map<string, number>,
): void {
  explode(recipe, soldPortions, byId, acc, new Set<string>(), 0);
}

function explode(
  recipe: RecipeNode,
  portions: number,
  byId: Map<string, RecipeNode>,
  acc: Map<string, number>,
  visiting: Set<string>,
  depth: number,
): void {
  if (portions <= 0) return;
  if (depth > MAX_EXPLOSION_DEPTH) {
    throw new Error(`Recipe explosion exceeded max depth (${MAX_EXPLOSION_DEPTH}) at recipe ${recipe.id}`);
  }
  if (visiting.has(recipe.id)) {
    throw new Error(`Recipe cycle detected at ${recipe.id}`);
  }
  visiting.add(recipe.id);

  const yieldPortions = recipe.yieldPortions > 0 ? recipe.yieldPortions : 1;

  for (const ing of recipe.ingredients) {
    // quantity_needed is per BATCH; one sold portion uses 1/yieldPortions of it.
    const perPortion = ing.quantityNeeded / yieldPortions;
    const totalForLine = perPortion * portions;
    if (totalForLine <= 0) continue;

    if (ing.rawMaterialId) {
      acc.set(ing.rawMaterialId, (acc.get(ing.rawMaterialId) ?? 0) + totalForLine);
    } else if (ing.subRecipeId) {
      const sub = byId.get(ing.subRecipeId);
      if (!sub) continue; // referential gap — skip rather than crash the order
      // The sub-recipe contributes `totalForLine` of its OWN portions.
      explode(sub, totalForLine, byId, acc, visiting, depth + 1);
    }
  }

  visiting.delete(recipe.id); // allow diamond reuse on sibling branches
}
