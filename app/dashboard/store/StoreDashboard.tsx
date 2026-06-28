"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import LiveStockTable from "./LiveStockTable";
import LogPurchaseForm from "./LogPurchaseForm";
import IssueForm from "./IssueForm";
import VendorPaymentForm from "./VendorPaymentForm";
import type {
  DepartmentOption,
  LiveStockRow,
  RawMaterialOption,
  VendorOption,
} from "./types";

const ease = [0.22, 1, 0.36, 1] as const;

const TABS = [
  { key: "purchase", label: "Log Purchase" },
  { key: "issue", label: "Issue to Dept" },
  { key: "payment", label: "Vendor Payment" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

interface Props {
  initialStock: LiveStockRow[];
  vendors: VendorOption[];
  materials: RawMaterialOption[];
  departments: DepartmentOption[];
  storeDeptId: number;
}

export default function StoreDashboard({
  initialStock,
  vendors,
  materials,
  departments,
  storeDeptId,
}: Props) {
  // One browser client for the whole dashboard (forms + realtime).
  const supabase = useMemo(() => createClient(), []);
  const [stock, setStock] = useState<LiveStockRow[]>(initialStock);
  const [live, setLive] = useState(false);
  const [tab, setTab] = useState<TabKey>("purchase");

  const targetDepartments = useMemo(
    () => departments.filter((d) => d.id !== storeDeptId),
    [departments, storeDeptId],
  );

  // Re-query the aggregated live_stock view (cheaper than recomputing client-side).
  const refreshStock = useCallback(async () => {
    const { data } = await supabase
      .from("live_stock")
      .select("*")
      .order("raw_material_name");
    if (data) setStock(data as LiveStockRow[]);
  }, [supabase]);

  // Subscribe to ledger changes so the table updates instantly.
  useEffect(() => {
    const channel = supabase
      .channel("store-live-stock")
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
      {/* Action panel */}
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
                    layoutId="store-tab"
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
              {tab === "purchase" && (
                <LogPurchaseForm
                  supabase={supabase}
                  materials={materials}
                  vendors={vendors}
                  storeDeptId={storeDeptId}
                />
              )}
              {tab === "issue" && (
                <IssueForm
                  supabase={supabase}
                  materials={materials}
                  targetDepartments={targetDepartments}
                  storeDeptId={storeDeptId}
                  stock={stock}
                />
              )}
              {tab === "payment" && (
                <VendorPaymentForm supabase={supabase} vendors={vendors} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Live stock */}
      <LiveStockTable stock={stock} live={live} />
    </div>
  );
}
