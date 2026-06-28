/**
 * Pure (no-IO) serialization between recipe costing data and the
 * "Thrayam Recipes & Costing" sheet template. Columns are 0-indexed A..H.
 *
 * Per tab:
 *   [A] "{CATEGORY} — RECIPE COSTING"                          ← title banner
 *   [A] "Use Recipe Tools → …"                                 ← instructions
 *   (blank)
 *   then, per recipe block:
 *   [A] "▶ {dish}"                                             ← dish header
 *   [A]Ingredient [C]Brand [D]Qty [E]Unit [F]@ Rate [G]Line ₹ [H]Notes
 *   [A]material   [C]brand [D]qty [E]unit [F]rate   [G]line                ← ingredients…
 *   [A] "Batch cost ▶"                                            [G] batch total
 *   [A] "Yield"  [D] portions  [E] "Ovhd %"  [F] ovhd  [G] "Sell ₹"  [H] sell
 *   [A] "Plate ₹"[D] plate     [E] "Margin ₹"[F] margin[G] "Food %"  [H] food%
 *   (blank)
 */

export const TITLE_SUFFIX = "— RECIPE COSTING";
export const INSTRUCTIONS =
  "Use Recipe Tools → Add Dish to add a costing card. Pick ingredients (yellow Qty), enter Yield, Overhead %, Sell. Plate/Margin/Food% auto.";

export interface MatrixIngredient {
  material: string;
  brand: string;
  quantity: number;
  unit: string;
  rate: number;
  lineCost: number;
}

export interface MatrixRecipe {
  name: string;
  ingredients: MatrixIngredient[];
  batchCost: number;
  yieldPortions: number;
  sellingPrice: number;
  plateCost: number;
  overheadPercentage: number;
  margin: number;
  foodCostPct: number;
}

const round2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
const money = (n: number) => `₹${round2(n).toFixed(2)}`;
const pct = (n: number) => `${(Number.isFinite(n) ? n : 0).toFixed(1)}%`;
const numStr = (n: number) => String(round2(n));
const blank = (): string[] => ["", "", "", "", "", "", "", ""];

/** Costing math — the single source of truth used by GUI, push, and tests. */
export function computeCosting(input: {
  ingredients: { quantity: number; rate: number }[];
  yieldPortions: number;
  sellingPrice: number;
}): {
  batchCost: number;
  plateCost: number;
  margin: number;
  foodCostPct: number;
} {
  const batchCost = input.ingredients.reduce(
    (sum, i) => sum + i.quantity * i.rate,
    0,
  );
  const yieldPortions = input.yieldPortions > 0 ? input.yieldPortions : 1;
  const plateCost = batchCost / yieldPortions;
  const margin = input.sellingPrice - plateCost;
  const foodCostPct =
    input.sellingPrice > 0 ? (plateCost / input.sellingPrice) * 100 : 0;
  return { batchCost, plateCost, margin, foodCostPct };
}

/** Serialize one recipe into its block of sheet rows (A..H). */
export function serializeRecipeBlock(recipe: MatrixRecipe): string[][] {
  const rows: string[][] = [];

  const header = blank();
  header[0] = `▶ ${recipe.name}`;
  rows.push(header);

  const colHeader = blank();
  colHeader[0] = "Ingredient";
  colHeader[2] = "Brand";
  colHeader[3] = "Qty";
  colHeader[4] = "Unit";
  colHeader[5] = "@ Rate";
  colHeader[6] = "Line ₹";
  colHeader[7] = "Notes";
  rows.push(colHeader);

  for (const ing of recipe.ingredients) {
    const r = blank();
    r[0] = ing.material; // A
    r[2] = ing.brand; // C
    r[3] = numStr(ing.quantity); // D
    r[4] = ing.unit; // E
    r[5] = money(ing.rate); // F  @ Rate
    r[6] = money(ing.lineCost); // G  Line ₹
    rows.push(r);
  }

  const batch = blank();
  batch[0] = "Batch cost ▶";
  batch[6] = money(recipe.batchCost); // G batch total
  rows.push(batch);

  const yieldRow = blank();
  yieldRow[0] = "Yield";
  yieldRow[3] = String(recipe.yieldPortions); // D portions
  yieldRow[4] = "Ovhd %";
  yieldRow[5] = numStr(recipe.overheadPercentage); // F overhead
  yieldRow[6] = "Sell ₹";
  yieldRow[7] = money(recipe.sellingPrice); // H retail price
  rows.push(yieldRow);

  const plate = blank();
  plate[0] = "Plate ₹";
  plate[3] = money(recipe.plateCost); // D plate cost
  plate[4] = "Margin ₹";
  plate[5] = money(recipe.margin); // F margin
  plate[6] = "Food %";
  plate[7] = pct(recipe.foodCostPct); // H food cost %
  rows.push(plate);

  rows.push([]); // separator
  return rows;
}

