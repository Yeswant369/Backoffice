import "server-only";
import { google, type sheets_v4 } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

/**
 * Build the editable URL for a spreadsheet id. The id is now resolved per
 * request from the caller's location (see lib/google/location.ts), not from env.
 */
export function getSpreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

/** Authenticated Sheets client from the service-account env credentials. */
export function getSheetsClient(): sheets_v4.Sheets {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error(
      "Google service account credentials are not configured (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY).",
    );
  }
  // Env files often store the key with literal "\n"; normalize to real newlines.
  const key = rawKey.replace(/\\n/g, "\n");
  const auth = new google.auth.JWT({ email, key, scopes: SCOPES });
  return google.sheets({ version: "v4", auth });
}

export async function listTabTitles(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<string[]> {
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  return (res.data.sheets ?? [])
    .map((s) => s.properties?.title ?? "")
    .filter((t): t is string => Boolean(t));
}

/** Create a tab if it doesn't exist; keeps `existing` in sync. */
export async function ensureTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  title: string,
  existing: string[],
): Promise<void> {
  if (existing.includes(title)) return;
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
  } catch (e) {
    // A concurrent sync may have just created this tab — tolerate that (re-list
    // and continue); otherwise it's a real failure, rethrow.
    const titles = await listTabTitles(sheets, spreadsheetId);
    if (!titles.includes(title)) throw e;
    existing.splice(0, existing.length, ...titles);
    return;
  }
  existing.push(title);
}

export async function readTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  title: string,
): Promise<string[][]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${title}'!A1:H5000`,
  });
  return (res.data.values ?? []) as string[][];
}

/** Read an entire tab as a raw 2D grid (whole-sheet range). */
export async function readGrid(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  title: string,
): Promise<string[][]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${title}'`,
  });
  return (res.data.values ?? []) as string[][];
}

/** Append rows to the end of a tab WITHOUT touching existing rows. */
export async function appendRows(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  title: string,
  rows: string[][],
): Promise<void> {
  if (rows.length === 0) return;
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${title}'!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
}

/** Clear an entire tab and write a fresh 2D grid from A1. */
export async function writeGrid(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  title: string,
  values: string[][],
): Promise<void> {
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${title}'`,
  });
  if (values.length === 0) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${title}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}

/** Overwrite a tab's block area with fresh rows. */
export async function writeTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  title: string,
  rows: string[][],
): Promise<void> {
  // Clear at least the width being written (e.g. the 9-column Daily
  // Reconciliation tab) so a shrink never orphans cells in trailing columns.
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0) || 8;
  const lastCol = String.fromCharCode(64 + Math.min(Math.max(cols, 1), 26));
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${title}'!A1:${lastCol}5000`,
  });
  if (rows.length === 0) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${title}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}
