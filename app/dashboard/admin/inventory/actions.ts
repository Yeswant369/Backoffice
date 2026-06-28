"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserAndRoles } from "@/lib/auth";

export interface ActionState {
  error?: string;
  success?: string;
  token?: string;
}

async function locationId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const { data } = await supabase.from("locations").select("id").maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Internal departmental transfer → immutable inventory_ledger row
 * (type INTER_DEPARTMENT_TRANSFER), debiting `from` and crediting `to`.
 * Validates that quantity does not exceed current stock in the source
 * department. UI triggers the sheet sync on success.
 */
export async function issueStock(
  _prev: ActionState | undefined,
  fd: FormData,
): Promise<ActionState> {
  const { user, roles } = await getCurrentUserAndRoles();
  if (!user || !(roles.includes(1) || roles.includes(2) || roles.includes(3))) {
    return { error: "You are not authorized to issue stock." };
  }

  const raw_material_id = str(fd, "raw_material_id");
  const fromId = Number(fd.get("from_department_id") ?? 0);
  const toId = Number(fd.get("to_department_id") ?? 0);
  const quantity = Number(fd.get("quantity") ?? 0);

  if (!raw_material_id) return { error: "Select a raw material." };
  if (!fromId) return { error: "Select a source department." };
  if (!toId) return { error: "Select a destination department." };
  if (fromId === toId) return { error: "Source and destination must differ." };
  if (!(quantity > 0)) return { error: "Quantity must be greater than zero." };

  const supabase = await createClient();
  const loc = await locationId(supabase);
  if (!loc) return { error: "Your account isn't assigned to a location." };

  // Server-side guard: never issue more than is on hand in the source dept.
  const { data: stockRow } = await supabase
    .from("live_stock")
    .select("current_stock")
    .eq("raw_material_id", raw_material_id)
    .eq("department_id", fromId)
    .maybeSingle();
  const available = Number(stockRow?.current_stock ?? 0);
  if (quantity > available) {
    return {
      error: `Only ${available} available in the source department.`,
    };
  }

  const { error } = await supabase.from("inventory_ledger").insert({
    raw_material_id,
    from_department_id: fromId,
    to_department_id: toId,
    type: "INTER_DEPARTMENT_TRANSFER",
    quantity,
    location_id: loc,
    created_by: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin/inventory/issue-stock");
  revalidatePath("/dashboard/admin/inventory/live-stock");
  return { success: "Stock issued and recorded in the ledger.", token: crypto.randomUUID() };
}

function str(fd: FormData, key: string) {
  return String(fd.get(key) ?? "").trim();
}
