import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import SectionHeader from "../../_components/SectionHeader";
import DishWorksheet, {
  type DishLite,
  type ExistingDishRow,
} from "./DishWorksheet";
import SubRecipeWorksheet, {
  type SubLite,
  type ExistingSubRow,
} from "./SubRecipeWorksheet";

export const dynamic = "force-dynamic";

const n = (v: unknown) => Number(v ?? 0);

/** Today in the location's timezone (IST), as YYYY-MM-DD. */
const todayIST = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

interface DishViewRow {
  recipe_id: string;
  prepared_qty: unknown;
  sold_qty: unknown;
  wastage_qty: unknown;
  staff_meals_qty: unknown;
  closing_qty: unknown;
  variance: unknown;
  wastage_photo_path: string | null;
}

interface SubViewRow {
  recipe_id: string;
  opening_qty: unknown;
  made_qty: unknown;
  available_qty: unknown;
  used_qty: unknown;
  waste_qty: unknown;
  closing_qty: unknown;
  variance_qty: unknown;
  waste_photo_path: string | null;
}

interface PriorSubRow {
  recipe_id: string;
  production_date: string;
  opening_qty: unknown;
  made_qty: unknown;
  used_qty: unknown;
  waste_qty: unknown;
  closing_qty: unknown;
}

interface SubLink {
  recipe_id: string;
  sub_recipe_id: string;
  quantity_needed: unknown;
}

