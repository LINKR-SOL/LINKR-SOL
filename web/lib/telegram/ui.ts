import { InlineKeyboard } from "grammy";
import type { TelegramDraftDoc, TelegramDraftStep } from "../db/types";
import { coinUrl } from "../launchlab/ids";
import { fmtDuration } from "../launch/options";
import { siteUrl } from "./config";

/**
 * The bot's visual language. Everything is sent with parse_mode HTML, so every user-supplied string is escaped.
 *
 * The one idea the whole flow is built on: the coin takes shape in front of you. Every step opens with a progress
 * rail and the coin as it stands so far, asks one bold question with a one-line hint, and the review and the launch
 * end on a coin card (the logo as a photo, the details as its caption). Buttons carry the hierarchy: green for the
 * one action that moves you forward, blue for what you picked, red for what removes or cancels.
 */

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const code = (s: string) => `<code>${esc(s)}</code>`;
export const link = (label: string, url: string) => `<a href="${esc(url)}">${esc(label)}</a>`;
export const shortAddr = (a: string, n = 4) => (a.length > 2 * n + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a);

export const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

export const RISK_NOTE = "<i>Unaudited and custodial, so start with small amounts.</i>";

/* ---------------------------------------------------------------- buttons */

type Button = { text: string; style?: "primary" | "success" | "danger" };
/** The one action that moves you forward on a screen. */
export const go = (text: string): Button => ({ text, style: "success" });
/** An option that is currently chosen. */
export const picked = (text: string): Button => ({ text: `✓ ${text}`, style: "primary" });
/** Removes, cancels or reveals something sensitive. */
export const stop = (text: string): Button => ({ text, style: "danger" });
export const option = (text: string, chosen: boolean): Button | string => (chosen ? picked(text) : text);

/* ---------------------------------------------------------------- the wizard's rail */

/** The wizard's order; `review` is where every path ends. */
export const STEPS: TelegramDraftStep[] = ["name", "symbol", "logo", "description", "socials", "quote", "basket", "period", "buy", "review"];
export const QUESTION_COUNT = STEPS.length - 1;

export const STEP_TITLE: Record<TelegramDraftStep, string> = {
  name: "Name",
  symbol: "Ticker",
  logo: "Logo",
  description: "Story",
  socials: "Links",
  quote: "Trades against",
  basket: "Rewards",
  period: "Payouts",
  buy: "First buy",
  review: "Review",
};

export const nextStep = (s: TelegramDraftStep): TelegramDraftStep => STEPS[Math.min(STEPS.indexOf(s) + 1, STEPS.length - 1)];
export const prevStep = (s: TelegramDraftStep): TelegramDraftStep => STEPS[Math.max(STEPS.indexOf(s) - 1, 0)];

/** The coin as it stands so far: `$MOON Moon Dividends`. */
export function coinLine(d: Pick<TelegramDraftDoc, "name" | "symbol">): string {
  if (d.symbol && d.name) return `<b>$${esc(d.symbol)}</b>  ${esc(d.name)}`;
  if (d.name) return `<b>${esc(d.name)}</b>`;
  return "";
}

/** `▰▰▰▱▱▱▱▱▱  3/9 Logo` and the coin so far, or `Editing Logo` when changing one field from the review. */
export function stepHeader(d: TelegramDraftDoc): string {
  const coin = coinLine(d);
  if (d.editing) return [`✏️ <b>Editing ${STEP_TITLE[d.step].toLowerCase()}</b>`, coin].filter(Boolean).join("\n");
  const i = STEPS.indexOf(d.step) + 1;
  const rail = `${"▰".repeat(i)}${"▱".repeat(QUESTION_COUNT - i)}  <b>${i}/${QUESTION_COUNT}</b> ${STEP_TITLE[d.step]}`;
  return [rail, coin].filter(Boolean).join("\n");
}

/** A step's screen: the rail, then one bold question and its hint. */
export const screen = (d: TelegramDraftDoc, question: string, ...hint: string[]) => [stepHeader(d), "", `<b>${question}</b>`, ...hint].join("\n");

/** Starts a new keyboard row unless the current one is still empty (an empty row would be sent as-is). */
export const nextRow = (kb: InlineKeyboard) => (kb.inline_keyboard.at(-1)?.length ? kb.row() : kb);

