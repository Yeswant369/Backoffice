"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";

const ease = [0.22, 1, 0.36, 1] as const;

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white shadow-inner shadow-black/20 outline-none transition placeholder:text-neutral-600 focus:border-white/25 focus:bg-white/[0.06] focus:ring-2 focus:ring-white/10";
const labelCls =
  "block text-xs font-medium uppercase tracking-wider text-neutral-400";

type Phase = "checking" | "ready" | "no-session" | "expired";

export default function SetPasswordForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Establish the session from the invite link: either the URL hash
  // (#access_token=… implicit flow) or an existing cookie (set by /auth/confirm).
  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const hash =
        typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
      if (hash.includes("error")) {
        setPhase("expired");
        return;
      }
      const params = new URLSearchParams(hash);
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      if (access_token && refresh_token) {
        const { error: sErr } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });
        // Strip tokens from the address bar.
        window.history.replaceState(null, "", window.location.pathname);
        if (sErr) {
          setPhase("expired");
          return;
        }
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        setEmail(user.email ?? "");
        setPhase("ready");
      } else {
        setPhase("no-session");
      }
    })();
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;
    const confirm = (form.elements.namedItem("confirm") as HTMLInputElement).value;
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("Those passwords don't match.");

    setPending(true);
    const supabase = createClient();
    const { error: uErr } = await supabase.auth.updateUser({ password });
    if (uErr) {
      setError(uErr.message);
      setPending(false);
      return;
    }
    // /dashboard routes the user to their role's workspace.
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="relative flex min-h-dvh w-full items-center justify-center overflow-hidden bg-neutral-950 px-4 py-12">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-10%] h-[42rem] w-[42rem] -translate-x-1/2 rounded-full bg-white/[0.05] blur-[120px]" />
        <div className="absolute bottom-[-15%] right-[-5%] h-[30rem] w-[30rem] rounded-full bg-white/[0.04] blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease }}
        className="relative w-full max-w-md"
      >
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl shadow-black/60 backdrop-blur-2xl sm:p-10">
          <div className="mb-8">
            <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/10">
              <span className="text-sm font-semibold tracking-tight text-white">
                BOH
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              Set your password
            </h1>
            <p className="mt-1.5 text-sm text-neutral-400">
              {phase === "ready" && email
                ? `Welcome — ${email}. Choose a password to finish setting up.`
                : "Finish setting up your Back-of-House account."}
            </p>
          </div>

          {phase === "checking" && (
            <p className="flex items-center gap-2 text-sm text-neutral-400">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
              Verifying your invite…
            </p>
          )}

          {phase === "expired" && (
            <div className="space-y-4">
              <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                This invite link is invalid or has expired. Ask your administrator
                to resend the invitation.
              </p>
              <a
                href="/login"
                className="inline-block text-sm text-neutral-400 underline hover:text-white"
              >
                Back to sign in
              </a>
            </div>
          )}

          {phase === "no-session" && (
            <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              Open the invitation link from your email to set your password.
            </p>
          )}

          {phase === "ready" && (
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="password" className={labelCls}>
                  New password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  placeholder="••••••••••••"
                  className={inputCls}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="confirm" className={labelCls}>
                  Confirm password
                </label>
                <input
                  id="confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  placeholder="••••••••••••"
                  className={inputCls}
                />
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={pending}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-neutral-200 focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-neutral-950 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-950/30 border-t-neutral-950" />
                    Saving…
                  </>
                ) : (
                  "Set password & continue"
                )}
              </button>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}
