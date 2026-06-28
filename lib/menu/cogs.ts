/**
 * In-memory recursive plate cost, mirroring the SQL recipe_cogs(). Use only for
 * previewing UNSAVED recipe graphs; for saved recipes prefer the recipe_costing
 * view / recipe_cogs() SQL (single source of truth, RLS-scoped).
 */
export interface RecipeNode {
  id: string;
  yieldPortions: number;
  overheadPercentage: number;
  ingredients: {
    rawMaterialId?: string | null;
    subRecipeId?: string | null;
    quantityNeeded: number;
  }[];
}

/** @param wac map of raw_material_id -> weighted_avg_cost */
export function recipeBatchCost(
  recipeId: string,
  recipes: Map<string, RecipeNode>,
  wac: Map<string, number>,
  visited: Set<string> = new Set(),
): number {
  if (visited.has(recipeId)) return 0; // cycle guard
  visited.add(recipeId);
  const r = recipes.get(recipeId);
  if (!r) return 0;

  let batch = 0;
  for (const line of r.ingredients) {
    if (line.rawMaterialId) {
      batch += line.quantityNeeded * (wac.get(line.rawMaterialId) ?? 0);
    } else if (line.subRecipeId) {
      const sub = recipes.get(line.subRecipeId);
      const subPortions = Math.max(1, sub?.yieldPortions ?? 1);
      const subBatch = recipeBatchCost(
        line.subRecipeId,
        recipes,
        wac,
        new Set(visited),
      );
      // Per-portion sub cost, WITH the sub-recipe's own overhead compounded in
      // (matches SQL recipe_cogs()).
      const subOverhead = 1 + (sub?.overheadPercentage ?? 0) / 100;
      batch += line.quantityNeeded * (subBatch / subPortions) * subOverhead;
    }
  }
  visited.delete(recipeId);
  return batch;
}

/** Per-portion plate COGS incl. overhead, matching SQL recipe_cogs(). */
export function recipeCogs(
  recipeId: string,
  recipes: Map<string, RecipeNode>,
  wac: Map<string, number>,
): number {
  const r = recipes.get(recipeId);
  if (!r) return 0;
  const batch = recipeBatchCost(recipeId, recipes, wac);
  const plate = batch / Math.max(1, r.yieldPortions);
  const cogs = plate * (1 + (r.overheadPercentage ?? 0) / 100);
  return Math.round(cogs * 10000) / 10000;
}
