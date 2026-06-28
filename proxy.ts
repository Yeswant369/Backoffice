import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Next.js 16 Proxy (formerly Middleware). Runs on every matched request to
 * refresh the Supabase session and guard `/dashboard/*` by role.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on all paths EXCEPT:
     *  - _next/static & _next/image (build assets / image optimizer)
     *  - favicon.ico and common static image files in /public
     * Excluding these prevents auth logic from blocking CSS/JS/images.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
