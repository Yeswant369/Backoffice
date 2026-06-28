"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";

export interface DueState {
  error?: string;
  success?: string;
  token?: string;
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const orNull = (v: string) => (v === "" ? null : v);

async function homeLocation(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  // Home location via rpc — RLS read-scope spans the org for hybrid users.
  const { data } = await supabase.rpc("current_location_id");
  return (data as string | null) ?? null;
}

const todayIST = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(),
  );

/** Record money owed TO the restaurant (an advance / IOU). */
export async function recordDue(
  _prev: DueState | undefined,
  fd: FormData,
): Promise<DueState> {
  if (!(await isAdmin())) return { error: "Only administrators can record dues." };

  const person_name = str(fd, "person_name");
  const amount = Number(str(fd, "amount"));
  if (!person_name) return { error: "Person name is required." };
  if (!(amount > 0)) return { error: "Amount must be greater than zero." };

  const supabase = await createClient();
  const loc = await homeLocation(supabase);
  if (!loc) return { error: "Your account isn't assigned to a location." };

  const { error } = await supabase.from("dues").insert({
    person_name,
    amount,
    reason: orNull(str(fd, "reason")),
    linked_date: orNull(str(fd, "linked_date")),
    notes: orNull(str(fd, "notes")),
    location_id: loc,
  });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin/dues");
  return {
    success: `Recorded ₹${amount} due from ${person_name}.`,
    token: crypto.randomUUID(),
  };
}

/**
 * Record a settlement PAYMENT against a due. The payment is ADDED to any prior
 * settled amount (so two partial payments accumulate) and capped at the owed
 * amount — never overwrites, never reduces, so money already recorded can't be
 * lost. Once fully settled, date_settled is stamped (IST).
 */
export async function settleDue(
  id: string,
  payment: number,
  mode: string,
): Promise<DueState> {
  if (!(await isAdmin())) return { error: "Only administrators can settle dues." };
  if (!id) return { error: "Missing due." };
  if (!(payment > 0)) return { error: "Settlement amount must be greater than zero." };

  const supabase = await createClient();
  const loc = await homeLocation(supabase);
  if (!loc) return { error: "Your account isn't assigned to a location." };

  // Re-validate the due against the caller's location before mutating.
  const { data: due } = await supabase
    .from("dues")
    .select("amount, settled_amount")
    .eq("id", id)
    .eq("location_id", loc)
    .maybeSingle();
  if (!due) return { error: "Due not found." };

  const amt = Number(due.amount);
  const prior = Number(due.settled_amount);
  const newSettled = Math.min(amt, prior + payment); // additive, capped at owed
  const fullySettled = newSettled >= amt;

  const { error } = await supabase
    .from("dues")
    .update({
      settled_amount: newSettled,
      settled_mode: orNull(mode),
      date_settled: fullySettled ? todayIST() : null,
    })
    .eq("id", id)
    .eq("location_id", loc);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin/dues");
  return {
    success: fullySettled
      ? "Marked settled."
      : `Recorded ₹${payment} — ₹${(amt - newSettled).toFixed(0)} still outstanding.`,
  };
}
