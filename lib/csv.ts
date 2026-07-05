/**
 * Shared CSV builder — RFC-4180 quoting + spreadsheet formula-injection
 * neutralisation. Used by every report/export endpoint (accounting, vendor
 * reports, …) so all downloads behave identically in Excel/Sheets/Tally.
 */

/** Quote one cell; neutralise leading =, +, @, tab/CR and non-numeric '-'. */
export const csvCell = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+@\t\r]/.test(s) || /^-(?![\d.])/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (rows: (string | number)[][]) =>
  rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
