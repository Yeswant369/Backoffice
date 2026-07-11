import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth";
import { normalizeRoles, ROLE_LABELS } from "@/lib/roles";

export interface SearchHit {
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export interface SearchGroup {
  /** Display label — also drives the icon on the client. */
  label:
    | "Vendors"
    | "Materials"
    | "Recipes"
    | "Orders & Indents"
    | "Purchase Bills"
    | "Departments"
    | "Categories"
    | "Staff";
  hits: SearchHit[];
}

export interface SearchResponse {
  groups: SearchGroup[];
  error?: string;
}

const LIMIT = 6;

/**
 * Split the query into LIKE-safe words (every word must match — AND semantics,
 * so "amul butter" finds "Butter Amul"). Strips PostgREST `.or()` syntax chars
 * (commas/parens/quotes would parse as filter separators) AND `*`, which
 * PostgREST aliases to `%` inside like/ilike patterns — leaving it in would let
 * a `**` query defeat the match-everything guard below.
 */
function likeWords(raw: string): string[] | null {
  const cleaned = raw
    .replace(/[,()"\\*]/g, " ")
    .replace(/[%_]/g, "\\$&")
    .replace(/\s+/g, " ")
    .trim();
  // An emptied-out term would be "%%" — matching EVERYTHING. Refuse instead.
  if (cleaned.length < 2) return null;
  return cleaned.split(" ").slice(0, 5);
}

const n = (v: unknown) => Number(v ?? 0);

/**
 * Universal entity search across the caller's HOME outlet.
 *
 * Admin-gated: every result links to a page under /dashboard/admin, which is
 * itself `isAdmin()`-guarded — serving hits to other roles would only produce
 * dead links (and leak names they have no page for). Non-admins still get the
 * client-side page navigator. All queries run through the RLS client pinned to
 * current_location_id(), so no cross-tenant row can ever be returned; the one
 * admin-client query (staff) applies the same home pin explicitly.
 */
export async function universalSearch(raw: string): Promise<SearchResponse> {
  const q = raw.trim();
  if (q.length < 2) return { groups: [] };
  if (!(await isAdmin())) return { groups: [] };

  const words = likeWords(q);
  if (!words) return { groups: [] };

  const supabase = await createClient();
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? null;
  if (!loc) return { groups: [], error: "No location assigned." };

  // Chained .or() calls AND together, so every word must hit ≥1 column.
  const orAcross = (cols: string[]) => (w: string) =>
    cols.map((c) => `${c}.ilike.%${w}%`).join(",");

  let vendorsQ = supabase
    .from("vendors")
    .select("id, name, vendor_code, status, category")
    .eq("location_id", loc);
  const vendorOr = orAcross(["name", "vendor_code", "phone", "gstin"]);
  for (const w of words) vendorsQ = vendorsQ.or(vendorOr(w));

  let materialsQ = supabase
    .from("raw_materials")
    .select("id, name, code, material_type, category, stock_unit")
    .eq("location_id", loc);
  const materialOr = orAcross(["name", "code", "brand"]);
  for (const w of words) materialsQ = materialsQ.or(materialOr(w));

  let recipesQ = supabase
    .from("recipes")
    .select("id, name, category, course, selling_price")
    .eq("location_id", loc);
  const recipeOr = orAcross(["name", "category", "course"]);
  for (const w of words) recipesQ = recipesQ.or(recipeOr(w));

  let ordersQ = supabase
    .from("purchase_orders")
    .select("id, po_number, kind, status, created_at")
    .eq("location_id", loc);
  for (const w of words) ordersQ = ordersQ.ilike("po_number", `%${w}%`);

  let billsQ = supabase
    .from("purchase_bills")
    .select("id, invoice_no, bill_date, vendors ( name )")
    .eq("location_id", loc);
  for (const w of words) billsQ = billsQ.ilike("invoice_no", `%${w}%`);

  let departmentsQ = supabase
    .from("departments")
    .select("id, name")
    .eq("location_id", loc);
  for (const w of words) departmentsQ = departmentsQ.ilike("name", `%${w}%`);

  let categoriesQ = supabase
    .from("categories")
    .select("id, name, kind")
    .eq("location_id", loc);
  for (const w of words) categoriesQ = categoriesQ.ilike("name", `%${w}%`);

  // profiles RLS only exposes the caller's own row — list staff via the
  // service role, pinned to the SAME home outlet (mirrors the staff page).
  let staffQ = createAdminClient()
    .from("profiles")
    .select("id, full_name, roles")
    .eq("location_id", loc);
  for (const w of words) staffQ = staffQ.ilike("full_name", `%${w}%`);

  const [vendors, materials, recipes, orders, bills, departments, categories, staff] =
    await Promise.all([
      vendorsQ.order("name").limit(LIMIT),
      materialsQ.order("name").limit(LIMIT),
      recipesQ.order("name").limit(LIMIT),
      ordersQ.order("created_at", { ascending: false }).limit(LIMIT),
      billsQ.order("created_at", { ascending: false }).limit(LIMIT),
      departmentsQ.order("name").limit(LIMIT),
      categoriesQ.order("name").limit(LIMIT),
      staffQ.order("full_name").limit(LIMIT),
    ]);

  const groups: SearchGroup[] = [];

  const vendorHits: SearchHit[] = (vendors.data ?? []).map((v) => ({
    id: v.id as string,
    title: v.name as string,
    subtitle: [v.vendor_code, v.category, v.status !== "ACTIVE" ? v.status : null]
      .filter(Boolean)
      .join(" · "),
    href: `/dashboard/admin/procurement/vendors/${v.id}`,
  }));
  if (vendorHits.length) groups.push({ label: "Vendors", hits: vendorHits });

  const materialHits: SearchHit[] = (materials.data ?? []).map((m) => ({
    id: m.id as string,
    title: m.name as string,
    subtitle: [
      m.code,
      m.material_type === "OPERATIONAL" ? "Operational" : "Ingredient",
      m.category,
      m.stock_unit,
    ]
      .filter(Boolean)
      .join(" · "),
    href: `/dashboard/admin/materials/${m.id}`,
  }));
  if (materialHits.length) groups.push({ label: "Materials", hits: materialHits });

  const recipeHits: SearchHit[] = (recipes.data ?? []).map((r) => ({
    id: r.id as string,
    title: r.name as string,
    subtitle: [r.category, r.course, n(r.selling_price) > 0 ? `₹${n(r.selling_price)}` : null]
      .filter(Boolean)
      .join(" · "),
    href: `/dashboard/admin/recipes/${r.id}`,
  }));
  if (recipeHits.length) groups.push({ label: "Recipes", hits: recipeHits });

  const orderHits: SearchHit[] = (orders.data ?? []).map((o) => ({
    id: o.id as string,
    title: o.po_number as string,
    subtitle: `${o.kind === "INDENT" ? "Internal indent" : "Vendor PO"} · ${o.status}`,
    href: `/dashboard/admin/procurement/orders/${o.id}`,
  }));
  if (orderHits.length) groups.push({ label: "Orders & Indents", hits: orderHits });

  const billHits: SearchHit[] = (bills.data ?? []).map((b) => {
    const vendor = (b.vendors as { name?: string } | null)?.name;
    return {
      id: b.id as string,
      title: (b.invoice_no as string | null) ?? "Bill",
      subtitle: [vendor, b.bill_date].filter(Boolean).join(" · "),
      href: `/dashboard/admin/procurement/purchase-log?bill=${b.id}`,
    };
  });
  if (billHits.length) groups.push({ label: "Purchase Bills", hits: billHits });

  const deptHits: SearchHit[] = (departments.data ?? []).map((d) => ({
    id: String(d.id),
    title: d.name as string,
    subtitle: "Department · production worksheet",
    href: `/dashboard/admin/kitchen-production?dept=${d.id}`,
  }));
  if (deptHits.length) groups.push({ label: "Departments", hits: deptHits });

  const categoryHref = (kind: string, id: string): string =>
    kind === "vendor"
      ? `/dashboard/admin/procurement/vendors?cat=${id}`
      : kind === "cuisine"
        ? "/dashboard/admin/catalog?tab=recipes"
        : "/dashboard/admin/catalog?tab=materials";
  const categoryHits: SearchHit[] = (categories.data ?? []).map((c) => ({
    id: c.id as string,
    title: c.name as string,
    subtitle:
      c.kind === "vendor"
        ? "Vendor category"
        : c.kind === "cuisine"
          ? "Cuisine"
          : "Material category",
    href: categoryHref(c.kind as string, c.id as string),
  }));
  if (categoryHits.length) groups.push({ label: "Categories", hits: categoryHits });

  const staffHits: SearchHit[] = (staff.data ?? []).map((p) => ({
    id: p.id as string,
    title: (p.full_name as string | null) ?? "—",
    subtitle:
      normalizeRoles(p.roles)
        .map((r) => ROLE_LABELS[r])
        .join(", ") || "No roles",
    href: "/dashboard/admin/staff",
  }));
  if (staffHits.length) groups.push({ label: "Staff", hits: staffHits });

  return { groups };
}
