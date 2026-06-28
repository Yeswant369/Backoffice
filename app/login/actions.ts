"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { homeRouteForRoles, normalizeRoles } from "@/lib/roles";

export interface LoginState {
  error?: string;
}

/**
 * Server Action: authenticate with email + password, then route the user to
 * the dashboard section matching their highest-privilege role.
 */
export async function login(
  _prevState: LoginState | undefined,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Please enter both your email and password." };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    // Deliberately generic to avoid leaking which field was wrong.
    return { error: "Invalid credentials. Please try again." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("roles")
    .eq("id", data.user.id)
    .single();

  const roles = normalizeRoles(profile?.roles);

  // Platform operators (SaaS vendor) have no tenant workspace — route them to
  // the provisioning console rather than a tenant dashboard / no-access.
  const operatorEmails = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const isOperator =
    !!data.user.email && operatorEmails.includes(data.user.email.toLowerCase());

  // redirect() throws internally — must be outside any try/catch.
  redirect(isOperator ? "/platform" : homeRouteForRoles(roles));
}