/** Build a full tab: title banner, instructions, then each recipe block. */
export function serializeTab(
  category: string,
  recipes: MatrixRecipe[],
): string[][] {
  const title = blank();
  title[0] = `${category.toUpperCase()} ${TITLE_SUFFIX}`;
  const instr = blank();
  instr[0] = INSTRUCTIONS;
  return [title, instr, [], ...recipes.flatMap(serializeRecipeBlock)];
}

// --- Parsing (Pull) ----------------------------------------------------------

export interface ParsedIngredient {
  material: string;
  quantity: number;
}

export interface ParsedRecipe {
  name: string;
  ingredients: ParsedIngredient[];
  yieldPortions: number | null;
  overheadPercentage: number | null;
  sellingPrice: number | null;
}

const cell = (row: string[] | undefined, i: number): string =>
  (row?.[i] ?? "").toString().trim();

const toNum = (s: string): number | null => {
  if (!s) return null;
  const n = Number(s.replace(/[₹,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const LEADING_TRIANGLE = /^[▶▸►▾▿‣›>]+\s*/;

/** Strip a leading "▶"/"►"/">" decoration from a header cell. */
function stripTriangle(s: string): string {
  return s.replace(LEADING_TRIANGLE, "").trim();
}

/** "MEAT-001  Chicken-Boneless" → "Chicken-Boneless" (drop a leading code). */
export function extractMaterialName(raw: string): string {
  const gap = raw.search(/\s{2,}|\t/);
  if (gap >= 0) {
    const before = raw.slice(0, gap).trim();
    const after = raw.slice(gap).trim();
    if (after && /^[A-Za-z]{2,}[-/]?\d+[A-Za-z0-9-]*$/.test(before)) return after;
  }
  return raw.trim();
}

function isSkippable(aNorm: string): boolean {
  return (
    aNorm === "ingredient" ||
    aNorm === "brand" ||
    aNorm.includes("recipe costing") ||
    aNorm.startsWith("use recipe")
  );
}

/** Parse a tab's rows back into recipe blocks (dish, ingredients, yield/sell). */
export function parseTab(rows: string[][]): ParsedRecipe[] {
  // Track each dish with whether it has a real costing block, so stray
  // ▶-rows without a Batch/Yield/Plate structure are discarded.
  const tracked: { recipe: ParsedRecipe; hasBlock: boolean }[] = [];
  let current: { recipe: ParsedRecipe; hasBlock: boolean } | null = null;

  for (const row of rows) {
    const aRaw = cell(row, 0);
    if (!aRaw) continue; // blank / empty-slot row

    // Dish header — MUST be marked with a leading ▶ (template convention).
    if (LEADING_TRIANGLE.test(aRaw)) {
      current = {
        recipe: {
          name: stripTriangle(aRaw),
          ingredients: [],
          yieldPortions: null,
          overheadPercentage: null,
          sellingPrice: null,
        },
        hasBlock: false,
      };
      tracked.push(current);
      continue;
    }

    const aNorm = aRaw.replace(/[▶▸►]/g, "").trim().toLowerCase();
    if (isSkippable(aNorm)) continue;

    // Summary rows — their presence proves this is a real costing card.
    if (aNorm.startsWith("batch cost")) {
      if (current) current.hasBlock = true;
      continue;
    }
    if (aNorm.startsWith("plate")) {
      if (current) current.hasBlock = true;
      continue;
    }
    if (aNorm.startsWith("margin")) continue;
    if (aNorm === "yield") {
      if (current) {
        current.hasBlock = true;
        // Strict offsets: D=portions, F=overhead %, H=retail price.
        current.recipe.yieldPortions = toNum(cell(row, 3));
        current.recipe.overheadPercentage = toNum(cell(row, 5));
        current.recipe.sellingPrice = toNum(cell(row, 7));
      }
      continue;
    }

    // Ingredient row — numeric quantity in column D, under a known dish.
    const qty = toNum(cell(row, 3));
    if (qty !== null && current) {
      current.recipe.ingredients.push({
        material: extractMaterialName(aRaw),
        quantity: qty,
      });
      continue;
    }

    // Anything else (notes, stray text) is ignored.
  }

  // Keep only real dishes: a valid costing block or at least one ingredient.
  return tracked
    .filter((t) => t.hasBlock || t.recipe.ingredients.length > 0)
    .map((t) => t.recipe);
}

/** Tab names that are internal/auxiliary and must never be treated as recipes. */
const TAB_DENYLIST = [
  "instruction",
  "index",
  "summary",
  "picklist",
  "item",
  "sample",
  "master",
  "operation",
  "vendor",
  "config",
  "readme",
  "setting",
  "dashboard",
];

/**
 * A tab is a recipe-costing sheet only if its title isn't internal/auxiliary
 * AND it carries the "… — RECIPE COSTING" banner near the top.
 */
export function isRecipeCostingTab(title: string, rows: string[][]): boolean {
  const name = title.trim().toLowerCase();
  if (name.startsWith("_")) return false;
  if (TAB_DENYLIST.some((k) => name.includes(k))) return false;
  return rows
    .slice(0, 4)
    .some((r) => (r?.[0] ?? "").toString().toLowerCase().includes("recipe costing"));
}
