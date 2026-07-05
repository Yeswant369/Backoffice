"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";

export interface DeptState {
  error?: string;
  success?: string;
  token?: string;
}

/**
 * "Store" and "Kitchen" are ANCHOR departments: purchases post into the dept
 * matching ilike 'store', and POS/manual-sale depletion posts from the dept
 * matching ilike 'kitchen'. Renaming them away silently breaks purchasing and
 * POS stock depletion, so those renames are blocked (a pure case/spacing change
 * that still matches the anchor is allowed).
 */
const anchorOf = (name: string): "store" | "kitchen" | null => {
  const n = name.trim().toLowerCase();
  return n === "store" ? "store" : n === "kitchen" ? "kitchen" : null;
};

/** Create a department in the caller's outlet (unique name per outlet). */
export async function createDepartment(
  _prev: DeptState | undefined,
  fd: FormData,
): Promise<DeptState> {
  if (!(await isAdmin())) return { error: "Only administrators can manage departments." };

  const name = String(fd.get("name") ?? "").trim();
  if (!name) return { error: "Department name is required." };
  if (name.length > 100) return { error: "Name is too long." };

  const supabase = await createClient();
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? null;
  if (!loc) return { error: "Your account isn't assigned to a location." };

  // Case-insensitive uniqueness: the DB constraint is exact-match, but the
  // Store/Kitchen anchor lookups use ilike + maybeSingle — a second case
  // variant ("KITCHEN") would make those lookups ERROR and break purchasing
  // and POS depletion for the whole outlet.
  const { data: dupe } = await supabase
    .from("departments")
    .select("id")
    .eq("location_id", loc)
    .ilike("name", name)
    .maybeSingle();
  if (dupe) return { error: `A department called "${name}" already exists (names are case-insensitive).` };

  const { error } = await supabase
    .from("departments")
    .insert({ name, location_id: loc });
  if (error) {
    return {
      error:
        error.code === "23505"
          ? `A department called "${name}" already exists.`
          : error.message,
    };
  }

  revalidatePath("/dashboard/admin/departments");
  return { success: `Department "${name}" created.`, token: crypto.randomUUID() };
}

/** Rename a department (home-pinned; deletes are deliberately not offered —
 *  a department with ledger history must stay for the audit trail). */
export async function renameDepartment(
  _prev: DeptState | undefined,
  fd: FormData,
): Promise<DeptState> {
  if (!(await isAdmin())) return { error: "Only administrators can manage departments." };

  const id = Number(fd.get("department_id") ?? 0);
  const name = String(fd.get("name") ?? "").trim();
  if (!id) return { error: "Missing department." };
  if (!name) return { error: "Department name is required." };
  if (name.length > 100) return { error: "Name is too long." };

  const supabase = await createClient();
  const { data: home } = await supabase.rpc("current_location_id");
  const loc = (home as string | null) ?? null;
  if (!loc) return { error: "Your account isn't assigned to a location." };

  // Anchor guard: renaming Store/Kitchen away breaks the by-name lookups that
  // route purchases (→ Store) and POS depletion (← Kitchen).
  const { data: current } = await supabase
    .from("departments")
    .select("id, name")
    .eq("id", id)
    .eq("location_id", loc)
    .maybeSingle();
  if (!current) return { error: "Department not found in your location." };
  const fromAnchor = anchorOf(current.name as string);
  if (fromAnchor && anchorOf(name) !== fromAnchor) {
    return {
      error: `"${current.name}" is a system department — purchases and POS stock depletion are routed to it by name, so it can't be renamed.`,
    };
  }

  // Case-insensitive dupe guard (see createDepartment).
  const { data: dupe } = await supabase
    .from("departments")
    .select("id")
    .eq("location_id", loc)
    .ilike("name", name)
    .neq("id", id)
    .maybeSingle();
  if (dupe) return { error: `A department called "${name}" already exists (names are case-insensitive).` };

  const { data: updated, error } = await supabase
    .from("departments")
    .update({ name })
    .eq("id", id)
    .eq("location_id", loc)
    .select("id");
  if (error) {
    return {
      error:
        error.code === "23505"
          ? `A department called "${name}" already exists.`
          : error.message,
    };
  }
  if (!updated || updated.length === 0) {
    return { error: "Department not found in your location." };
  }

  revalidatePath("/dashboard/admin/departments");
  return { success: `Renamed to "${name}".`, token: crypto.randomUUID() };
}
