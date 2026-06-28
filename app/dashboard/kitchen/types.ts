export type { LiveStockRow, RawMaterialOption } from "../store/types";

export interface RecipeIngredient {
  quantity_needed: number;
  raw_materials: {
    id: string;
    name: string;
    stock_unit: string;
  } | null;
}

export interface RecipeOption {
  id: string;
  name: string;
  selling_price: number;
  recipe_ingredients: RecipeIngredient[];
}
