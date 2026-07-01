import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import SectionHeader from "../../_components/SectionHeader";
import WorkspaceSettings from "./WorkspaceSettings";
import PosIntegration from "./PosIntegration";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (!(await isAdmin())) redirect("/dashboard");
  const supabase = await createClient();

  const { data: loc } = await supabase
    .from("locations")
    .select("google_spreadsheet_id, petpooja_rest_id, pos_commissions, pos_last_synced_at")
    .maybeSingle();

  const spreadsheetId = loc?.google_spreadsheet_id ?? null;
  const sheetUrl = spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
    : "";
  const commissions = (loc?.pos_commissions ?? {}) as Record<string, number>;
  const { data: hasLocCreds } = await supabase.rpc("pos_has_location_creds");
  const envCreds = Boolean(
    process.env.PETPOOJA_APP_KEY &&
      process.env.PETPOOJA_APP_SECRET &&
      process.env.PETPOOJA_ACCESS_TOKEN,
  );
  const locCreds = Boolean(hasLocCreds);
  const credsReady = envCreds || locCreds;

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/dashboard/admin" className="transition hover:text-neutral-900">
          Administration
        </Link>
        <span>/</span>
        <span className="text-neutral-700">Settings</span>
      </div>

      <SectionHeader
        eyebrow="Administration"
        title="Workspace Settings"
        description="Connect this location to its Google Sheet workspace. Configured once — every sync uses it automatically."
      />

      <div className="max-w-2xl space-y-6">
        <WorkspaceSettings
          connected={Boolean(spreadsheetId)}
          sheetUrl={sheetUrl}
          botEmail={process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? ""}
        />
        <PosIntegration
          restId={loc?.petpooja_rest_id ?? ""}
          commissions={commissions}
          lastSynced={loc?.pos_last_synced_at ?? null}
          credsReady={credsReady}
          locCreds={locCreds}
          envCreds={envCreds}
        />
      </div>
    </div>
  );
}
