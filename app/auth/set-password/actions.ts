"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { homeRouteForRoles, normalizeRoles } from "@/lib/roles";

export interface SetPasswordState {
  error?: string;
}

/**
 * Set the password for the just-invited user (their session was established by
 * /auth/confirm via verifyOtp), then route them to their workspace.
 */
export async function setPassword(
  _prev: SetPasswordState | undefined,
  formData: FormData,
): Promise<SetPasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    return { error: "Use at least 8 characters." };
  }
  if (password !== confirm) {
    return { error: "Those passwords don't match." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Your link has expired — ask your administrator to re-send the invite." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  const { data: profile } = await supabase
    .from("profiles")
    .select("roles")
    .eq("id", user.id)
    .single();

  // redirect() throws internally — must be outside any try/catch.
  redirect(homeRouteForRoles(normalizeRoles(profile?.roles)));
}
