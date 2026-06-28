"use client";

import { useActionState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { type RoleId } from "@/lib/roles";
import { inviteUser, type InviteState } from "./actions";

const ease = [0.22, 1, 0.36, 1] as const;

export default function StaffForm({
  assignableRoles,
}: {
  assignableRoles: { id: RoleId; label: string }[];
}) {
  const [state, formAction, pending] = useActionState<
    InviteState | undefined,
    FormData
  >(inviteUser, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the form after a successful invite.
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
      <h2 className="text-sm font-semibold text-neutral-900">Invite a team member</h2>
      <p className="mt-1 text-xs text-neutral-500">
        They&apos;ll receive an email invitation to set their password.
      </p>

      <form ref={formRef} action={formAction} className="mt-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label
              htmlFor="full_name"
              className="block text-xs font-medium uppercase tracking-wider text-neutral-600"
            >
              Full name
            </label>
            <input
              id="full_name"
              name="full_name"
              type="text"
              required
              placeholder="Asha Menon"
              className="w-full rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-4 py-2.5 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="email"
              className="block text-xs font-medium uppercase tracking-wider text-neutral-600"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder="asha@restaurant.com"
              className="w-full rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-4 py-2.5 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/25"
            />
          </div>
        </div>

        <div className="space-y-2">
          <span className="block text-xs font-medium uppercase tracking-wider text-neutral-600">
            Roles
          </span>
          <div className="flex flex-wrap gap-2">
            {assignableRoles.map((role) => (
              <label
                key={role.id}
                className="group flex cursor-pointer items-center gap-2 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] px-3.5 py-2 text-sm text-neutral-700 transition hover:border-[#d9d1c1] hover:bg-[#efe9dd] has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-100 has-[:checked]:text-neutral-900"
              >
                <input
                  type="checkbox"
                  name="roles"
                  value={role.id}
                  className="h-3.5 w-3.5 accent-indigo-600"
                />
                {role.label}
              </label>
            ))}
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
                Sending…
              </>
            ) : (
              "Send invitation"
            )}
          </button>
        </div>
      </form>
    </motion.div>
  );
}
