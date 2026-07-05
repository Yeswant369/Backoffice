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
  // Home location via rpc — an unfiltered locations.maybeSingle() ERRORS for
  // hybrid Admin+Owner users (their RLS read scope returns every outlet).
  const { data } = await supabase.rpc("current_location_id");
  return (data as string | null) ?? null;
}

function str(fd: FormData, key: string) {
  return String(fd.get(key) ?? "").trim();
}

interface IssueLine {
  raw_material_id: string;
  quantity: number;
}

/**
 * Multi-line dated issue: move several materials from one department to
 * another in a single submission (one immutable ledger row per line, all
 * stamped with the chosen business date). Validates every line against the
 * source department's CURRENT stock (duplicates aggregated first).
 */
export async function issueStockBatch(
  _prev: ActionState | undefined,
  fd: FormData,
): Promise<ActionState> {
  const { user, roles } = await getCurrentUserAndRoles();
  if (!user || !(roles.includes(1) || roles.includes(2) || roles.includes(3))) {
    return { error: "You are not authorized to issue stock." };
  }

  const fromId = Number(fd.get("from_department_id") ?? 0);
  const toId = Number(fd.get("to_department_id") ?? 0);
  const issue_date = str(fd, "issue_date");
  if (!fromId) return { error: "Select a source department." };
  if (!toId) return { error: "Select a destination department." };
  if (fromId === toId) return { error: "Source and destination must differ." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issue_date)) return { error: "Select a valid issue date." };
  const todayIST = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  if (issue_date > todayIST) return { error: "Issue date cannot be in the future." };
  if (issue_date < "2000-01-01") return { error: "Issue date looks wrong." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(str(fd, "lines"));
  } catch {
    return { error: "Invalid line items." };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { error: "Add at least one line item." };
  }
  if (parsed.length > 100) return { error: "Too many lines in one issue." };
  const lines: IssueLine[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") return { error: "Invalid line items." };
    const l = raw as Record<string, unknown>;
    const raw_material_id = typeof l.raw_material_id === "string" ? l.raw_material_id : "";
    const quantity = Number(l.quantity);
    if (!raw_material_id) return { error: "Every line needs a material." };
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity >= 1e10) {
      return { error: "Every quantity must be a number greater than zero." };
    }
    lines.push({ raw_material_id, quantity });
  }

  const supabase = await createClient();
  const loc = await locationId(supabase);
  if (!loc) return { error: "Your account isn't assigned to a location." };

  // Both departments must belong to this outlet.
  const { data: depts } = await supabase
    .from("departments")
    .select("id")
    .in("id", [fromId, toId])
    .eq("location_id", loc);
  if ((depts ?? []).length !== 2) {
    return { error: "Department not found in your location." };
  }

  // Materials must belong to this outlet.
  const ids = [...new Set(lines.map((l) => l.raw_material_id))];
  const { data: mats } = await supabase
    .from("raw_materials")
    .select("id, name")
    .in("id", ids)
    .eq("location_id", loc);
  if ((mats ?? []).length !== ids.length) {
    return { error: "One or more materials weren't found in your location." };
  }
  const nameById = new Map((mats ?? []).map((m) => [m.id as string, m.name as string]));

  // Aggregate duplicate materials, then guard each against source stock.
  const wanted = new Map<string, number>();
  for (const l of lines) {
    wanted.set(l.raw_material_id, (wanted.get(l.raw_material_id) ?? 0) + l.quantity);
  }
  const { data: stockRows } = await supabase
    .from("live_stock")
    .select("raw_material_id, current_stock")
    .eq("location_id", loc)
    .eq("department_id", fromId)
    .in("raw_material_id", ids);
  const available = new Map(
    (stockRows ?? []).map((s) => [s.raw_material_id as string, Number(s.current_stock ?? 0)]),
  );
  for (const [matId, qty] of wanted) {
    const have = available.get(matId) ?? 0;
    if (qty > have) {
      return {
        error: `Only ${have} of ${nameById.get(matId) ?? "that material"} available in the source department.`,
      };
    }
  }

  const { error } = await supabase.from("inventory_ledger").insert(
    lines.map((l) => ({
      raw_material_id: l.raw_material_id,
      from_department_id: fromId,
      to_department_id: toId,
      type: "INTER_DEPARTMENT_TRANSFER" as const,
      quantity: l.quantity,
      transaction_date: issue_date,
      location_id: loc,
      created_by: user.id,
    })),
  );
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin/inventory/issue-stock");
  revalidatePath("/dashboard/admin/inventory/live-stock");
  return {
    success: `Issued ${lines.length} item(s).`,
    token: crypto.randomUUID(),
  };
}

/**
 * Record wastage for ANY department (the kitchen dashboard form is
 * kitchen-pinned) — one dated, immutable WASTAGE ledger row.
 */
export async function recordDeptWastage(
  _prev: ActionState | undefined,
  fd: FormData,
): Promise<ActionState> {
  const { user, roles } = await getCurrentUserAndRoles();
  if (!user || !(roles.includes(1) || roles.includes(2) || roles.includes(3) || roles.includes(4))) {
    return { error: "You are not authorized to record wastage." };
  }

  const raw_material_id = str(fd, "raw_material_id");
  const departmentId = Number(fd.get("department_id") ?? 0);
  const quantity = Number(fd.get("quantity") ?? 0);
  const reason = str(fd, "reason");
  const waste_date = str(fd, "waste_date");
  if (!raw_material_id) return { error: "Select a raw material." };
  if (!departmentId) return { error: "Select a department." };
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity >= 1e10) {
    return { error: "Quantity must be a number greater than zero." };
  }
  if (!reason) return { error: "Give a wastage reason." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(waste_date)) return { error: "Select a valid date." };
  const todayIST = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  if (waste_date > todayIST) return { error: "Wastage date cannot be in the future." };
  if (waste_date < "2000-01-01") return { error: "Wastage date looks wrong." };

  const supabase = await createClient();
  const loc = await locationId(supabase);
  if (!loc) return { error: "Your account isn't assigned to a location." };

  const [{ data: dept }, { data: mat }] = await Promise.all([
    supabase
      .from("departments")
      .select("id")
      .eq("id", departmentId)
      .eq("location_id", loc)
      .maybeSingle(),
    supabase
      .from("raw_materials")
      .select("id")
      .eq("id", raw_material_id)
      .eq("location_id", loc)
      .maybeSingle(),
  ]);
  if (!dept) return { error: "Department not found in your location." };
  if (!mat) return { error: "Raw material not found in your location." };

  // Same on-hand guard as issuing — wasting more than the department holds
  // would drive live stock negative.
  const { data: stockRow } = await supabase
    .from("live_stock")
    .select("current_stock")
    .eq("location_id", loc)
    .eq("raw_material_id", raw_material_id)
    .eq("department_id", departmentId)
    .maybeSingle();
  const onHand = Number(stockRow?.current_stock ?? 0);
  if (quantity > onHand) {
    return { error: `Only ${onHand} on hand in that department.` };
  }

  const { error } = await supabase.from("inventory_ledger").insert({
    raw_material_id,
    from_department_id: departmentId,
    to_department_id: null,
    type: "WASTAGE",
    quantity,
    wastage_reason: reason,
    transaction_date: waste_date,
    location_id: loc,
    created_by: user.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin/inventory/live-stock");
  revalidatePath("/dashboard/admin/departments");
  return { success: "Wastage recorded.", token: crypto.randomUUID() };
}
