/**
 * Absolute base URL of this deployment, used to build auth redirect links
 * (e.g. the invite → set-password landing). Set NEXT_PUBLIC_SITE_URL in
 * production; defaults to localhost for dev.
 */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
}
