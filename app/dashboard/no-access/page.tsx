import { logout } from "../actions";

/**
 * Shown to an authenticated user whose `profiles.roles` array grants no
 * dashboard section (e.g. a freshly created account awaiting role assignment).
 */
export default function NoAccessPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-[#d9d1c1] bg-[#efe9dd]">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6 text-neutral-700"
          aria-hidden
        >
          <path d="M12 9v4m0 4h.01M10.3 3.9l-7.6 13A2 2 0 004.4 20h15.2a2 2 0 001.7-3l-7.6-13a2 2 0 00-3.4 0z" />
        </svg>
      </div>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-neutral-900">
        No workspace yet
      </h1>
      <p className="mt-2 max-w-sm text-sm text-neutral-600">
        Your account isn&apos;t mapped to a workspace yet. An administrator needs
        to assign your roles (and, for an Area Manager, the outlets you cover).
        Sign in again once that&apos;s done.
      </p>
      <form action={logout} className="mt-6">
        <button
          type="submit"
          className="rounded-lg border border-[#d9d1c1] bg-[#f7f3ec] px-4 py-2.5 text-sm font-medium text-neutral-900 transition hover:bg-[#efe9dd]"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
