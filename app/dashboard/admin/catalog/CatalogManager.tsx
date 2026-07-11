"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import MaterialPanel from "./MaterialPanel";
import RecipePanel from "./RecipePanel";
import type { CategoryOption, MaterialRow, RecipeRow, VendorRow } from "./types";

const ease = [0.22, 1, 0.36, 1] as const;

const TABS = [
  { key: "materials", label: "Raw Materials" },
  { key: "recipes", label: "Recipes" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

interface Props {
  vendors: VendorRow[];
  materials: MaterialRow[];
  recipes: RecipeRow[];
  /** Per-recipe plate cost (recipe_cogs) — powers sub-recipe line pricing. */
  recipeUnitCosts: Record<string, number>;
  departments: { id: number; name: string }[];
  /** Managed categories, home-pinned. Vendor/cuisine lists are threaded for
      the panels that consume them. */
  materialCategories: CategoryOption[];
  vendorCategories: CategoryOption[];
  cuisineCategories: CategoryOption[];
  sheetUrl: string;
  connected: boolean;
  initialTab?: TabKey;
}

export default function CatalogManager({
  vendors,
  materials,
  recipes,
  recipeUnitCosts,
  departments,
  materialCategories,
  cuisineCategories,
  sheetUrl,
  connected,
  initialTab,
}: Props) {
  const [tab, setTab] = useState<TabKey>(initialTab ?? "materials");

  const vendorOptions = useMemo(
    () => vendors.map((v) => ({ id: v.id, vendor_code: v.vendor_code, name: v.name })),
    [vendors],
  );
  const materialOptions = useMemo(
    () =>
      materials.map((m) => ({
        id: m.id,
        name: m.name,
        code: m.code,
        stock_unit: m.stock_unit,
        brand: m.brand,
        weighted_avg_cost: m.weighted_avg_cost,
      })),
    [materials],
  );

  return (
    <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-2">
      <div className="flex gap-1 rounded-lg bg-[#efe9dd] p-1">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
                active ? "text-neutral-950" : "text-neutral-600 hover:text-neutral-900"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="catalog-tab"
                  className="absolute inset-0 rounded-lg bg-white shadow-sm"
                  transition={{ duration: 0.3, ease }}
                />
              )}
              <span className="relative z-10">{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="p-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.25, ease }}
          >
            {tab === "materials" && (
              <MaterialPanel
                materials={materials}
                vendors={vendorOptions}
                materialCategories={materialCategories}
                connected={connected}
                sheetUrl={sheetUrl}
              />
            )}
            {tab === "recipes" && (
              <RecipePanel
                recipes={recipes}
                materials={materialOptions}
                subRecipes={recipes.map((r) => ({
                  id: r.id,
                  name: r.name,
                  unit_cost: recipeUnitCosts[r.id] ?? 0,
                }))}
                departments={departments}
                cuisineCategories={cuisineCategories}
                sheetUrl={sheetUrl}
                connected={connected}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
