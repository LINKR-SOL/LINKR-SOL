/**
 * Request helpers for the newswire collector.
 *
 * These mirror the shared request conventions in feeds-backend-explanation/SOURCE_INVENTORY.md §2,
 * so an adapter here makes the same shape of call the inventory documents.
 *
 * Two rules hold everywhere in this directory:
 *  - No credential, cookie, or session value is ever sent to a news source. Every endpoint
 *    below is called anonymously; a source that only works with browser-session state is
 *    not integrated (see FinancialJuice in §3.11).
 *  - A failing source is recorded and skipped. It never throws its way into a page.
 */

import https from "node:https";
import { BRAND } from "../brand";

const JSON_UA = `LINKR-Newswire/0.1 (+${BRAND.github})`;
const FEED_UA = `LINKR-Newswire/0.2 (+${BRAND.github})`;
/** Some public endpoints reject non-browser agents outright; those get a browser-like UA
 *  and their own origin/referer, exactly as a normal anonymous page load would send. */
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

const DEFAULT_TIMEOUT = 15_000;

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function send(url: string, init: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: "no-store", redirect: "follow" });
    if (!res.ok) throw new HttpError(`${new URL(url).host} ${res.status} ${res.statusText}`, res.status);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Public JSON APIs. */
export async function requestJson<T>(url: string, timeoutMs?: number): Promise<T> {
  const res = await send(url, { headers: { accept: "application/json", "user-agent": JSON_UA }, timeoutMs });
  return (await res.json()) as T;
}

/** Retries on 429/502/503/504 up to three times. Used for sources that rate-limit or
 *  intermittently 403 a cold server (Stocktwits, per §3.4). */
export async function requestJsonRetry<T>(
  url: string,
  opts: { referer?: string; attempts?: number; timeoutMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const headers: Record<string, string> = { accept: "application/json", "user-agent": BROWSER_UA };
  if (opts.referer) {
    headers.referer = opts.referer;
    headers.origin = new URL(opts.referer).origin;
  }

  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await send(url, { headers, timeoutMs: opts.timeoutMs });
      return (await res.json()) as T;
    } catch (e) {
      last = e;
      const status = e instanceof HttpError ? e.status : 0;
      if (![429, 502, 503, 504].includes(status) || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last;
}

/** JSON POST with a matching referer/origin pair (Barchart, per §3.5). */
export async function requestJsonPost<T>(
  url: string,
  body: unknown,
  opts: { referer: string; timeoutMs?: number },
): Promise<T> {
  const res = await send(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": BROWSER_UA,
      referer: opts.referer,
      origin: new URL(opts.referer).origin,
    },
    body: JSON.stringify(body),
    timeoutMs: opts.timeoutMs,
  });
  return (await res.json()) as T;
}

/** RSS / Atom. `userAgent` is required by SEC EDGAR, which wants a contact string. */
export async function requestFeed(url: string, userAgent = FEED_UA, timeoutMs?: number): Promise<string> {
  const res = await send(url, {
    headers: { accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8", "user-agent": userAgent },
    timeoutMs,
  });
  return res.text();
}

/**
 * HTML, capped so a huge page cannot exhaust the function's memory.
 *
 * This goes through node:https rather than fetch for one specific reason: Yahoo answers
 * the front page with more than 16 KB of response headers (a wall of Set-Cookie), and
 * undici — the fetch implementation in Node — rejects that with UND_ERR_HEADERS_OVERFLOW
 * before a single byte of body arrives. node:https takes a per-request `maxHeaderSize`,
 * so the page is readable without raising the limit process-wide.
 */
export function requestText(url: string, opts: { referer?: string; maxBytes?: number; timeoutMs?: number } = {}): Promise<string> {
  const maxBytes = opts.maxBytes ?? 1_500_000;
  const headers: Record<string, string> = {
    accept: "text/html,application/xhtml+xml",
    "user-agent": BROWSER_UA,
    "accept-language": "en-US,en;q=0.9",
  };
  if (opts.referer) headers.referer = opts.referer;

  const get = (target: string, redirects: number): Promise<string> =>
    new Promise((resolve, reject) => {
      const req = https.get(
        target,
        { headers, timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT, maxHeaderSize: 256 * 1024 },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            if (redirects <= 0) return reject(new HttpError(`too many redirects for ${target}`, status));
            return resolve(get(new URL(res.headers.location, target).toString(), redirects - 1));
          }
          if (status < 200 || status >= 300) {
            res.resume();
            return reject(new HttpError(`${new URL(target).host} ${status}`, status));
          }

          let size = 0;
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            chunks.push(chunk);
            if (size >= maxBytes) res.destroy();
          });
          res.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
          res.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new Error(`timeout after ${opts.timeoutMs ?? DEFAULT_TIMEOUT}ms`)));
      req.on("error", reject);
    });

  return get(url, 3);
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
