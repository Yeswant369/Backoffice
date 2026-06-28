"use client";

import { useActionState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { createTenant, type TenantState } from "./actions";
import InviteLinkBox from "./InviteLinkBox";

const ease = [0.22, 1, 0.36, 1] as const;

const inputCls =
  "w-full rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-4 py-2.5 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25";
const labelCls =
  "block text-xs font-medium uppercase tracking-wider text-neutral-600";

export default function CreateTenantForm() {
  const [state, formAction, pending] = useActionState<
    TenantState | undefined,
    FormData
  >(createTenant, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.success) formRef.current?.reset();
  }, [state?.success]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease }}
      className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-6"
    >
      <h2 className="text-sm font-semibold text-neutral-900">New customer</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Creates the organization, its first outlet, default departments and an
        owner login. The owner is emailed a set-password invite.
      </p>

      <form ref={formRef} action={formAction} className="mt-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="org_name" className={labelCls}>
              Restaurant / organization
            </label>
            <input
              id="org_name"
              name="org_name"
              type="text"
              required
              placeholder="Spice Garden"
              className={inputCls}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="outlet_name" className={labelCls}>
              First outlet
            </label>
            <input
              id="outlet_name"
              name="outlet_name"
              type="text"
              required
              placeholder="MG Road"
              className={inputCls}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="owner_name" className={labelCls}>
              Owner name
            </label>
            <input
              id="owner_name"
              name="owner_name"
              type="text"
              required
              placeholder="Ravi Kumar"
              className={inputCls}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="owner_email" className={labelCls}>
              Owner email
            </label>
            <input
              id="owner_email"
              name="owner_email"
              type="email"
              required
              placeholder="ravi@spicegarden.com"
              className={inputCls}
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
          <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <p role="status" className="text-sm text-emerald-700">
              {state.success}
            </p>
            {state.link && (
              <>
                <p className="text-xs text-neutral-600">
                  Send this set-password link to the owner (Copy or WhatsApp):
                </p>
                <InviteLinkBox link={state.link} />
              </>
            )}
          </div>
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
                Creating…
              </>
            ) : (
              "Create tenant + invite owner"
            )}
          </button>
        </div>
      </form>
    </motion.div>
  );
}
