import { InlineKeyboard } from "grammy";
import type { TelegramDraftDoc, TelegramDraftStep, TokenDoc } from "../db/types";
import { isBase58Address } from "../solana/address";
import { isCustodial } from "../solana/cluster";
import { serverConnection } from "../solana/connection";
import { launchablePairs, type QuotePair } from "../launchlab/pairs";
import { WSOL_MINT } from "../launchlab/ids";
import { ensureTokens } from "../api/tokens";
import { custodialConfig } from "../custody/config";
import { formatSol, parseAmount } from "../format";
import {
  CREATOR_FEE_PCT,
  DESCRIPTION_MAX,
  EPOCH_OPTIONS,
  MAX_BASKET,
  NAME_MAX,
  SYMBOL_MAX,
  basketValid,
  evenWeights,
  fmtDuration,
  landsAt,
  reviewWindowFor,
  withAdded,
  withRemoved,
} from "../launch/options";
import { LaunchInputError } from "../launch/errors";
import { LOGO_MAX_BYTES, LOGO_TYPES, storeLogo } from "../launch/logo";
import { activeDraft, cancelDraft, claimDraftForLaunch, createDraft, getDraft, saveDraft, setDraft, type DraftFields } from "./drafts";
import { affordability, formatNeed, missingFields, runBotLaunch, type Affordability } from "./launch";
import { background } from "./background";
import { siteUrl, telegramToken } from "./config";
import { ignoreNotModified } from "./api";
import { logoImage, sendCard } from "./cards";
import { userWallet } from "./wallets";
import type { BotContext, Toast } from "./context";
import {
  BETA_NOTE,
  HTML,
  STEPS,
  STEP_TITLE,
  basketRows,
  buttonableUrl,
  code,
  coinLine,
  esc,
  go,
  grid,
  link,
  markup,
  nextStep,
  option,
  prevStep,
  screen,
  socialsLine,
  stop,
  withBack,
} from "./ui";

/**
 * The launch conversation: the web wizard's fields, asked one at a time, then a review card with two ways to sign:
 * the bot wallet (the bot runs both transactions) or the user's own wallet (the wizard opens prefilled).
 * State lives in the draft document, never in memory: every webhook call may land on a different instance.
 */

const warn = (ctx: BotContext, msg: string) => ctx.reply(`⚠️ ${esc(msg)}`, HTML);
const typing = (ctx: BotContext, action: "typing" | "upload_photo" = "typing") => ctx.replyWithChatAction(action).catch(() => {});
const nowValue = (v: string | null | undefined) => (v ? `\n\nNow: <b>${esc(v)}</b>` : "");
const hint = (s: string) => `<i>${s}</i>`;
const RACE = "That came in while I was still on your last message. Please send it again.";
const ONE_TAP = "One tap at a time, please try again.";
const STEP_DONE = "That step is done. Use Edit on the review to change it.";

/* ---------------------------------------------------------------- entry points */

export async function startLaunch(ctx: BotContext, fresh = false): Promise<void> {
  if (!isCustodial) {
    await ctx.reply("Launching from Telegram needs the custodial vault mode (NEXT_PUBLIC_VAULT_MODE=custodial).");
    return;
  }
  const current = await activeDraft(ctx.user);
  if (current && !fresh) {
    if (current.status === "launching") {
      await ctx.reply(`<b>$${esc(current.symbol ?? "")}</b> is launching right now. I'll post here when it's done.`, HTML);
      return;
    }
    const where = current.status === "failed" ? "and its launch is waiting for a retry" : `stopped at ${STEP_TITLE[current.step].toLowerCase()}`;
    await ctx.reply(`You have a draft${current.symbol ? ` for <b>$${esc(current.symbol)}</b>` : ""}, ${where}.`, {
      ...HTML,
      reply_markup: new InlineKeyboard().text(go("▶️ Continue"), "d:continue").text("🆕 Start over", "d:new"),
    });
    return;
  }
  if (current) {
    if (current.status === "launching") {
      await ctx.reply("That draft is launching right now, so it can't be replaced until it finishes.");
      return;
    }
    await cancelDraft(current);
  }
  if (custodialConfig().paused) {
    await ctx.reply("Launches are paused by the protocol admin right now. Try again later.");
    return;
  }
  const d = await createDraft(ctx.user);
  ctx.user.draftId = d._id;
  await ctx.reply(`🚀 <b>Let's launch a coin</b>\nNine quick steps, then you see the whole coin before anything happens. /cancel stops at any point.`, HTML);
  await prompt(ctx, d);
}

export async function continueDraft(ctx: BotContext): Promise<Toast> {
  const d = await activeDraft(ctx.user);
  if (!d) return startLaunch(ctx);
  if (d.status === "failed") {
    await ctx.reply(`The last launch of <b>$${esc(d.symbol ?? "")}</b> didn't finish:\n${esc(d.error ?? "unknown error")}`, { ...HTML, reply_markup: failedKeyboard(d) });
    return;
  }
  if (d.status === "launching") return "It's launching right now.";
  await prompt(ctx, d);
}

export async function cancelActive(ctx: BotContext): Promise<void> {
  const d = await activeDraft(ctx.user);
  if (!d) {
    await ctx.reply("Nothing to cancel. /launch starts a new coin.");
    return;
  }
  await cancelDraftWithReply(ctx, d);
}

async function cancelDraftWithReply(ctx: BotContext, d: TelegramDraftDoc): Promise<Toast> {
  if (d.status === "launching") return "It's launching, so it can't be cancelled now.";
  if (!(await cancelDraft(d))) return "This draft is already closed.";
  ctx.user.draftId = null;
  await ctx.reply(
    `Draft${d.symbol ? ` <b>$${esc(d.symbol)}</b>` : ""} cancelled.${d.prepareSignature ? " Its vault was already prepared, and the rent paid for it stays with the vault." : ""} /launch starts a new one.`,
    HTML,
  );
}

const failedKeyboard = (d: TelegramDraftDoc) =>
  new InlineKeyboard().text(go("🔁 Retry"), `r:bot:${d._id}`).row().text("✏️ Edit", `r:edit:${d._id}`).text(stop("✕ Cancel"), `r:cancel:${d._id}`);

