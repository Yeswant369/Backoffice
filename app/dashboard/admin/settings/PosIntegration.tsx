"use client";

import { useActionState } from "react";
import { Field, inputCls } from "../../_components/forms";
import { savePosConfig, syncPosNow, type PosState } from "./pos-actions";

export default function PosIntegration({
  restId,
  commissions,
  lastSynced,
  credsReady,
  locCreds,
  envCreds,
}: {
  restId: string;
  commissions: Record<string, number>;
  lastSynced: string | null;
  credsReady: boolean;
  locCreds: boolean;
  envCreds: boolean;
}) {
  const [saveState, saveAction, saving] = useActionState<PosState | undefined, FormData>(
    savePosConfig,
    undefined,
  );
  const [syncState, syncAction, syncing] = useActionState<PosState | undefined, FormData>(
    syncPosNow,
    undefined,
  );

  return (
    <div className="space-y-6 rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5">
      <div>
        <h3 className="text-sm font-semibold text-neutral-900">Petpooja POS</h3>
        <p className="mt-1 text-sm text-neutral-500">
          Orders pull automatically every night (yesterday&apos;s sales). Paste
          your outlet&apos;s Restaurant ID (the mapping code Petpooja gave you).
        </p>
      </div>

      <div
        className={`rounded-lg border px-3 py-2 text-sm ${
          credsReady
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-amber-200 bg-amber-50 text-amber-700"
        }`}
      >
        {locCreds
          ? "API credentials: saved for this outlet."
          : envCreds
            ? "API credentials: using the shared server credentials."
            : "API credentials not set — paste your Petpooja app key / secret / access token below."}
      </div>

      <form action={saveAction} className="space-y-4">
        <Field label="Restaurant ID (mapping code)" hint="e.g. h5irybqxau — not the numeric outlet id">
          <input
            name="rest_id"
            defaultValue={restId}
            placeholder="h5irybqxau"
            className={inputCls}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="App key" hint={locCreds ? "leave blank to keep" : undefined}>
            <input
              name="app_key"
              type="password"
              autoComplete="off"
              placeholder={locCreds ? "•••••• saved" : "paste"}
              className={inputCls}
            />
          </Field>
          <Field label="App secret" hint={locCreds ? "leave blank to keep" : undefined}>
            <input
              name="app_secret"
              type="password"
              autoComplete="off"
              placeholder={locCreds ? "•••••• saved" : "paste"}
              className={inputCls}
            />
          </Field>
          <Field label="Access token" hint={locCreds ? "leave blank to keep" : undefined}>
            <input
              name="access_token"
              type="password"
              autoComplete="off"
              placeholder={locCreds ? "•••••• saved" : "paste"}
              className={inputCls}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Swiggy commission %" hint="for net-of-commission profit">
            <input
              name="commission_swiggy"
              type="number"
              step="any"
              min="0"
              max="100"
              defaultValue={commissions.Swiggy ?? ""}
              className={inputCls}
            />
          </Field>
          <Field label="Zomato commission %">
            <input
              name="commission_zomato"
              type="number"
              step="any"
              min="0"
              max="100"
              defaultValue={commissions.Zomato ?? ""}
              className={inputCls}
            />
          </Field>
        </div>
        {saveState?.error && (
          <p className="text-sm text-red-600">{saveState.error}</p>
        )}
        {saveState?.success && (
          <p className="text-sm text-emerald-600">{saveState.success}</p>
        )}
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </form>

      <div className="border-t border-[#e6e0d3] pt-5">
        <form action={syncAction} className="flex flex-wrap items-end gap-3">
          <Field label="Backfill (days)" hint="pull this many past days now">
            <input
              name="days"
              type="number"
              min="1"
              max="90"
              defaultValue="2"
              className={`${inputCls} w-28`}
            />
          </Field>
          <button
            type="submit"
            disabled={syncing || !credsReady}
            className="rounded-lg border border-[#d9d1c1] bg-white px-4 py-2.5 text-sm font-semibold text-neutral-800 transition hover:bg-[#f3eee3] disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          <span className="pb-2.5 text-xs text-neutral-500">
            Last synced: {lastSynced ? new Date(lastSynced).toLocaleString() : "never"}
          </span>
        </form>
        {syncState?.error && (
          <p className="mt-2 text-sm text-red-600">{syncState.error}</p>
        )}
        {syncState?.success && (
          <p className="mt-2 text-sm text-emerald-600">{syncState.success}</p>
        )}
      </div>
    </div>
  );
}
