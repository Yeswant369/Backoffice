export interface VendorRow {
  id: string;
  vendor_code: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  bank_name: string | null;
  account_number: string | null;
  ifsc_code: string | null;
  status: string;
}

export interface MaterialRow {
  id: string;
  name: string;
  code: string | null;
  brand: string | null;
  purchase_unit: string;
  stock_unit: string;
  conversion_factor: number;
  par_level: number;
  /** "INGREDIENT" | "OPERATIONAL" — drives the catalog split tabs. */
  material_type: string;
  category: string | null;
  category_id: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  weighted_avg_cost: number;
  needs_review: boolean;
}

/** A managed category (materials / vendors / cuisines) for pickers. */
export interface CategoryOption {
  id: string;
  name: string;
}

export interface RecipeRow {
  id: string;
  name: string;
  selling_price: number;
  ingredient_count: number;
  category: string | null;
  course: string | null;
  pos_item_code: string | null;
  yield_portions: number;
  overhead_percentage: number;
}

/** Minimal options for select inputs. */
export interface VendorOption {
  id: string;
  vendor_code: string;
  name: string;
}

export interface MaterialOption {
  id: string;
  name: string;
  code: string | null;
  stock_unit: string;
  brand: string | null;
  /** Weighted-average cost per stock unit (the @ Rate used for costing). */
  weighted_avg_cost: number;
}