/* ---------------------------------------------------------------- questions */

export async function prompt(ctx: BotContext, d: TelegramDraftDoc): Promise<void> {
  const send = (text: string, kb = new InlineKeyboard()) => ctx.reply(text, { ...HTML, reply_markup: markup(withBack(kb, d)) });
  switch (d.step) {
    case "name":
      await send(screen(d, "What's your coin called?", hint(`Shown on StonkFun and LINKR. Up to ${NAME_MAX} characters.`)) + nowValue(d.name));
      return;
    case "symbol":
      await send(screen(d, "Pick a ticker", hint(`Like MOON. Up to ${SYMBOL_MAX} characters, no spaces.`)) + nowValue(d.symbol && `$${d.symbol}`));
      return;
    case "logo":
      await send(
        screen(d, "Send your logo", hint("A photo, an image file or a link. Square works best, up to 2 MB.")) + (d.logo ? `\n\nNow: ${link("current logo", d.logo)}` : ""),
      );
      return;
    case "description":
      await send(screen(d, "Tell people what it is", hint(`A sentence or two on why someone should hold it. Up to ${DESCRIPTION_MAX} characters.`)) + nowValue(d.description));
      return;
    case "socials":
      await showSocials(ctx, d);
      return;
    case "quote":
      await promptQuote(ctx, d);
      return;
    case "basket":
      await showBasket(ctx, d, "pick", 5, false);
      return;
    case "period":
      await promptPeriod(ctx, d);
      return;
    case "buy":
      await promptBuy(ctx, d);
      return;
    case "review":
      await sendReview(ctx, d);
      return;
  }
}

/** Saves an answer and asks the next question (or goes back to the review when the answer was an edit). */
async function answer(ctx: BotContext, d: TelegramDraftDoc, set: DraftFields): Promise<void> {
  const step: TelegramDraftStep = d.editing ? "review" : nextStep(d.step);
  const saved = await saveDraft(d, { ...set, step, editing: false, weightFor: null, socialFor: null });
  if (!saved) {
    await ctx.reply(RACE);
    return;
  }
  await prompt(ctx, saved);
}

/** ‹ Back: the previous question, or the review when a field was being edited. Answers already given are kept. */
async function onBack(ctx: BotContext): Promise<Toast> {
  const d = await activeDraft(ctx.user);
  if (!d || d.status !== "editing") return "No draft in progress. /launch starts one.";
  const step: TelegramDraftStep = d.editing ? "review" : prevStep(d.step);
  const saved = await saveDraft(d, { step, editing: false, weightFor: null, socialFor: null });
  if (!saved) return ONE_TAP;
  await prompt(ctx, saved);
}

/** Plain text, routed by the step the draft is on. */
export async function onDraftText(ctx: BotContext, text: string): Promise<void> {
  const d = await activeDraft(ctx.user);
  if (!d) {
    const { sendHome } = await import("./wallet");
    await sendHome(ctx);
    return;
  }
  if (d.status === "launching") {
    await ctx.reply("The launch is running. I'll post here when it's done.");
    return;
  }
  if (d.status === "failed") {
    await ctx.reply("The last launch didn't finish. Retry it, edit it or cancel it here:", { reply_markup: failedKeyboard(d) });
    return;
  }
  const t = text.trim();
  switch (d.step) {
    case "name":
      if (!t) return void (await warn(ctx, "Send the name as text."));
      if (t.length > NAME_MAX) return void (await warn(ctx, `That's ${t.length} characters. The limit is ${NAME_MAX}.`));
      return answer(ctx, d, { name: t });
    case "symbol": {
      const s = t.replace(/^\$/, "").toUpperCase();
      if (!s || /\s/.test(s)) return void (await warn(ctx, "Send the ticker as one word, like MOON."));
      if (s.length > SYMBOL_MAX) return void (await warn(ctx, `That's ${s.length} characters. The limit is ${SYMBOL_MAX}.`));
      return answer(ctx, d, { symbol: s });
    }
    case "logo":
      return onLogoUrl(ctx, d, t);
    case "description":
      if (!t) return void (await warn(ctx, "Send the description as text."));
      if (t.length > DESCRIPTION_MAX) return void (await warn(ctx, `That's ${t.length} characters. The limit is ${DESCRIPTION_MAX}.`));
      return answer(ctx, d, { description: t });
    case "socials":
      return onSocialsText(ctx, d, t);
    case "quote":
      return onQuoteSearch(ctx, d, t);
    case "basket":
      return onBasketText(ctx, d, t);
    case "period":
      return void (await warn(ctx, "Tap one of the payout periods above."));
    case "buy":
      return onBuyText(ctx, d, t);
    case "review":
      await ctx.reply("Use the buttons on the coin card to launch, edit or cancel.");
      return;
  }
}

/* ---------------------------------------------------------------- logo */

async function onLogoUrl(ctx: BotContext, d: TelegramDraftDoc, t: string): Promise<void> {
  if (!/^https:\/\/\S+$/i.test(t)) return void (await warn(ctx, "Send the logo as a photo or an image file, or an https link to an image."));
  await typing(ctx);
  const res = await fetch(t, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res?.ok) return void (await warn(ctx, "I couldn't download that link. Send the image itself instead."));
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!LOGO_TYPES.has(type)) return void (await warn(ctx, "That link isn't a PNG, JPEG, WebP, GIF or SVG image."));
  const blob = await res.blob();
  if (blob.size > LOGO_MAX_BYTES) return void (await warn(ctx, "That image is larger than 2 MB."));
  return answer(ctx, d, { logo: t, logoFileId: null });
}

const EXT_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };

/**
 * A photo or an image document: downloaded from Telegram and stored where the web wizard stores logos. A photo's
 * file id is kept too, so the coin cards show it without uploading it again.
 */
