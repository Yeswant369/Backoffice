/**
 * Shared date-range helpers for the reusable preset + custom range control.
 * Everything is anchored to IST (Asia/Kolkata) so presets match the server's
 * date logic regardless of where the request runs.
 */

const IST = "Asia/Kolkata";

/** Today in IST as YYYY-MM-DD. */
export function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(new Date());
}

/** `n` days before today, IST, as YYYY-MM-DD. */
export function istDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d);
}

const isYmd = (s?: string | null): s is string =>
  !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export interface DateRange {
  from: string;
  to: string;
}

/**
 * Resolve `?from=&to=` search params into a validated {from,to} range,
 * defaulting to the last `defaultDays` (through today, IST). Used by server
 * pages that read searchParams. `to` is clamped to be >= `from`.
 */
export function resolveDateRange(
  from?: string | null,
  to?: string | null,
  defaultDays = 30,
): DateRange {
  const resolvedFrom = isYmd(from) ? from : istDaysAgo(defaultDays);
  let resolvedTo = isYmd(to) ? to : istToday();
  if (resolvedTo < resolvedFrom) resolvedTo = resolvedFrom;
  return { from: resolvedFrom, to: resolvedTo };
}
