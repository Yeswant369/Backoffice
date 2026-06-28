"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { hasAnyRole } from "@/lib/auth";
import { ROLES } from "@/lib/roles";

export interface ReconciliationState {
  error?: string;
  success?: string;
}

/**
 * Upsert a daily sales reconciliation row. (location_id, date) is UNIQUE, so
 * re-saving the same day for this location overwrites that day's figures
 * (correcting an entry) rather than erroring on the conflict.
 */
export async function logReconciliation(
  _prevState: ReconciliationState | undefined,
  formData: FormData,
): Promise<ReconciliationState> {
  if (!(await hasAnyRole([ROLES.ADMIN, ROLES.MANAGER]))) {
    return { error: "You are not authorized to log reconciliation." };
  }

  const date = String(formData.get("date") ?? "").trim();
  if (!date) return { error: "Date is required." };

  const num = (key: string) => {
    const n = Number(formData.get(key) ?? 0);
    return Number.isFinite(n) ? n : 0;
  };

  const row = {
    date,
    dine_in_gross: num("dine_in_gross"),
    zomato_gross: num("zomato_gross"),
    swiggy_gross: num("swiggy_gross"),
    cash_collected: num("cash_collected"),
    upi_collected: num("upi_collected"),
    card_collected: num("card_collected"),
    aggregator_commissions: num("aggregator_commissions"),
    actual_bank_deposit: num("actual_bank_deposit"),
  };

  const supabase = await createClient();
  const { data: loc } = await supabase.from("locations").select("id").maybeSingle();
  if (!loc?.id) return { error: "Your account isn't assigned to a location." };

  const { error } = await supabase
    .from("daily_sales_reconciliation")
    .upsert(
      { ...row, location_id: loc.id as string },
      { onConflict: "location_id,date" },
    );

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/manager");
  return { success: `Reconciliation saved for ${date}.` };
}