export async function onDraftImage(
  ctx: BotContext,
  file: { file_id: string; file_size?: number },
  mime: string | undefined,
  fileName?: string,
  opts: { isPhoto?: boolean } = {},
): Promise<void> {
  const d = await activeDraft(ctx.user);
  if (!d || d.status !== "editing" || d.step !== "logo") {
    await ctx.reply("I only need an image at the logo step. /launch starts a coin.");
    return;
  }
  const type = (mime ?? EXT_TYPES[fileName?.split(".").pop()?.toLowerCase() ?? ""] ?? "").toLowerCase();
  if (!LOGO_TYPES.has(type)) return void (await warn(ctx, "Use a PNG, JPEG, WebP, GIF or SVG image."));
  if ((file.file_size ?? 0) > LOGO_MAX_BYTES) return void (await warn(ctx, "That image is larger than 2 MB."));
  await typing(ctx, "upload_photo");
  const f = await ctx.api.getFile(file.file_id);
  if (!f.file_path) return void (await warn(ctx, "Telegram didn't hand me that file. Please send it again."));
  const res = await fetch(`https://api.telegram.org/file/bot${telegramToken()}/${f.file_path}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return void (await warn(ctx, "I couldn't download the image from Telegram. Please send it again."));
  try {
    const url = await storeLogo(await res.blob(), { type, name: fileName });
    return answer(ctx, d, { logo: url, logoFileId: opts.isPhoto ? file.file_id : null });
  } catch (e) {
    if (e instanceof LaunchInputError) return void (await warn(ctx, e.message));
    throw e;
  }
}

/* ---------------------------------------------------------------- socials */

type SocialField = "twitter" | "telegram" | "website";
const SOCIAL_FIELDS: SocialField[] = ["twitter", "telegram", "website"];
const SOCIAL: Record<SocialField, { code: string; label: string; icon: string; ask: string }> = {
  twitter: { code: "x", label: "X", icon: "𝕏", ask: "Send your X handle, like <code>@mycoin</code>, or a profile link." },
  telegram: { code: "tg", label: "Telegram", icon: "✈️", ask: "Send your group or channel as <code>@name</code> or a t.me link. Invite links work too." },
  website: { code: "web", label: "Website", icon: "🌐", ask: "Send your website, like <code>mycoin.xyz</code>." },
};
const socialByCode = (code: string) => SOCIAL_FIELDS.find((f) => SOCIAL[f].code === code) ?? null;
const shownUrl = (url: string) => url.replace(/^https:\/\//, "").replace(/\/$/, "");

function toUrl(raw: string): URL | null {
  if (!raw || /\s/.test(raw)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!u.hostname.includes(".")) return null;
    u.protocol = "https:";
    return u;
  } catch {
    return null;
  }
}
const hostOf = (u: URL) => u.hostname.replace(/^www\./, "").toLowerCase();
const pathOf = (u: URL) => u.pathname.replace(/\/+$/, "");

/** One link for a known field: handles (@name) are accepted where they are unambiguous, links are normalised. */
function parseSocial(field: SocialField, raw: string): { url: string } | { error: string } {
  const t = raw.trim();
  const handle = /^@?([A-Za-z0-9_]+)$/.exec(t)?.[1];
  if (field === "twitter") {
    if (handle) return handle.length <= 15 ? { url: `https://x.com/${handle}` } : { error: "X handles are at most 15 characters." };
    const u = toUrl(t);
    if (!u || !["x.com", "twitter.com"].includes(hostOf(u)) || !pathOf(u)) return { error: "That isn't an X profile. Send @handle or https://x.com/handle." };
    return { url: `https://x.com${pathOf(u)}` };
  }
  if (field === "telegram") {
    if (handle) return handle.length >= 4 && handle.length <= 32 ? { url: `https://t.me/${handle}` } : { error: "Telegram names are 4 to 32 characters." };
    const u = toUrl(t);
    if (!u || !["t.me", "telegram.me"].includes(hostOf(u)) || !pathOf(u)) return { error: "That isn't a Telegram link. Send @name or https://t.me/name." };
    return { url: `https://t.me${pathOf(u)}` };
  }
  const u = toUrl(t);
  return u ? { url: u.toString() } : { error: "That isn't a link. Send something like mycoin.xyz." };
}

/** Several links pasted at once, sorted into X / Telegram / website by their host. */
function parseSocials(t: string): { socials: TelegramDraftDoc["socials"] } | { error: string } {
  const socials: TelegramDraftDoc["socials"] = {};
  for (const raw of t.split(/[\s,]+/).filter(Boolean)) {
    if (raw.startsWith("@")) return { error: `"${raw}" could be X or Telegram. Tap the one it belongs to, then send it.` };
    const u = toUrl(raw);
    if (!u) return { error: `"${raw}" is not a link.` };
    const host = hostOf(u);
    const field: SocialField = host === "x.com" || host === "twitter.com" ? "twitter" : host === "t.me" || host === "telegram.me" ? "telegram" : "website";
    const r = parseSocial(field, raw);
    if ("error" in r) return r;
    socials[field] = r.url;
  }
  return Object.keys(socials).length ? { socials } : { error: "Send at least one link, or tap Skip." };
}

function socialsView(d: TelegramDraftDoc): { text: string; kb: InlineKeyboard } {
  const s = d.socials ?? {};
  const rows = SOCIAL_FIELDS.map((f) => `${SOCIAL[f].icon}  ${s[f] ? link(shownUrl(s[f]!), s[f]!) : hint("not set")}`);
  const text = screen(d, "Add your links", hint("Optional. They're saved in the coin's metadata for wallets and explorers."), "", ...rows, "", hint("Tap one to set it, or paste all your links here."));
  const kb = grid(new InlineKeyboard(), SOCIAL_FIELDS.map((f) => [`${s[f] ? "✏️" : "➕"} ${SOCIAL[f].label}`, `soc:${SOCIAL[f].code}`]), 3);
  kb.text(SOCIAL_FIELDS.some((f) => s[f]) ? go("Continue ➡️") : "Skip ➡️", "soc:done");
  return { text, kb: withBack(kb, d) };
}

async function showSocials(ctx: BotContext, d: TelegramDraftDoc, viaButton = false): Promise<void> {
  const v = socialsView(d);
  if (viaButton) await ctx.editMessageText(v.text, { ...HTML, reply_markup: v.kb }).catch(ignoreNotModified);
  else await ctx.reply(v.text, { ...HTML, reply_markup: v.kb });
}