export default async function KitchenProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; date?: string }>;
}) {
  if (!(await isAdmin())) redirect("/dashboard");

  const sp = await searchParams;
  const supabase = await createClient();
  // Pin to HOME — RLS read-scope spans the org for hybrid Admin+Owner users.
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? "";

  const { data: deptData } = await supabase
    .from("departments")
    .select("id, name")
    .eq("location_id", loc)
    .order("name");
  const departments = (deptData ?? []) as { id: number; name: string }[];

  const reqDept = Number(sp.dept);
  const deptId = departments.some((d) => d.id === reqDept)
    ? reqDept
    : (departments[0]?.id ?? 0);
  const today = todayIST();
  const day =
    sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= today
      ? sp.date
      : today;

  const [dishesRes, dishRowsRes, soldRes, subLinksRes, subRowsRes, priorRes] =
    await Promise.all([
      supabase
        .from("recipes")
        .select("id, name, selling_price")
        .eq("location_id", loc)
        .eq("department_id", deptId)
        .order("name"),
      supabase
        .from("kitchen_production_view")
        .select(
          "recipe_id, prepared_qty, sold_qty, wastage_qty, staff_meals_qty, closing_qty, variance, wastage_photo_path",
        )
        .eq("location_id", loc)
        .eq("department_id", deptId)
        .eq("production_date", day),
      supabase
        .from("recipe_sales_volume")
        .select("recipe_id, portions")
        .eq("location_id", loc)
        .eq("sold_on", day),
      supabase
        .from("recipe_ingredients")
        .select("recipe_id, sub_recipe_id, quantity_needed")
        .eq("location_id", loc)
        .not("sub_recipe_id", "is", null),
      supabase
        .from("sub_recipe_daily")
        .select(
          "recipe_id, opening_qty, made_qty, available_qty, used_qty, waste_qty, closing_qty, variance_qty, waste_photo_path",
        )
        .eq("location_id", loc)
        .eq("production_date", day),
      supabase
        .from("sub_recipe_daily")
        .select(
          "recipe_id, production_date, opening_qty, made_qty, used_qty, waste_qty, closing_qty",
        )
        .eq("location_id", loc)
        .lt("production_date", day)
        // NEWEST first + bounded: PostgREST caps responses (~1000 rows) and the
        // fallback needs each sub's LATEST prior row — ascending + unbounded
        // would silently truncate away exactly the rows we need.
        .order("production_date", { ascending: false })
        .limit(500),
    ]);

  const dishes = (dishesRes.data ?? []) as DishLite[];

  // Sold portions per recipe for `day` — fallback when no production row exists.
  const soldMap: Record<string, number> = {};
  for (const s of (soldRes.data ?? []) as { recipe_id: string; portions: unknown }[]) {
    soldMap[s.recipe_id] = n(s.portions);
  }

  const existingDish: Record<string, ExistingDishRow> = {};
  for (const r of (dishRowsRes.data ?? []) as DishViewRow[]) {
    existingDish[r.recipe_id] = {
      prepared_qty: n(r.prepared_qty),
      sold_qty: n(r.sold_qty),
      wastage_qty: n(r.wastage_qty),
      staff_meals_qty: n(r.staff_meals_qty),
      closing_qty: r.closing_qty === null ? null : n(r.closing_qty),
      variance: r.variance === null ? null : n(r.variance),
      wastage_photo_path: r.wastage_photo_path,
    };
  }

  // SUBS — every recipe used as a sub-ingredient anywhere in this outlet,
  // shown on this department's sheet if it belongs here (or has no department).
  const links = (subLinksRes.data ?? []) as SubLink[];
  const subIds = [...new Set(links.map((l) => l.sub_recipe_id))];
  const parentIds = [...new Set(links.map((l) => l.recipe_id))];

  let subs: SubLite[] = [];
  const yieldMap = new Map<string, number>();
  if (subIds.length > 0) {
    const { data: recData } = await supabase
      .from("recipes")
      .select("id, name, department_id, yield_portions")
      .eq("location_id", loc)
      .in("id", [...new Set([...subIds, ...parentIds])])
      .order("name");
    const recs = (recData ?? []) as {
      id: string;
      name: string;
      department_id: number | null;
      yield_portions: unknown;
    }[];
    for (const r of recs) yieldMap.set(r.id, Math.max(n(r.yield_portions), 1));
    const subIdSet = new Set(subIds);
    subs = recs
      .filter(
        (r) =>
          subIdSet.has(r.id) &&
          (r.department_id === deptId || r.department_id === null),
      )
      .map((r) => ({ id: r.id, name: r.name }));
  }

  const existingSub: Record<string, ExistingSubRow> = {};
  for (const r of (subRowsRes.data ?? []) as SubViewRow[]) {
    existingSub[r.recipe_id] = {
      opening_qty: n(r.opening_qty),
      made_qty: n(r.made_qty),
      available_qty: n(r.available_qty),
      used_qty: n(r.used_qty),
      waste_qty: n(r.waste_qty),
      closing_qty: r.closing_qty === null ? null : n(r.closing_qty),
      variance_qty: r.variance_qty === null ? null : n(r.variance_qty),
      waste_photo_path: r.waste_photo_path,
    };
  }

  // Opening fallback for subs with no row on `day`: carry the LATEST prior
  // day forward — counted closing wins, else system carry.
  const openingMap: Record<string, number> = {};
  for (const r of (priorRes.data ?? []) as PriorSubRow[]) {
    // rows arrive NEWEST first — the first row seen per recipe is its latest
    if (openingMap[r.recipe_id] !== undefined) continue;
    openingMap[r.recipe_id] =
      r.closing_qty === null || r.closing_qty === undefined
        ? n(r.opening_qty) + n(r.made_qty) - n(r.used_qty) - n(r.waste_qty)
        : n(r.closing_qty);
  }

  // Used fallback for `day`: parent-dish sales × per-portion factor, plus the
  // sub's own direct sales (mirrors the sub_recipe_daily derivation).
  const usedMap: Record<string, number> = {};
  for (const l of links) {
    const sold = soldMap[l.recipe_id] ?? 0;
    if (!sold) continue;
    usedMap[l.sub_recipe_id] =
      (usedMap[l.sub_recipe_id] ?? 0) +
      (sold * n(l.quantity_needed)) / (yieldMap.get(l.recipe_id) ?? 1);
  }
  for (const s of subs) {
    const direct = soldMap[s.id] ?? 0;
    if (direct) usedMap[s.id] = (usedMap[s.id] ?? 0) + direct;
  }

  // Signed URLs (1h) for stored waste photos across both worksheets.
  const photoUrls: Record<string, string> = {};
  const paths = [
    ...new Set([
      ...Object.values(existingDish).map((r) => r.wastage_photo_path),
      ...Object.values(existingSub).map((r) => r.waste_photo_path),
    ]),
  ].filter((p): p is string => !!p);
  if (paths.length > 0) {
    const { data: urls } = await supabase.storage
      .from("wastage-photos")
      .createSignedUrls(paths, 3600);
    for (const u of urls ?? []) {
      if (u.signedUrl && u.path) photoUrls[u.path] = u.signedUrl;
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Operations
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Kitchen Production</span>
      </div>

      <SectionHeader
        eyebrow="Kitchen Management"
        title="Kitchen Production"
        description="Per-department daily worksheet: dishes (prepared / staff meals / wasted / closing) and sub-recipe batches. Sold and Used derive automatically from the day's sales."
      />

      <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-1 rounded-lg bg-[#efe9dd] p-1">
          {departments.map((d) => (
            <Link
              key={d.id}
              href={`/dashboard/admin/kitchen-production?dept=${d.id}&date=${day}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                d.id === deptId
                  ? "bg-white text-neutral-900 shadow-sm"
                  : "text-neutral-600 hover:text-neutral-900"
              }`}
            >
              {d.name}
            </Link>
          ))}
        </div>

        <form method="get" className="flex items-center gap-2">
          <input type="hidden" name="dept" value={deptId} />
          <input
            type="date"
            name="date"
            defaultValue={day}
            max={today}
            className="rounded-lg border border-[#d9d1c1] bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25 [color-scheme:light]"
          />
          <button
            type="submit"
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700"
          >
            Go
          </button>
        </form>
      </div>

      <p className="mt-3 text-sm text-neutral-500">
        Worksheet for <span className="font-medium text-neutral-700">{formatDate(day)}</span>
        {day === today ? " (today)" : ""}.
      </p>

      <div className="mt-5 space-y-8">
        <DishWorksheet
          key={`dish-${deptId}-${day}`}
          locationId={loc}
          departmentId={deptId}
          day={day}
          dishes={dishes}
          existing={existingDish}
          soldMap={soldMap}
          photoUrls={photoUrls}
        />

        <SubRecipeWorksheet
          key={`sub-${deptId}-${day}`}
          locationId={loc}
          day={day}
          subs={subs}
          existing={existingSub}
          openingMap={openingMap}
          usedMap={usedMap}
          photoUrls={photoUrls}
        />
      </div>
    </div>
  );
}
