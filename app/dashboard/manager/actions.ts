"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserAndRoles } from "@/lib/auth";
import { ROLES, type RoleId } from "@/lib/roles";

export interface ActionState {
  error?: string;
  success?: string;
  /** Unique per success — lets forms reset reliably on EVERY submit. */
  token?: string;
}

const MANAGERIAL: RoleId[] = [ROLES.ADMIN, ROLES.MANAGER];

async function authorize() {
  const { user, roles } = await getCurrentUserAndRoles();
  if (!user || !roles.some((r) => MANAGERIAL.includes(r))) return null;
  return user;
}

/** Log a petty cash expense, stamped with the current user as `logged_by`. */
export async function logPettyCash(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const user = await authorize();
  if (!user) return { error: "You are not authorized to log expenses." };

  const amount = Number(formData.get("amount") ?? 0);
  const category = String(formData.get("category") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();

  if (!(amount > 0)) return { error: "Amount must be greater than zero." };
  if (!category) return { error: "Category is required." };
  if (!date) return { error: "Date is required." };

  const supabase = await createClient();
  const { error } = await supabase.from("petty_cash_expenses").insert({
    amount,
    category,
    description: description || null,
    date,
    logged_by: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath("/dashboard/manager");
  return { success: `Logged ${category} expense.`, token: crypto.randomUUID() };
}

/**
 * Log a manual sale. Inserting into manual_sales_log fires the Phase 5 trigger,
 * which deducts the recipe's ingredients from Kitchen stock.
 */
export async function logSale(
  _prev: ActionState | undefined,
  formData: FormData,
): Promise<ActionState> {
  const user = await authorize();
  if (!user) return { error: "You are not authorized to log sales." };

  const recipeId = String(formData.get("recipe_id") ?? "");
  const quantitySold = Math.floor(Number(formData.get("quantity_sold") ?? 0));
  const saleDate = String(formData.get("sale_date") ?? "").trim();

  if (!recipeId) return { error: "Select a dish." };
  if (!(quantitySold > 0)) return { error: "Quantity must be at least 1." };
  if (!saleDate) return { error: "Date is required." };

  const supabase = await createClient();
  const { error } = await supabase.from("manual_sales_log").insert({
    recipe_id: recipeId,
    quantity_sold: quantitySold,
    sale_date: saleDate,
  });

  if (error) return { error: error.message };

  revalidatePath("/dashboard/manager");
  return { success: `Logged ${quantitySold} sale(s). Kitchen stock deducted.`, token: crypto.randomUUID() };
}
