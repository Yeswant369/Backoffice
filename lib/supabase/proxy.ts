import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session on every request and performs optimistic,
 * role-based route guarding for the `/dashboard/*` tree.
 *
 * This is invoked from the root `proxy.ts` (Next.js 16's renamed Middleware).
 * Per Next.js guidance this is an *optimistic* check for fast redirects — the
 * authoritative authorization happens again in the dashboard Server Components.
 */
export async function updateSession(request: NextRequest) {
  // Mutable so `setAll` can rebuild it with refreshed auth cookies.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: getUser() must run immediately after createServerClient with no
  // intervening logic, so the session is validated/refreshed reliably.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isDashboard = pathname.startsWith("/dashboard");
  const isLogin = pathname === "/login";

  // Build a redirect that carries over any refreshed auth cookies.
  const redirectTo = (path: string, params?: Record<string, string>) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  // Unauthenticated: gate the dashboard, leave public routes alone.
  if (!user) {
    if (isDashboard) {
      return redirectTo("/login", { redirectedFrom: pathname });
    }
    return response;
  }

  // Authenticated. We deliberately do NOT query `profiles` here — that DB
  // round-trip ran on EVERY navigation and dominated click-to-render latency.
  // Role-based access is enforced authoritatively by the dashboard layout (which
  // renders only permitted nav) and each page's own guard (e.g. isAdmin); the
  // proxy stays a cheap, optimistic session refresh + operator/login routing.
  const platformEmails = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const isPlatformOperator =
    !!user.email && platformEmails.includes(user.email.toLowerCase());

  // Platform operators (SaaS vendor) live in the console, not a tenant workspace.
  if (isPlatformOperator) {
    if (isLogin || isDashboard) return redirectTo("/platform");
    return response;
  }

  // Signed-in tenant user on /login → /dashboard, which forwards to their
  // highest-privilege home (that index route reads roles once — not per click).
  if (isLogin) return redirectTo("/dashboard");

  return response;
}
