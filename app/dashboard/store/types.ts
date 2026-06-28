export interface LiveStockRow {
  raw_material_id: string;
  raw_material_name: string;
  category: string | null;
  stock_unit: string;
  par_level: number;
  department_id: number;
  department_name: string;
  current_stock: number;
  below_par: boolean;
}

export interface VendorOption {
  id: string;
  vendor_code: string;
  name: string;
}

export interface RawMaterialOption {
  id: string;
  name: string;
  brand: string | null;
  purchase_unit: string;
  stock_unit: string;
  conversion_factor: number;
  vendor_id: string | null;
  category: string | null;
}

export interface DepartmentOption {
  id: number;
  name: string;
}
