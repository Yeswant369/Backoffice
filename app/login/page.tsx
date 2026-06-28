"use client";

import { useActionState } from "react";
import { motion } from "framer-motion";
import { login, type LoginState } from "./actions";

const ease = [0.22, 1, 0.36, 1] as const;

export default function LoginPage() {
  const [state, formAction, pending] = useActionState<
    LoginState | undefined,
    FormData
  >(login, undefined);

  return (
    <div className="relative flex min-h-dvh w-full items-center justify-center overflow-hidden bg-neutral-950 px-4 py-12">
      {/* Ambient monochrome backdrop */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-10%] h-[42rem] w-[42rem] -translate-x-1/2 rounded-full bg-white/[0.05] blur-[120px]" />
        <div className="absolute bottom-[-15%] right-[-5%] h-[30rem] w-[30rem] rounded-full bg-white/[0.04] blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage:
              "radial-gradient(ellipse 70% 60% at 50% 40%, black 30%, transparent 80%)",
          }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease }}
        className="relative w-full max-w-md"
      >
        {/* Glass card */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl shadow-black/60 backdrop-blur-2xl sm:p-10">
          <motion.div
            initial="hidden"
            animate="show"
            variants={{
              hidden: {},
              show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
            }}
          >
            <motion.div
              variants={{
                hidden: { opacity: 0, y: 12 },
                show: { opacity: 1, y: 0, transition: { duration: 0.5, ease } },
              }}
              className="mb-8"
            >
              <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/10">
                <span className="text-sm font-semibold tracking-tight text-white">
                  BOH
                </span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-white">
                Welcome back
              </h1>
              <p className="mt-1.5 text-sm text-neutral-400">
                Sign in to the Back-of-House control system.
              </p>
            </motion.div>

            <form action={formAction} className="space-y-5">
              <motion.div
                variants={{
                  hidden: { opacity: 0, y: 12 },
                  show: {
                    opacity: 1,
                    y: 0,
                    transition: { duration: 0.5, ease },
                  },
                }}
                className="space-y-2"
              >
                <label
                  htmlFor="email"
                  className="block text-xs font-medium uppercase tracking-wider text-neutral-400"
                >
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@restaurant.com"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white shadow-inner shadow-black/20 outline-none transition placeholder:text-neutral-600 focus:border-white/25 focus:bg-white/[0.06] focus:ring-2 focus:ring-white/10"
                />
              </motion.div>

              <motion.div
                variants={{
                  hidden: { opacity: 0, y: 12 },
                  show: {
                    opacity: 1,
                    y: 0,
                    transition: { duration: 0.5, ease },
                  },
                }}
                className="space-y-2"
              >
                <label
                  htmlFor="password"
                  className="block text-xs font-medium uppercase tracking-wider text-neutral-400"
                >
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="••••••••••••"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white shadow-inner shadow-black/20 outline-none transition placeholder:text-neutral-600 focus:border-white/25 focus:bg-white/[0.06] focus:ring-2 focus:ring-white/10"
                />
              </motion.div>

              {state?.error && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300"
                  role="alert"
                >
                  {state.error}
                </motion.p>
              )}

              <motion.div
                variants={{
                  hidden: { opacity: 0, y: 12 },
                  show: {
                    opacity: 1,
                    y: 0,
                    transition: { duration: 0.5, ease },
                  },
                }}
              >
                <button
                  type="submit"
                  disabled={pending}
                  className="group relative flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-neutral-200 focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-neutral-950 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pending ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-950/30 border-t-neutral-950" />
                      Signing in…
                    </>
                  ) : (
                    "Sign in"
                  )}
                </button>
              </motion.div>
            </form>
          </motion.div>
        </div>

        <p className="mt-6 text-center text-xs text-neutral-600">
          Authorized personnel only · Restaurant BOH ERP
        </p>
      </motion.div>
    </div>
  );
}