async function onSocialsText(ctx: BotContext, d: TelegramDraftDoc, t: string): Promise<void> {
  const field = d.socialFor ?? null;
  if (!field && /^(skip|none|no|-|done)$/i.test(t)) return answer(ctx, d, {});
  const r = field ? parseSocial(field, t) : parseSocials(t);
  if ("error" in r) return void (await warn(ctx, r.error));
  const socials = "url" in r ? { ...d.socials, [field!]: r.url } : { ...d.socials, ...r.socials };
  const saved = await saveDraft(d, { socials, socialFor: null });
  if (!saved) return void (await ctx.reply(RACE));
  await showSocials(ctx, saved);
}

async function onSocialsCallback(ctx: BotContext, d: TelegramDraftDoc, action: string, arg?: string): Promise<Toast> {
  if (action === "done" || action === "skip") {
    await answer(ctx, d, {});
    return;
  }
  if (action === "back") {
    const saved = await saveDraft(d, { socialFor: null });
    if (saved) await showSocials(ctx, saved, true);
    return;
  }
  if (action === "rm") {
    const field = socialByCode(arg ?? "");
    if (!field) return;
    const rest = { ...d.socials };
    delete rest[field];
    const saved = await saveDraft(d, { socials: rest, socialFor: null });
    if (saved) await showSocials(ctx, saved, true);
    return `${SOCIAL[field].label} removed`;
  }
  const field = socialByCode(action);
  if (!field) return;
  const saved = await saveDraft(d, { socialFor: field });
  if (!saved) return ONE_TAP;
  const current = d.socials?.[field];
  const kb = new InlineKeyboard();
  if (current) kb.text(stop(`🗑 Remove ${SOCIAL[field].label}`), `soc:rm:${SOCIAL[field].code}`);
  kb.text("‹ Links", "soc:back");
  const lines = [`${SOCIAL[field].icon} <b>Your ${SOCIAL[field].label}</b>`];
  if (current) lines.push(`Now: ${link(shownUrl(current), current)}`);
  lines.push("", SOCIAL[field].ask);
  await ctx.editMessageText(lines.join("\n"), { ...HTML, reply_markup: kb }).catch(ignoreNotModified);
}

/* ---------------------------------------------------------------- quote */

/** Shown as buttons; anything else is found by typing its symbol or mint. */
const FEATURED_QUOTES = ["SOL", "USDC", "USDT", "TSLAx", "NVDAx", "SPYx"];

async function promptQuote(ctx: BotContext, d: TelegramDraftDoc): Promise<void> {
  const pairs = await launchablePairs();
  const featured = FEATURED_QUOTES.map((s) => pairs.find((p) => p.symbol === s)).filter((p): p is QuotePair => !!p);
  const kb = grid(new InlineKeyboard(), featured.map((p) => [option(p.symbol, d.quote?.mint === p.mint), `q:${p.mint}`]), 3);
  const text = screen(
    d,
    "What does it trade against?",
    hint("Creator fees arrive in this token and buy your stocks. Most coins use SOL."),
    "",
    `Or type any of the ${pairs.length} launchable tokens, like <code>AAPLx</code>.`,
  );
  await ctx.reply(text, { ...HTML, reply_markup: withBack(kb, d) });
}

async function onQuoteSearch(ctx: BotContext, d: TelegramDraftDoc, t: string): Promise<void> {
  const pairs = await launchablePairs();
  const q = t.replace(/^\$/, "").trim();
  const lower = q.toLowerCase();
  let matches: QuotePair[];
  if (isBase58Address(q)) matches = pairs.filter((p) => p.mint === q);
  else {
    const exact = pairs.filter((p) => p.symbol.toLowerCase() === lower);
    matches = exact.length ? exact : pairs.filter((p) => p.symbol.toLowerCase().includes(lower) || p.name.toLowerCase().includes(lower));
  }
  if (!q || matches.length === 0) return void (await warn(ctx, `No launchable token matches "${q}".`));
  if (matches.length === 1) return answer(ctx, d, { quote: quoteOf(matches[0]) });
  const kb = grid(new InlineKeyboard(), matches.slice(0, 8).map((p) => [`${p.symbol}  ${p.name}`.slice(0, 48), `q:${p.mint}`]), 1);
  await ctx.reply(`<b>Which one?</b>${matches.length > 8 ? `\n${hint(`${matches.length} match. Type more to narrow it down.`)}` : ""}`, { ...HTML, reply_markup: kb });
}

const quoteOf = (p: QuotePair): NonNullable<TelegramDraftDoc["quote"]> => ({ mint: p.mint, symbol: p.symbol, decimals: p.decimals, tokenProgram: p.tokenProgram });

async function onQuotePick(ctx: BotContext, d: TelegramDraftDoc, mint: string): Promise<Toast> {
  const pair = (await launchablePairs()).find((p) => p.mint === mint);
  if (!pair) return "That token isn't launchable right now.";
  await answer(ctx, d, { quote: quoteOf(pair) });
  return pair.symbol;
}

/* ---------------------------------------------------------------- basket */

interface BasketToken {
  mint: string;
  symbol: string;
  name: string;
  tokenProgram: string;
}

let basketCache: { at: number; key: string; tokens: BasketToken[] } | null = null;

