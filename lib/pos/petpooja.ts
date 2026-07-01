import "server-only";
import https from "node:https";

/**
 * Petpooja Get-Orders (PULL) client. The API is GET-with-a-JSON-body (non
 * standard), which global fetch/undici refuses, so we use node:https directly.
 * Credentials are COMPANY-level (env, shared across all your restaurants); the
 * per-outlet restID (mapping code) selects the store.
 */

const API_URL =
  process.env.PETPOOJA_API_URL ??
  "https://api.petpooja.com/V1/thirdparty/generic_get_orders/";

export interface PetpoojaCreds {
  appKey: string;
  appSecret: string;
  accessToken: string;
  cookie?: string;
}

/** Company-level creds from env, or null if unconfigured. */
export function petpoojaCreds(): PetpoojaCreds | null {
  const appKey = process.env.PETPOOJA_APP_KEY;
  const appSecret = process.env.PETPOOJA_APP_SECRET;
  const accessToken = process.env.PETPOOJA_ACCESS_TOKEN;
  if (!appKey || !appSecret || !accessToken) return null;
  return { appKey, appSecret, accessToken, cookie: process.env.PETPOOJA_API_COOKIE };
}

export interface LocationCredRow {
  petpooja_app_key?: string | null;
  petpooja_app_secret?: string | null;
  petpooja_access_token?: string | null;
}

/**
 * Prefer per-location creds (Petpooja may issue them per restaurant), else fall
 * back to the company-level env creds. Returns null if neither is complete.
 * Only ever called with a service-role row (the secret columns aren't readable
 * by `authenticated`).
 */
export function resolvePetpoojaCreds(loc?: LocationCredRow | null): PetpoojaCreds | null {
  if (loc?.petpooja_app_key && loc.petpooja_app_secret && loc.petpooja_access_token) {
    return {
      appKey: loc.petpooja_app_key,
      appSecret: loc.petpooja_app_secret,
      accessToken: loc.petpooja_access_token,
      cookie: process.env.PETPOOJA_API_COOKIE,
    };
  }
  return petpoojaCreds();
}

function getWithBody(
  body: unknown,
  headers: Record<string, string>,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(API_URL);
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...headers,
        },
        timeout: 30000,
      },
      (res) => {
        let chunks = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (chunks += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: chunks }));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Petpooja request timed out")));
    req.write(data);
    req.end();
  });
}

/**
 * Fetch one day's orders for a restaurant (order_date = the day to fetch, per
 * Petpooja's T-1 convention). Returns the raw `order_json` array (possibly empty).
 * Throws on transport / auth / API errors.
 */
export async function fetchPetpoojaOrders(
  restId: string,
  orderDate: string,
  creds: PetpoojaCreds,
): Promise<unknown[]> {
  const body = {
    app_key: creds.appKey,
    app_secret: creds.appSecret,
    access_token: creds.accessToken,
    restID: restId,
    order_date: orderDate,
    refId: "",
  };
  const { status, text } = await getWithBody(
    body,
    creds.cookie ? { Cookie: creds.cookie } : {},
  );
  if (status < 200 || status >= 300) {
    throw new Error(`Petpooja API HTTP ${status}: ${text.slice(0, 200)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Petpooja returned non-JSON: ${text.slice(0, 200)}`);
  }
  const root = (json ?? {}) as Record<string, unknown>;
  const orders = root.order_json;
  if (Array.isArray(orders)) return orders;
  // Non-array order_json: treat an explicit failure as an error, else empty.
  const success = String(root.success ?? "");
  if (success === "0" || Number(root.code ?? 0) >= 400) {
    throw new Error(`Petpooja: ${String(root.message ?? "unknown error")}`);
  }
  return [];
}
