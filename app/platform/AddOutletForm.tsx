"use client";

import { useActionState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { addOutlet, type OutletState } from "./actions";

const ease = [0.22, 1, 0.36, 1] as const;

const fieldCls =
  "w-full rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-4 py-2.5 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25";
const labelCls =
  "block text-xs font-medium uppercase tracking-wider text-neutral-600";

export default function AddOutletForm({
  orgs,
}: {
  orgs: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<
    OutletState | undefined,
    FormData
  >(addOutlet, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state?.success]);

  if (orgs.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay: 0.05 }}
      className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-6"
    >
      <h2 className="text-sm font-semibold text-neutral-900">
        Add an outlet to a customer
      </h2>
      <p className="mt-1 text-xs text-neutral-500">
        Outlets are billed per location, so only you can provision them. The
        customer&apos;s owner sees it immediately and can staff it.
      </p>

      <form ref={formRef} action={formAction} className="mt-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="org_id" className={labelCls}>
              Tenant
            </label>
            <div className="relative">
              <select
                id="org_id"
                name="org_id"
                required
                defaultValue=""
                className={`${fieldCls} appearance-none pr-8`}
              >
                <option value="" disabled>
                  Select a customer…
                </option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500"
                aria-hidden
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="add_outlet_name" className={labelCls}>
              Outlet name
            </label>
            <input
              id="add_outlet_name"
              name="outlet_name"
              type="text"
              required
              placeholder="Indiranagar"
              className={fieldCls}
            />
          </div>
        </div>

        {state?.error && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600"
          >
            {state.error}
          </p>
        )}
        {state?.success && (
          <p
            role="status"
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-600"
          >
            {state.success}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Adding…
              </>
            ) : (
              "Add outlet"
            )}
          </button>
        </div>
      </form>
    </motion.div>
  );
}
