"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";

export interface CategoryState {
  error?: string;
  success?: string;
  token?: string;
}

export type CategoryKind = "material" | "vendor" | "cuisine";
const KINDS: CategoryKind[] = ["material", "vendor", "cuisine"];

const REVALIDATE = () => {
  revalidatePath("/dashboard/admin/catalog");
  revalidatePath("/dashboard/admin/procurement/vendors");
};

async function home(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.rpc("current_location_id");
  return (data as string | null) ?? null;
}

/** Create a category (material / vendor / cuisine) — admin, home outlet. */
export async function createCategory(
  _prev: CategoryState | undefined,
  fd: FormData,
): Promise<CategoryState> {
  if (!(await isAdmin())) return { error: "Only administrators can manage categories." };

  const kind = String(fd.get("kind") ?? "") as CategoryKind;
  const name = String(fd.get("name") ?? "").trim();
  if (!KINDS.includes(kind)) return { error: "Invalid category type." };
  if (!name) return { error: "Category name is required." };
  if (name.length > 100) return { error: "Name is too long." };

  const supabase = await createClient();
  const loc = await home(supabase);
  if (!loc) return { error: "Your account isn't assigned to a location." };

  // Case-insensitive dupe guard (the unique constraint is exact-match).
  const { data: dupe } = await supabase
    .from("categories")
    .select("id")
    .eq("location_id", loc)
    .eq("kind", kind)
    .ilike("name", name)
    .maybeSingle();
  if (dupe) return { error: `"${name}" already exists (names are case-insensitive).` };

  const { error } = await supabase
    .from("categories")
    .insert({ location_id: loc, kind, name });
  if (error) {
    return {
      error: error.code === "23505" ? `"${name}" already exists.` : error.message,
    };
  }

  REVALIDATE();
  return { success: `Category "${name}" created.`, token: crypto.randomUUID() };
}

/**
 * Rename a category AND resync the denormalised text on its items — the text
 * columns are what every existing view/report/sheet reads, so they must follow.
 */
export async function renameCategory(
  _prev: CategoryState | undefined,
  fd: FormData,
): Promise<CategoryState> {
  if (!(await isAdmin())) return { error: "Only administrators can manage categories." };

  const id = String(fd.get("category_id") ?? "").trim();
  const name = String(fd.get("name") ?? "").trim();
  if (!id) return { error: "Missing category." };
  if (!name) return { error: "Category name is required." };
  if (name.length > 100) return { error: "Name is too long." };

  const supabase = await createClient();
  const loc = await home(supabase);
  if (!loc) return { error: "Your account isn't assigned to a location." };

  const { data: cat } = await supabase
    .from("categories")
    .select("id, kind, name")
    .eq("id", id)
    .eq("location_id", loc)
    .maybeSingle();
  if (!cat) return { error: "Category not found in your location." };

  const { data: dupe } = await supabase
    .from("categories")
    .select("id")
    .eq("location_id", loc)
    .eq("kind", cat.kind as string)
    .ilike("name", name)
    .neq("id", id)
    .maybeSingle();
  if (dupe) return { error: `"${name}" already exists (names are case-insensitive).` };

  const { error } = await supabase
    .from("categories")
    .update({ name })
    .eq("id", id)
    .eq("location_id", loc);
  if (error) return { error: error.message };

  // Resync denormalised item text.
  if (cat.kind === "material") {
    await supabase.from("raw_materials").update({ category: name }).eq("category_id", id).eq("location_id", loc);
  } else if (cat.kind === "vendor") {
    await supabase.from("vendors").update({ category: name }).eq("category_id", id).eq("location_id", loc);
  } else if (cat.kind === "cuisine") {
    await supabase.from("recipes").update({ category: name }).eq("category", cat.name as string).eq("location_id", loc);
  }

  REVALIDATE();
  return { success: `Renamed to "${name}".`, token: crypto.randomUUID() };
}

/**
 * Delete a category. Items keep their text label (FK is ON DELETE SET NULL),
 * so no report/history breaks — the label just stops being a managed choice.
 */
export async function deleteCategory(
  _prev: CategoryState | undefined,
  fd: FormData,
): Promise<CategoryState> {
  if (!(await isAdmin())) return { error: "Only administrators can manage categories." };

  const id = String(fd.get("category_id") ?? "").trim();
  if (!id) return { error: "Missing category." };

  const supabase = await createClient();
  const loc = await home(supabase);
  if (!loc) return { error: "Your account isn't assigned to a location." };

  const { data: deleted, error } = await supabase
    .from("categories")
    .delete()
    .eq("id", id)
    .eq("location_id", loc)
    .select("name");
  if (error) return { error: error.message };
  if (!deleted || deleted.length === 0) return { error: "Category not found in your location." };

  REVALIDATE();
  return { success: `Category "${deleted[0].name}" deleted.`, token: crypto.randomUUID() };
}
