"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_LOCATION_COOKIE } from "@/lib/location";

/** Server Action: securely sign the user out and return them to the login screen. */
export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Server Action: focus the dashboard on one outlet ("all" = every visible
 * outlet). The value is re-validated against RLS-visible locations on read
 * (see getActiveLocation), so this only ever narrows what the user already sees.
 */
export async function setActiveLocation(value: string) {
  // Directly invocable — require a session before writing the cookie. (Read-side
  // validation in getActiveLocation already prevents any access widening.)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const store = await cookies();
  store.set(ACTIVE_LOCATION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/dashboard");
}
