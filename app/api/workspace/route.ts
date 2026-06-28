import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import {
  ensureTab,
  getSheetsClient,
  getSpreadsheetUrl,
  listTabTitles,
  readGrid,
  writeGrid,
} from "@/lib/google/sheets";
import { resolveSheetByPurpose } from "@/lib/google/location";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  action?: "push" | "pull";
  purpose?: string;
  tab?: string;
  headers?: string[];
  rows?: string[][];
}

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const action = body.action;
  const purpose = (body.purpose ?? "").trim();
  const tab = (body.tab ?? "").trim() || "Sheet1";

  if (action !== "push" && action !== "pull") {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }
  if (!purpose) {
    return NextResponse.json({ error: "Missing workspace purpose." }, { status: 400 });
  }

  const supabase = await createClient();
  const loc = await resolveSheetByPurpose(supabase, purpose);
  if (!loc) {
    return NextResponse.json(
      {
        error: `No Google Sheet is connected for the "${purpose}" workspace. Connect one first.`,
      },
      { status: 400 },
    );
  }

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = loc.spreadsheetId;

    if (action === "push") {
      const headers = body.headers ?? [];
      const rows = body.rows ?? [];
      const existing = await listTabTitles(sheets, spreadsheetId);
      await ensureTab(sheets, spreadsheetId, tab, existing);
      await writeGrid(sheets, spreadsheetId, tab, [headers, ...rows]);
      return NextResponse.json({
        ok: true,
        url: getSpreadsheetUrl(spreadsheetId),
        rowCount: rows.length,
      });
    }

    // pull
    let grid: string[][];
    try {
      grid = await readGrid(sheets, spreadsheetId, tab);
    } catch {
      return NextResponse.json(
        { error: `Tab "${tab}" not found. Create it and push first.` },
        { status: 404 },
      );
    }
    const [headers = [], ...rows] = grid;
    return NextResponse.json({ headers, rows });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Workspace sync failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