/** The allowlisted stocks a basket may hold: the same list the web wizard's shelf shows. */
async function basketTokens(): Promise<BasketToken[]> {
  const { allowlist } = custodialConfig();
  const key = allowlist.join(",");
  if (basketCache && basketCache.key === key && Date.now() - basketCache.at < 60_000) return basketCache.tokens;
  const map = await ensureTokens(allowlist, { kind: undefined });
  const tokens = allowlist
    .map((m) => map.get(m))
    .filter((t): t is TokenDoc => !!t)
    .map((t) => ({ mint: t.mint, symbol: t.symbol, name: t.name, tokenProgram: t.tokenProgram }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  basketCache = { at: Date.now(), key, tokens };
  return tokens;
}

const BASKET_BUTTONS = 30;
type BasketMode = "pick" | "split";
const total = (d: Pick<TelegramDraftDoc, "basket">) => d.basket.reduce((s, b) => s + b.weight, 0);
const totalLine = (sum: number) =>
  sum === 100 ? "<b>Total 100%</b>  ✓" : sum < 100 ? `<b>Total ${sum}%</b>  ⚠️ ${100 - sum}% left to assign` : `<b>Total ${sum}%</b>  ⚠️ ${sum - 100}% too much`;

/** The basket message: `pick` toggles stocks in and out, `split` sets each stock's share with − / + (step 5 or 1). */
async function basketView(d: TelegramDraftDoc, mode: BasketMode, step: number): Promise<{ text: string; kb: InlineKeyboard }> {
  const kb = new InlineKeyboard();
  if (mode === "split" && d.basket.length > 1) {
    d.basket.forEach((b, i) => {
      kb.text(`− ${step}`, `b:w:${i}:-${step}:${step}`).text(`${b.symbol} ${b.weight}%`, `b:set:${i}`).text(`+ ${step}`, `b:w:${i}:${step}:${step}`).row();
    });
    kb.text(step === 5 ? "Steps of 1%" : "Steps of 5%", `b:split:${step === 5 ? 1 : 5}`).text("⚖️ Even", "b:even:split").row();
    kb.text("‹ Stocks", "b:pick").text(go("Done ✓"), "b:done");
    const text = screen(d, "Set each stock's share", hint(`− and + move it by ${step}%. Tap a stock to type an exact number.`), "", basketRows(d), "", totalLine(total(d)));
    return { text, kb };
  }
  const tokens = await basketTokens();
  const chosen = new Set(d.basket.map((b) => b.mint));
  const lines = [basketRows(d)];
  if (d.basket.length > 1 && total(d) !== 100) lines.push(totalLine(total(d)));
  if (tokens.length > BASKET_BUTTONS) lines.push("", hint(`Showing ${BASKET_BUTTONS} of ${tokens.length} stocks. Type a ticker to add any other.`));
  if (tokens.length === 0) lines.push("", hint("No stocks are allowlisted yet. The admin sets BASKET_ALLOWLIST."));
  const text = screen(d, "Pick the stocks holders earn", hint(`Up to ${MAX_BASKET}. Fees buy them every period, split by how much and how long people hold.`), "", ...lines);
  const shown = [...tokens.filter((t) => chosen.has(t.mint)), ...tokens.filter((t) => !chosen.has(t.mint))].slice(0, BASKET_BUTTONS);
  grid(kb, shown.map((t) => [option(t.symbol, chosen.has(t.mint)), `b:${t.mint}`]), 3);
  if (d.basket.length > 1) kb.text("📊 Set %", "b:split:5").text("⚖️ Even split", "b:even:pick").row();
  kb.text(go("Continue ➡️"), "b:done");
  return { text, kb: withBack(kb, d) };
}

async function showBasket(ctx: BotContext, d: TelegramDraftDoc, mode: BasketMode, step: number, viaButton: boolean): Promise<void> {
  const v = await basketView(d, mode, step);
  if (viaButton) await ctx.editMessageText(v.text, { ...HTML, reply_markup: v.kb }).catch(ignoreNotModified);
  else await ctx.reply(v.text, { ...HTML, reply_markup: v.kb });
}

async function saveBasket(ctx: BotContext, d: TelegramDraftDoc, set: DraftFields, mode: BasketMode, step: number, viaButton: boolean): Promise<Toast> {
  const saved = await saveDraft(d, set);
  if (!saved) return ONE_TAP;
  await showBasket(ctx, saved, mode, step, viaButton);
}

async function onBasketToggle(ctx: BotContext, d: TelegramDraftDoc, mint: string): Promise<Toast> {
  const t = (await basketTokens()).find((x) => x.mint === mint);
  if (!t) return "That stock isn't on the allowlist.";
  if (d.basket.some((b) => b.mint === mint)) return saveBasket(ctx, d, { basket: withRemoved(d.basket, (b) => b.mint === mint) }, "pick", 5, true);
  if (d.basket.length >= MAX_BASKET) return `At most ${MAX_BASKET} stocks.`;
  return saveBasket(ctx, d, { basket: withAdded(d.basket, { mint: t.mint, symbol: t.symbol, tokenProgram: t.tokenProgram, weight: 0 }) }, "pick", 5, true);
}

async function onBasketCallback(ctx: BotContext, d: TelegramDraftDoc, parts: string[]): Promise<Toast> {
  const [, action, a, b, c] = parts;
  const step = (x: string | undefined) => (x === "1" ? 1 : 5);
  switch (action) {
    case "pick":
      await showBasket(ctx, d, "pick", 5, true);
      return;
    case "split":
      if (d.basket.length < 2) return "Add a second stock to split between.";
      await showBasket(ctx, d, "split", step(a), true);
      return;
    case "even":
      return saveBasket(ctx, d, { basket: evenWeights(d.basket) }, a === "split" ? "split" : "pick", 5, true);
    case "w": {
      const i = Number(a);
      const delta = Number(b);
      if (!d.basket[i] || ![1, 5].includes(Math.abs(delta))) return;
      const weight = Math.min(99, Math.max(1, d.basket[i].weight + delta));
      if (weight === d.basket[i].weight) return delta < 0 ? "Each stock needs at least 1%." : "That's the most one stock can take.";
      return saveBasket(ctx, d, { basket: d.basket.map((x, k) => (k === i ? { ...x, weight } : x)) }, "split", step(c), true);
    }
    case "set": {
      const x = d.basket[Number(a)];
      if (!x) return;
      const saved = await saveDraft(d, { weightFor: x.mint });
      if (!saved) return ONE_TAP;
      await ctx.reply(`✏️ What share should <b>${esc(x.symbol)}</b> get?\n${hint(`Send a whole number. It's ${x.weight}% now.`)}`, HTML);
      return;
    }
    case "done": {
      if (d.basket.length === 0) return "Pick at least one stock.";
      if (total(d) !== 100) return `The split adds up to ${total(d)}%. It has to be exactly 100%.`;
      if (!basketValid(d.basket.map((x) => x.weight))) return "Each stock needs at least 1%.";
      await answer(ctx, d, {});
      return;
    }
    default:
      return onBasketToggle(ctx, d, action);
  }
}

async function onBasketText(ctx: BotContext, d: TelegramDraftDoc, t: string): Promise<void> {
  const parts = t.split(/[\s,%]+/).filter(Boolean);
  const numbers = parts.length > 0 && parts.every((x) => /^\d+$/.test(x));
  // one number after tapping a stock in the split view
  if (numbers && parts.length === 1 && d.weightFor && d.basket.some((b) => b.mint === d.weightFor)) {
    const weight = Number(parts[0]);
    if (weight < 1 || weight > 99) return void (await warn(ctx, "Send a whole percent between 1 and 99."));
    await saveBasket(ctx, d, { basket: d.basket.map((b) => (b.mint === d.weightFor ? { ...b, weight } : b)), weightFor: null }, "split", 5, false);
    return;
  }
  // the whole split at once, in basket order
  if (numbers) {
    const weights = parts.map(Number);
    if (weights.length !== d.basket.length) return void (await warn(ctx, `Send ${d.basket.length} numbers, one per stock in the basket, in order.`));
    if (!basketValid(weights)) return void (await warn(ctx, "Use whole percents, each at least 1, adding up to 100."));
    await saveBasket(ctx, d, { basket: d.basket.map((b, i) => ({ ...b, weight: weights[i] })), weightFor: null }, "split", 5, false);
    return;
  }
  const tokens = await basketTokens();
  let basket = d.basket;
  const unknown: string[] = [];
  for (const p of parts) {
    const q = p.replace(/^\$/, "").toLowerCase();
    const tok = tokens.find((x) => x.mint === p || x.symbol.toLowerCase() === q || x.symbol.toLowerCase() === `${q}x`);
    if (!tok) unknown.push(p);
    else if (!basket.some((b) => b.mint === tok.mint) && basket.length < MAX_BASKET) basket = withAdded(basket, { mint: tok.mint, symbol: tok.symbol, tokenProgram: tok.tokenProgram, weight: 0 });
  }
  if (unknown.length) await warn(ctx, `Not on the allowlist: ${unknown.join(", ")}.`);
  if (basket !== d.basket) await saveBasket(ctx, d, { basket }, "pick", 5, false);
}

/* ---------------------------------------------------------------- period, first buy */

async function promptPeriod(ctx: BotContext, d: TelegramDraftDoc): Promise<void> {
  const cfg = custodialConfig();
  const periods = EPOCH_OPTIONS.filter((o) => o.seconds >= cfg.minEpochLength);
  const kb = grid(new InlineKeyboard(), periods.map((o) => [option(o.label, d.epochLength === o.seconds), `p:${o.seconds}`]), 2);
  const text = screen(
    d,
    "How often should holders get paid?",
    hint(
      `Each period ends with a snapshot of who held and for how long. The stocks land in holders' wallets about ${Math.round((landsAt(0, reviewWindowFor(600, cfg.disputeWindow))) / 60)} min after a 10-minute period closes, about ${Math.round(landsAt(0, reviewWindowFor(86_400, cfg.disputeWindow)) / 60)} min after longer ones.`,
    ),
    hint("StonkFun sends creator fees every hour or two, so short periods pay out as the fees arrive."),
  );
  await ctx.reply(text, { ...HTML, reply_markup: withBack(kb, d) });
}

async function onPeriodPick(ctx: BotContext, d: TelegramDraftDoc, seconds: number): Promise<Toast> {
  if (!EPOCH_OPTIONS.some((o) => o.seconds === seconds) || seconds < custodialConfig().minEpochLength) return "That period isn't available.";
  await answer(ctx, d, { epochLength: seconds });
}

const SOL_BUYS = ["0.1", "0.25", "0.5", "1"];

async function promptBuy(ctx: BotContext, d: TelegramDraftDoc): Promise<void> {
  const sym = d.quote?.symbol ?? "SOL";
  const isSol = !d.quote || d.quote.mint === WSOL_MINT.toBase58();
  await typing(ctx);
  const kb = isSol ? grid(new InlineKeyboard(), SOL_BUYS.map((a) => [option(`${a} SOL`, d.initialBuy === a), `buy:${a}`]), 4) : new InlineKeyboard();
  kb.text("✏️ Custom amount", "buy:custom").text(d.initialBuy ? "No first buy" : "Skip", "buy:0");
  const held = isSol ? await serverConnection().getBalance(userWallet(d.tgUserId).publicKey, "confirmed").catch(() => null) : null;
  const text = screen(
    d,
    "Buy some at launch?",
    hint(`Optional. Your ${esc(sym)} buy is the very first trade, in the same transaction, so nobody gets in before you.`),
    ...(held !== null ? ["", `Bot wallet: <b>${formatSol(held)}</b>. Launching takes about 0.03 SOL on top of the buy.`] : []),
  );
  await ctx.reply(text + nowValue(d.initialBuy && `${d.initialBuy} ${sym}`), { ...HTML, reply_markup: withBack(kb, d) });
}

/** "0.37", "0.37 SOL", "25 usdc": the amount in whole units of the quote, validated against its decimals. */
function parseBuy(t: string, d: TelegramDraftDoc): { amount: string | null } | { error: string } {
  const sym = (d.quote?.symbol ?? "SOL").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const text = t.trim().replace(new RegExp(`\\s*(sol|${sym})$`, "i"), "").trim();
  if (/^(skip|none|no|0)$/i.test(text)) return { amount: null };
  if (text.includes(",")) return { error: "Use a dot for decimals, like 0.37." };
  const decimals = d.quote?.decimals ?? 9;
  const raw = parseAmount(text, decimals);
  if (raw === null) return { error: `Send a number like 0.37 (at most ${decimals} decimals).` };
  return { amount: raw === 0n ? null : text.replace(/^\./, "0.") };
}

async function onBuyText(ctx: BotContext, d: TelegramDraftDoc, t: string): Promise<void> {
  const r = parseBuy(t, d);
  if ("error" in r) return void (await warn(ctx, r.error));
  return answer(ctx, d, { initialBuy: r.amount });
}

async function onBuyPick(ctx: BotContext, d: TelegramDraftDoc, amount: string): Promise<Toast> {
  if (amount === "custom") {
    const sym = esc(d.quote?.symbol ?? "SOL");
    await ctx.reply(`✏️ How much ${sym}?\n${hint(`Send a number, like <code>0.37</code>.`)}`, HTML);
    return;
  }
  if (amount !== "0" && !SOL_BUYS.includes(amount)) return "Pick one of the amounts.";
  await answer(ctx, d, { initialBuy: amount === "0" ? null : amount });
}

/* ---------------------------------------------------------------- review: the coin card */

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export async function sendReview(ctx: BotContext, d: TelegramDraftDoc): Promise<void> {
  const missing = missingFields(d);
  if (missing.length) {
    await ctx.reply(`Almost there. Still missing: ${missing.join(", ")}.`, { reply_markup: editKeyboard(d) });
    return;
  }
  await typing(ctx, "upload_photo");
  const quote = d.quote!;
  const cfg = custodialConfig();
  const wallet = userWallet(d.tgUserId).publicKey;
  const a = await affordability(d, wallet).catch(() => null);
  const share = cfg.protocolShareBps === 0 ? "LINKR takes 0%." : `LINKR keeps ${cfg.protocolShareBps / 100}%.`;
  const lines = [
    coinLine(d),
    hint(esc(clip(d.description!, 200))),
    "",
    "<b>Holders earn</b>",
    basketRows(d),
    `Every ${fmtDuration(d.epochLength!)}, from ${CREATOR_FEE_PCT}% of every trade. ${share}`,
    "",
    `<b>Trades against</b>  ${esc(quote.symbol)}`,
    `<b>First buy</b>  ${d.initialBuy ? `${esc(d.initialBuy)} ${esc(quote.symbol)}` : "none"}`,
    `<b>Links</b>  ${socialsLine(d.socials)}`,
  ];
  if (a) {
    lines.push("", `<b>Cost</b>  about ${formatSol(a.spend)}${d.initialBuy && quote.mint === WSOL_MINT.toBase58() ? " with your first buy" : ""}`);
    lines.push(a.shortBy > 0n ? `<b>Bot wallet</b>  ${formatSol(a.held)}  ⚠️ needs ${formatNeed(a)}` : `<b>Bot wallet</b>  ${formatSol(a.held)}  ✓ ready`);
    if (a.quoteShort) lines.push(`⚠️ The first buy needs ${esc(a.quoteShort.need)} ${esc(a.quoteShort.symbol)}. The bot wallet holds ${esc(a.quoteShort.held)}.`);
  }
  if (d.vault) lines.push("", hint("The vault is already prepared, so the stocks, payouts and quote token are fixed."));
  lines.push("", BETA_NOTE);
  const kb = new InlineKeyboard().text(go("🚀 Launch with bot wallet"), `r:bot:${d._id}`).row();
  if (!d.vault) kb.text("🔑 Use my own wallet", `r:wallet:${d._id}`).row();
  kb.text("✏️ Edit", `r:edit:${d._id}`).text(stop("✕ Cancel"), `r:cancel:${d._id}`);
  const card = await sendCard(ctx.api, ctx.chat!.id, logoImage(d), lines.join("\n"), kb);
  if (card.fileId && card.fileId !== d.logoFileId) await setDraft(d._id, { logoFileId: card.fileId });
}

function editKeyboard(d: TelegramDraftDoc): InlineKeyboard {
  const fixed = new Set<TelegramDraftStep>(d.vault ? ["quote", "basket", "period"] : []);
  const steps = STEPS.filter((s) => s !== "review" && !fixed.has(s));
  return grid(new InlineKeyboard(), steps.map((s) => [STEP_TITLE[s], `e:${s}:${d._id}`]), 3).text(go("‹ Back to the card"), `e:review:${d._id}`);
}

/* ---------------------------------------------------------------- review actions */

async function ownedDraft(ctx: BotContext, id: string): Promise<TelegramDraftDoc | string> {
  const d = await getDraft(id);
  if (!d || d.tgUserId !== ctx.user.tgUserId) return "This draft is gone.";
  if (d.status === "launched") return "Already launched.";
  if (d.status === "cancelled") return "This draft was cancelled.";
  return d;
}

/** The top-up screen: what's missing, where to send it, and one button to launch once it has arrived. */
function topUpScreen(d: TelegramDraftDoc, a: Affordability, wallet: string): { text: string; kb: InlineKeyboard } {
  const lines = ["👛 <b>Top up first</b>"];
  if (a.shortBy > 0n) {
    lines.push(`Launching needs ${formatNeed(a)} and your bot wallet holds ${formatSol(a.held)}.`, "", `Send at least <b>${formatSol(a.shortBy)}</b> to:`);
  } else if (a.quoteShort) {
    lines.push(`The first buy needs ${esc(a.quoteShort.need)} ${esc(a.quoteShort.symbol)} and your bot wallet holds ${esc(a.quoteShort.held)}.`, "", `Send the ${esc(a.quoteShort.symbol)} to:`);
  }
  lines.push(code(wallet), "", hint("Tap the address to copy it. Once it's sent, tap the button and I'll launch."));
  return { text: lines.join("\n"), kb: new InlineKeyboard().text(go("✅ I've sent it, launch"), `r:funded:${d._id}`) };
}

/**
 * Launch with the bot wallet. Short on funds, it answers with the top-up screen; that screen's button comes back
 * here with `fromTopUp`, re-checks the balance and either launches or updates the same message with what's still
 * missing, so waiting for a transfer never stacks up messages.
 */
async function onLaunchWithBot(ctx: BotContext, id: string, opts: { fromTopUp?: boolean } = {}): Promise<Toast> {
  const d = await ownedDraft(ctx, id);
  if (typeof d === "string") return d;
  if (d.status === "launching") return "Already launching…";
  const missing = missingFields(d);
  if (missing.length) {
    await ctx.reply(`Almost there. Still missing: ${missing.join(", ")}.`, { reply_markup: editKeyboard(d) });
    return;
  }
  if (custodialConfig().paused) return "Launches are paused by the protocol admin.";
  await typing(ctx);
  const wallet = userWallet(d.tgUserId).publicKey;
  const a = await affordability(d, wallet);
  if (a.shortBy > 0n || a.quoteShort) {
    const screen = topUpScreen(d, a, wallet.toBase58());
    if (opts.fromTopUp) {
      await ctx.editMessageText(screen.text, { ...HTML, reply_markup: screen.kb }).catch(ignoreNotModified);
      return a.shortBy > 0n ? `Not there yet: ${formatSol(a.shortBy)} still missing. Transfers take a few seconds.` : `The ${a.quoteShort!.symbol} hasn't arrived yet.`;
    }
    await ctx.reply(screen.text, { ...HTML, reply_markup: screen.kb });
    return "Top up the bot wallet first.";
  }
  const claimed = await claimDraftForLaunch(d._id, ctx.user.tgUserId);
  if (!claimed) return "Already launching…";
  if (opts.fromTopUp) await ctx.editMessageText(`✅ <b>Funds arrived</b>\nYour bot wallet holds ${formatSol(a.held)}. Launching now.`, HTML).catch(() => {});
  const msg = await ctx.reply(`🚀 <b>Launching $${esc(claimed.symbol ?? "")}</b>\n\n⏳ Getting started…`, HTML);
  await setDraft(claimed._id, { progressMessageId: msg.message_id });
  background("launch", () => runBotLaunch({ ...claimed, progressMessageId: msg.message_id }));
  return "Launching…";
}

async function onLaunchWithOwnWallet(ctx: BotContext, id: string): Promise<Toast> {
  const d = await ownedDraft(ctx, id);
  if (typeof d === "string") return d;
  if (d.status === "launching") return "It's launching with the bot wallet right now.";
  if (d.vault) {
    await ctx.reply("This draft already prepared a vault with the bot wallet, so it has to finish there. Tap Retry, or /launch to start a new draft.");
    return;
  }
  const missing = missingFields(d);
  if (missing.length) {
    await ctx.reply(`Almost there. Still missing: ${missing.join(", ")}.`, { reply_markup: editKeyboard(d) });
    return;
  }
  await saveDraft(d, { signer: "wallet" });
  const site = siteUrl();
  const page = `${site}/launch?draft=${d._id}`;
  const phantom = `https://phantom.app/ul/browse/${encodeURIComponent(page)}?ref=${encodeURIComponent(site)}`;
  const text = [
    "🔑 <b>Launch with your own wallet</b>",
    "",
    `The launch page opens with everything filled in. Connect your wallet and approve two transactions: one prepares the vault, one creates <b>$${esc(d.symbol ?? "")}</b>. I'll message you here when it's live.`,
    "",
    hint("On a phone, open it in Phantom. On a computer, use the browser with your wallet extension. The link holds this draft only, never a key."),
  ];
  if (!buttonableUrl(page)) text.push("", esc(page));
  const kb = buttonableUrl(page) ? new InlineKeyboard().url(go("Open in Phantom ↗"), phantom).row().url("Open in browser ↗", page) : undefined;
  await ctx.reply(text.join("\n"), { ...HTML, reply_markup: kb });
}

async function onEditMenu(ctx: BotContext, id: string): Promise<Toast> {
  const d = await ownedDraft(ctx, id);
  if (typeof d === "string") return d;
  if (d.status === "launching") return "It's launching, so nothing can change now.";
  await ctx.reply("<b>What would you like to change?</b>", { ...HTML, reply_markup: editKeyboard(d) });
}

async function onEditField(ctx: BotContext, step: TelegramDraftStep, id: string): Promise<Toast> {
  const d = await ownedDraft(ctx, id);
  if (typeof d === "string") return d;
  if (d.status === "launching") return "It's launching, so nothing can change now.";
  if (d.vault && ["quote", "basket", "period"].includes(step)) return "Fixed once the vault is prepared.";
  const saved = await saveDraft(d, { status: "editing", step, editing: step !== "review" });
  if (!saved) return ONE_TAP;
  ctx.user.draftId = saved._id;
  await prompt(ctx, saved);
}

/* ---------------------------------------------------------------- button router (launch side) */

export async function onDraftCallback(ctx: BotContext, data: string): Promise<Toast> {
  const [kind, arg, id] = data.split(":");
  switch (kind) {
    case "d":
      return arg === "new" ? startLaunch(ctx, true) : continueDraft(ctx);
    case "nav":
      return onBack(ctx);
    case "r":
      if (arg === "bot") return onLaunchWithBot(ctx, id);
      if (arg === "funded") return onLaunchWithBot(ctx, id, { fromTopUp: true });
      if (arg === "wallet") return onLaunchWithOwnWallet(ctx, id);
      if (arg === "edit") return onEditMenu(ctx, id);
      if (arg === "cancel") {
        const d = await ownedDraft(ctx, id);
        return typeof d === "string" ? d : cancelDraftWithReply(ctx, d);
      }
      return;
    case "e":
      return onEditField(ctx, arg as TelegramDraftStep, id);
  }
  // step buttons act on the active draft, and only at their own step
  const d = await activeDraft(ctx.user);
  if (!d || d.status !== "editing") return "No draft in progress. /launch starts one.";
  const at = (step: TelegramDraftStep) => d.step === step;
  switch (kind) {
    case "soc":
      return at("socials") ? onSocialsCallback(ctx, d, arg, id) : STEP_DONE;
    case "q":
      return at("quote") ? onQuotePick(ctx, d, arg) : STEP_DONE;
    case "b":
      return at("basket") ? onBasketCallback(ctx, d, data.split(":")) : STEP_DONE;
    case "p":
      return at("period") ? onPeriodPick(ctx, d, Number(arg)) : STEP_DONE;
    case "buy":
      return at("buy") ? onBuyPick(ctx, d, arg) : STEP_DONE;
  }
  return;
}