/** Lays buttons out `cols` to a row, then leaves the keyboard on a fresh row. */
export function grid(kb: InlineKeyboard, buttons: [Button | string, string][], cols: number): InlineKeyboard {
  nextRow(kb);
  buttons.forEach(([label, data], i) => {
    if (i > 0 && i % cols === 0) kb.row();
    kb.text(label, data);
  });
  return nextRow(kb);
}

/** The keyboard, or nothing when it has no buttons (an empty keyboard would still be sent). */
export const markup = (kb: InlineKeyboard) => (kb.inline_keyboard.some((row) => row.length > 0) ? kb : undefined);

/** `‹ Back` on every step after the first; back to the review when a field is being edited. */
export function withBack(kb: InlineKeyboard, d: TelegramDraftDoc): InlineKeyboard {
  if (d.editing) return nextRow(kb).text("‹ Review", "nav:back");
  if (STEPS.indexOf(d.step) > 0) return nextRow(kb).text("‹ Back", "nav:back");
  return kb;
}

/* ---------------------------------------------------------------- the basket, drawn */

/** A ten-segment meter: `▰▰▰▰▰▰▱▱▱▱` for 60%. */
export function meter(pct: number, width = 10): string {
  const filled = Math.min(width, Math.max(pct > 0 ? 1 : 0, Math.round((pct / 100) * width)));
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

export const basketRows = (d: Pick<TelegramDraftDoc, "basket">) =>
  d.basket.length ? d.basket.map((b) => `${meter(b.weight)}  <b>${b.weight}%</b> ${esc(b.symbol)}`).join("\n") : "<i>Nothing picked yet.</i>";

export const basketNames = (d: Pick<TelegramDraftDoc, "basket">) => {
  const names = d.basket.map((b) => esc(b.symbol));
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

export const socialsLine = (s: TelegramDraftDoc["socials"]) => {
  const parts = [s.twitter && link("X", s.twitter), s.telegram && link("Telegram", s.telegram), s.website && link("Website", s.website)].filter(Boolean);
  return parts.length ? parts.join(", ") : "none";
};

/* ---------------------------------------------------------------- links out */

export const vaultUrl = (vault: string) => `${siteUrl()}/vaults/${vault}`;

/** Telegram refuses URL buttons that point at localhost, so local links go in the text instead. */
export const buttonableUrl = (url: string) => /^https:\/\//.test(url) && !/\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);

/* ---------------------------------------------------------------- the live card */

export function liveCaption(d: TelegramDraftDoc): string {
  const lines = [
    `🎉 <b>$${esc(d.symbol ?? "")} is live</b>`,
    `${esc(d.name ?? "")} is trading on StonkFun.`,
    "",
    `Its trading fees now buy ${basketNames(d)} for its holders${d.epochLength ? `, every ${fmtDuration(d.epochLength)}` : ""}, weighted by how much and how long they hold.`,
    "📦 Holders don't claim anything: their stocks are airdropped to their wallets after every payout.",
    "",
    code(d.mint ?? ""),
  ];
  if (d.vault && !buttonableUrl(vaultUrl(d.vault))) lines.push("", `Vault: ${esc(vaultUrl(d.vault))}`);
  return lines.join("\n");
}

export function liveKeyboard(d: TelegramDraftDoc): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (d.mint) {
    kb.url(go("📈 Trade on StonkFun"), coinUrl(d.mint)).row();
    const share = `https://t.me/share/url?url=${encodeURIComponent(coinUrl(d.mint))}&text=${encodeURIComponent(`$${d.symbol} pays its holders in ${d.basket.map((b) => b.symbol).join(", ")}. Launched with LINKR.`)}`;
    kb.url("📣 Share", share);
  }
  if (d.vault && buttonableUrl(vaultUrl(d.vault))) kb.url("🏦 Vault", vaultUrl(d.vault));
  return kb.row().text("🚀 Launch another", "home:launch");
}

/* ---------------------------------------------------------------- home and help */

export const homeKeyboard = () => new InlineKeyboard().text(go("🚀 Launch a coin"), "home:launch").row().text("👛 Wallet", "home:wallet").text("📈 My coins", "home:coins");

export const HELP_TEXT = [
  "<b>How LINKR works</b>",
  "",
  "Your coin's trading fees buy the tokenised stocks you pick, and they're airdropped to holders, weighted by how much they hold and for how long.",
  "",
  "/launch  create a coin in nine steps",
  "/wallet  deposit, withdraw or export your bot wallet",
  "/coins  the coins you launched",
  "/cancel  drop the draft you're working on",
  "",
  RISK_NOTE,
].join("\n");
