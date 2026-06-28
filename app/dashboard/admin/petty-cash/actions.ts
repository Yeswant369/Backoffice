"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserAndRoles, isAdmin } from "@/lib/auth";

export interface PettyState {
  error?: string;
  success?: string;
  token?: string;
}

/** Log a petty-cash expense (admin), pinned to the caller's home location. */
export async function recordPettyCash(
  _prev: PettyState | undefined,
  fd: FormData,
): Promise<PettyState> {
  const { user } = await getCurrentUserAndRoles();
  if (!user || !(await isAdmin())) {
    return { error: "Only administrators can log expenses." };
  }

  const amount = Number(fd.get("amount") ?? 0);
  const category = String(fd.get("category") ?? "").trim();
  const description = String(fd.get("description") ?? "").trim();
  const date = String(fd.get("date") ?? "").trim();

  if (!(amount > 0)) return { error: "Amount must be greater than zero." };
  if (!category) return { error: "Category is required." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Select a valid date." };

  const supabase = await createClient();
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? null;
  if (!loc) return { error: "Your account isn't assigned to a location." };

  const { error } = await supabase.from("petty_cash_expenses").insert({
    amount,
    category,
    description: description || null,
    date,
    logged_by: user.id,
    location_id: loc,
  });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin/petty-cash");
  return {
    success: `Logged ${"₹"}${amount} (${category}).`,
    token: crypto.randomUUID(),
  };
}
