"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import LiveStockTable from "../store/LiveStockTable";
import SimulateSaleForm from "./SimulateSaleForm";
import WastageForm from "./WastageForm";
import type { LiveStockRow, RawMaterialOption, RecipeOption } from "./types";

const ease = [0.22, 1, 0.36, 1] as const;

const TABS = [
  { key: "sale", label: "Simulate Sale" },
  { key: "wastage", label: "Log Wastage" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

interface Props {
  initialStock: LiveStockRow[];
  recipes: RecipeOption[];
  materials: RawMaterialOption[];
  kitchenDeptId: number;
}

export default function KitchenDashboard({
  initialStock,
  recipes,
  materials,
  kitchenDeptId,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [stock, setStock] = useState<LiveStockRow[]>(initialStock);
  const [live, setLive] = useState(false);
  const [tab, setTab] = useState<TabKey>("sale");

  // Only the Kitchen department's stock is relevant on this page.
  const kitchenStock = useMemo(
    () => stock.filter((s) => s.department_id === kitchenDeptId),
    [stock, kitchenDeptId],
  );

  const refreshStock = useCallback(async () => {
    const { data } = await supabase
      .from("live_stock")
      .select("*")
      .order("raw_material_name");
    if (data) setStock(data as LiveStockRow[]);
  }, [supabase]);

  useEffect(() => {
    const channel = supabase
      .channel("kitchen-live-stock")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory_ledger" },
        () => {
          refreshStock();
        },
      )
      .subscribe((status) => {
        setLive(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, refreshStock]);

  return (
    <div className="space-y-8">
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
                    layoutId="kitchen-tab"
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
              {tab === "sale" && (
                <SimulateSaleForm supabase={supabase} recipes={recipes} />
              )}
              {tab === "wastage" && (
                <WastageForm
                  supabase={supabase}
                  materials={materials}
                  kitchenDeptId={kitchenDeptId}
                  stock={stock}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <LiveStockTable stock={kitchenStock} live={live} />
    </div>
  );
}
