/**
 * The brand in one place: the name and lines the site, the API and the Telegram bot speak with, and the accounts
 * the brand currently lives at. Moving to a new X handle or repository is an edit here; the public origin is
 * NEXT_PUBLIC_SITE_URL, with `site` as its fallback.
 *
 * Deliberately not derived from this: the strings that seed keys or sit in on-chain records
 * (`causa-custodial-vault-v1`, `causa-telegram-wallet-v1`, the `causa:v1:` memo prefix, the `causa_vault`
 * program). Renaming those would re-derive every vault and bot wallet to a new, empty address.
 */
export const BRAND = {
  name: "LINKR",
  /** the public origin when NEXT_PUBLIC_SITE_URL is unset */
  site: "https://linkrfun.xyz",
  headline: "Every market starts with a reason.",
  tagline: "Discover the thesis. Hold the coin. Earn the stocks.",
  x: "https://x.com/Linkrfun",
  xHandle: "@Linkrfun",
  github: "https://github.com/LINKR-SOL/LINKR-SOL",
} as const;
