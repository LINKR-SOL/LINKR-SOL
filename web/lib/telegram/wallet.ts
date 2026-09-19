import { PublicKey, SystemProgram } from "@solana/web3.js";
import { InlineKeyboard } from "grammy";
import bs58 from "bs58";
import { activeCluster, clusterLabel, explorerTxUrl } from "../solana/cluster";
import { serverConnection } from "../solana/connection";
import { sendKeeperTx } from "../solana/send";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, coinUrl } from "../launchlab/ids";
import { collections } from "../db/collections";
import { solUsd } from "../xstocks/prices";
import { formatSol, parseAmount } from "../format";
import { launchedDrafts, setUser, telegramUserId } from "./drafts";
import { telegramApi } from "./api";
import { AIRDROP_LAG_S, fmtDuration, landsAt, reviewWindowFor } from "../launch/options";
import { autoClaimPolicy } from "../indexer/dividendKeeper";
import { background } from "./background";
import { userWallet } from "./wallets";
import type { BotContext, Toast } from "./context";
import { BETA_NOTE, HTML, buttonableUrl, code, coinLine, esc, go, homeKeyboard, link, shortAddr, stop, vaultUrl } from "./ui";
import { sendBannerCard } from "./cards";

/**
 * The bot wallet: what it holds, how to fund it, how to get funds out (withdraw SOL, or export the key into a
 * wallet app for everything else), and the coins launched from this chat.
 */

/** Base fee of a one-signature transaction with no priority fee. */
const FEE_LAMPORTS = 5_000n;
/** A withdrawal confirmation older than this is refused. */
const CONFIRM_TTL_MS = 5 * 60_000;

const usd = (lamports: bigint, price: number | null) => (price ? `  ≈ $${((Number(lamports) / 1e9) * price).toFixed(2)}` : "");

/** The welcome: the brand banner as a card, what LINKR does in two sentences, and the bot wallet at a glance. */
export async function sendHome(ctx: BotContext): Promise<void> {
  await ctx.replyWithChatAction("upload_photo").catch(() => {});
  const lamports = BigInt(await serverConnection().getBalance(new PublicKey(ctx.user.wallet), "confirmed").catch(() => 0));
  const caption = [
    "<b>Every market starts with a reason.</b>",
    "Discover the thesis. Hold the coin. Earn the stocks.",
    "",
    "Launch a coin around yours. Every trade pays 0.5% into its vault; the vault buys the stocks you pick, like NVDAx or TSLAx, and airdrops them to holders by how much and how long they hold.",
    "",
    `👛 Bot wallet  <b>${formatSol(lamports)}</b>`,
    code(ctx.user.wallet),
    "",
    BETA_NOTE,
  ].join("\n");
  await sendBannerCard(ctx.api, ctx.chat!.id, caption, homeKeyboard());
}

interface Holding {
  mint: string;
  symbol: string;
  amount: string;
}

async function holdings(owner: PublicKey): Promise<Holding[]> {
  const connection = serverConnection();
  const results = await Promise.all(
    [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) => connection.getParsedTokenAccountsByOwner(owner, { programId }, "confirmed").then((r) => r.value).catch(() => [])),
  );
  const rows = results
    .flat()
    .map((a) => a.account.data.parsed?.info as { mint: string; tokenAmount: { amount: string; uiAmountString: string } } | undefined)
    .filter((i): i is { mint: string; tokenAmount: { amount: string; uiAmountString: string } } => !!i && i.tokenAmount.amount !== "0");
  if (rows.length === 0) return [];
  const c = await collections();
  const ids = rows.map((r) => `${activeCluster}:${r.mint}`);
  const [tokens, launches] = await Promise.all([
    c.tokens.find({ _id: { $in: ids } }, { projection: { mint: 1, symbol: 1 } }).toArray(),
    c.launches.find({ _id: { $in: ids } }, { projection: { mint: 1, symbol: 1 } }).toArray(),
  ]);
  const symbols = new Map<string, string>([...launches.map((l) => [l.mint, l.symbol] as const), ...tokens.map((t) => [t.mint, t.symbol] as const)]);
  return rows.map((r) => ({ mint: r.mint, symbol: symbols.get(r.mint) || shortAddr(r.mint), amount: r.tokenAmount.uiAmountString }));
}

function walletKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔄 Refresh", "w:refresh")
    .text("📤 Withdraw", "w:withdraw")
    .row()
    .text("🔑 Export key", "w:export")
    .row()
    .text(go("🚀 Launch a coin"), "home:launch");
}

export async function sendWallet(ctx: BotContext, edit = false): Promise<void> {
  const owner = new PublicKey(ctx.user.wallet);
  const [lamports, held, price] = await Promise.all([
    serverConnection().getBalance(owner, "confirmed").then(BigInt),
    holdings(owner),
    solUsd().catch(() => null),
  ]);
  const lines = [
    `👛 <b>Bot wallet</b>  ${clusterLabel[activeCluster]}`,
    code(ctx.user.wallet),
    "<i>Tap the address to copy it.</i>",
    "",
    `<b>${formatSol(lamports)}</b>${usd(lamports, price)}`,
  ];
  if (held.length) {
    lines.push("", "<b>Tokens</b>");
    for (const h of held.slice(0, 12)) lines.push(`${esc(h.amount)}  ${esc(h.symbol)}`);
    if (held.length > 12) lines.push(`<i>and ${held.length - 12} more</i>`);
  }
  lines.push(
    "",
    `<b>Add funds</b>  Send SOL on ${clusterLabel[activeCluster]} to the address above. A launch takes about 0.03 SOL plus your first buy.`,
    "",
    "<i>Coins from your first buys and stock payouts land here. To move tokens, export the key into Phantom or Solflare.</i>",
  );
  const opts = { ...HTML, reply_markup: walletKeyboard() };
  if (edit) await ctx.editMessageText(lines.join("\n"), opts).catch(() => ctx.reply(lines.join("\n"), opts));
  else await ctx.reply(lines.join("\n"), opts);
}

/* ---------------------------------------------------------------- withdraw */

export async function startWithdraw(ctx: BotContext): Promise<void> {
  await setUser(ctx.user.tgUserId, { awaiting: "withdraw", pendingWithdraw: null });
  await ctx.reply(
    "📤 <b>Withdraw SOL</b>\nSend the amount and where to, in one message:\n\n<code>0.5 DestinationAddress</code>\n<code>all DestinationAddress</code>\n\n<i>/cancel stops.</i>",
    HTML,
  );
}

const ADDRESS = "[1-9A-HJ-NP-Za-km-z]{32,44}";
const AMOUNT = "all|max|\\d+(?:\\.\\d+)?|\\.\\d+";

export async function onWithdrawText(ctx: BotContext, text: string): Promise<void> {
  const t = text.trim();
  const m = new RegExp(`^(${AMOUNT})\\s*(?:sol)?\\s+(${ADDRESS})$`, "i").exec(t) ?? (() => {
    const r = new RegExp(`^(${ADDRESS})\\s+(${AMOUNT})\\s*(?:sol)?$`, "i").exec(t);
    return r ? [r[0], r[2], r[1]] : null;
  })();
  if (!m) {
    await ctx.reply("Send it as <code>0.5 DestinationAddress</code> or <code>all DestinationAddress</code> (use a dot for decimals). /cancel stops.", HTML);
    return;
  }
  const [, amountText, address] = m;
  let to: PublicKey;
  try {
    to = new PublicKey(address);
  } catch {
    await ctx.reply("That isn't a valid Solana address.");
    return;
  }
  if (!PublicKey.isOnCurve(to.toBytes())) {
    await ctx.reply("That address isn't a wallet. It looks like a token account or a program address, so send to a normal wallet address.");
    return;
  }
  const from = new PublicKey(ctx.user.wallet);
  if (to.equals(from)) {
    await ctx.reply("That's the bot wallet itself.");
    return;
  }
  const connection = serverConnection();
  const [balance, rentMin] = await Promise.all([connection.getBalance(from, "confirmed").then(BigInt), connection.getMinimumBalanceForRentExemption(0).then(BigInt)]);
  const all = /^(all|max)$/i.test(amountText);
  const lamports = all ? balance - FEE_LAMPORTS : parseAmount(amountText, 9);
  if (lamports === null || lamports <= 0n) {
    await ctx.reply(all ? `Nothing to withdraw. The wallet holds ${formatSol(balance)}.` : "Send an amount above zero.");
    return;
  }
  const left = balance - lamports - FEE_LAMPORTS;
  if (left < 0n) {
    await ctx.reply(`The wallet holds ${formatSol(balance)}, and the network fee is ${formatSol(FEE_LAMPORTS, 6)}.`);
    return;
  }
  if (left > 0n && left < rentMin) {
    await ctx.reply(`That would leave ${formatSol(left, 6)}, below the ${formatSol(rentMin, 6)} a Solana account must keep. Withdraw all, or leave at least that much.`);
    return;
  }
  await setUser(ctx.user.tgUserId, { awaiting: null, pendingWithdraw: { lamports: lamports.toString(), to: to.toBase58(), at: new Date() } });
  await ctx.reply(`📤 Send <b>${formatSol(lamports, 6)}</b> to\n${code(to.toBase58())}?`, {
    ...HTML,
    reply_markup: new InlineKeyboard().text(go("Send"), "wd:yes").text(stop("✕ Cancel"), "wd:no"),
  });
}

async function confirmWithdraw(ctx: BotContext): Promise<Toast> {
  const c = await collections();
  // take the pending withdrawal atomically: a double tap sends once
  const before = await c.tgUsers.findOneAndUpdate(
    { _id: telegramUserId(ctx.user.tgUserId), pendingWithdraw: { $ne: null } },
    { $set: { pendingWithdraw: null } },
    { returnDocument: "before" },
  );
  const p = before?.pendingWithdraw;
  if (!p) return "Nothing to confirm.";
  if (Date.now() - new Date(p.at).getTime() > CONFIRM_TTL_MS) return "That confirmation expired. Start the withdrawal again.";
  const chatId = ctx.chat!.id;
  const messageId = ctx.callbackQuery?.message?.message_id;
  const text = `⏳ Sending ${formatSol(BigInt(p.lamports), 6)} to ${code(p.to)}…`;
  if (messageId) await ctx.editMessageText(text, HTML).catch(() => {});
  const kp = userWallet(ctx.user.tgUserId);
  background("withdraw", async () => {
    const api = telegramApi();
    const say = (t: string) => (messageId ? api.editMessageText(chatId, messageId, t, HTML).catch(() => api.sendMessage(chatId, t, HTML)) : api.sendMessage(chatId, t, HTML));
    try {
      const ix = SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(p.to), lamports: BigInt(p.lamports) });
      // no priority fee: "withdraw all" leaves exactly the base fee, and a plain transfer lands without one
      const r = await sendKeeperTx(serverConnection(), kp, [ix], { computeUnits: 20_000, priorityFee: 0 });
      await say(`✅ <b>Sent ${formatSol(BigInt(p.lamports), 6)}</b>\nto ${code(p.to)}\n${link("View the transaction", explorerTxUrl(r.signature))}`);
    } catch (e) {
      await say(`❌ <b>The withdrawal didn't go through</b>\n${esc(String((e as Error)?.message ?? e).split("\n")[0].slice(0, 300))}`);
    }
  });
  return "Sending…";
}

/* ---------------------------------------------------------------- export */

async function exportWarning(ctx: BotContext): Promise<void> {
  await ctx.reply(
    [
      "🔑 <b>Export your private key</b>",
      "",
      "It controls this wallet and everything in it. Anyone who sees it can take the funds, and LINKR will never ask you for it.",
      "",
      "<i>Import it into Phantom or Solflare (Add wallet, then Import private key) to use this wallet outside Telegram.</i>",
    ].join("\n"),
    { ...HTML, reply_markup: new InlineKeyboard().text(stop("Show my key"), "w:export:show").text("Cancel", "w:del") },
  );
}

async function exportShow(ctx: BotContext): Promise<void> {
  await ctx.deleteMessage().catch(() => {});
  const key = bs58.encode(userWallet(ctx.user.tgUserId).secretKey);
  await ctx.reply(`🔑 <b>Private key</b> for ${code(ctx.user.wallet)}\n<i>Tap to reveal it.</i>\n\n<tg-spoiler>${key}</tg-spoiler>\n\n<i>Delete this message once it's saved.</i>`, {
    ...HTML,
    reply_markup: new InlineKeyboard().text(stop("🗑 Saved, delete this message"), "w:del"),
  });
}

/* ---------------------------------------------------------------- coins */

/** The coins launched from this chat, where to trade them, and how their holders get paid. */
export async function sendCoins(ctx: BotContext): Promise<void> {
  const drafts = await launchedDrafts(ctx.user.tgUserId);
  if (drafts.length === 0) {
    await ctx.reply("📈 <b>No coins yet</b>\nThe coins you launch from here will show up in this list.", { ...HTML, reply_markup: new InlineKeyboard().text(go("🚀 Launch a coin"), "home:launch") });
    return;
  }
  const maybeLink = (label: string, url: string) => (buttonableUrl(url) ? link(label, url) : esc(url));
  const status = await payoutStatus(drafts);
  const lines = ["📈 <b>Your coins</b>"];
  for (const d of drafts) {
    const parts = [d.mint ? link("StonkFun", coinUrl(d.mint)) : null, d.vault ? maybeLink("Vault", vaultUrl(d.vault)) : null].filter(Boolean);
    lines.push("", coinLine(d) || `<b>$${esc(d.symbol ?? "?")}</b>`, `${parts.join("   ")}   <i>${d.signer === "wallet" ? "your wallet" : "bot wallet"}</i>`);
    if (d.epochLength) lines.push(`📦 Airdropped to holders every ${fmtDuration(d.epochLength)}`);
    const st = d.vault ? status.get(d.vault) : undefined;
    if (st) lines.push(st);
  }
  lines.push("", `<i>Stocks go to every holder's wallet after each payout. Shares under $${autoClaimPolicy().minUsd} wait until they add up.</i>`);
  await ctx.reply(lines.join("\n"), { ...HTML, reply_markup: new InlineKeyboard().text(go("🚀 Launch another"), "home:launch") });
}

/** "in 4 min", "in 1 h 5 min" */
const inAbout = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return "in about a minute";
  if (s < 3_600) return `in ${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3_600);
  const m = Math.round((s % 3_600) / 60);
  return `in ${h} h${m ? ` ${m} min` : ""}`;
};

/**
 * Where each coin's payout is right now, in the same four steps as the site's payout timeline: the period running,
 * the keeper publishing, the review, the airdrop. Approximate times, relative (a chat has no timezone to show).
 */
async function payoutStatus(drafts: { vault: string | null }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const addresses = drafts.map((d) => d.vault).filter((v): v is string => !!v);
  if (!addresses.length) return out;
  const c = await collections();
  const now = Math.floor(Date.now() / 1000);
  const maxWindow = (await import("../custody/config")).custodialConfig().disputeWindow;
  const vaults = await c.vaults.find({ _id: { $in: addresses.map((a) => `${activeCluster}:${a}`) } }, { projection: { address: 1, status: 1, lastPeriodEnd: 1, epochLength: 1, epochCount: 1 } }).toArray();
  for (const v of vaults) {
    if (v.status !== "active" || v.lastPeriodEnd === null) {
      out.set(v.address, "⏳ Linking the coin to its vault, usually within a couple of minutes");
      continue;
    }
    const review = reviewWindowFor(v.epochLength, maxWindow);
    const latest = v.epochCount ? await c.epochs.findOne({ _id: `${activeCluster}:${v.address}:${v.epochCount}` }) : null;
    const owed = latest ? latest.amounts.some((a, i) => BigInt(a) > BigInt(latest.claimedTotals?.[i] ?? "0")) : false;
    if (latest && latest.status === "published" && latest.claimableAt !== null && owed && now < latest.claimableAt + 15 * 60) {
      out.set(
        v.address,
        now < latest.claimableAt
          ? `🔎 Payout #${latest.epochId} in review · in wallets ${inAbout(latest.claimableAt + AIRDROP_LAG_S - now)}`
          : `🚚 Payout #${latest.epochId} airdropping now`,
      );
      continue;
    }
    const nextClose = v.lastPeriodEnd + (Math.floor(Math.max(0, now - v.lastPeriodEnd) / v.epochLength) + 1) * v.epochLength;
    out.set(v.address, `⏱ Next payout closes ${inAbout(nextClose - now)} · in wallets ~${Math.round((landsAt(nextClose, review) - nextClose) / 60)} min later`);
  }
  return out;
}

/* ---------------------------------------------------------------- button router (wallet side) */

export async function onWalletCallback(ctx: BotContext, data: string): Promise<Toast> {
  switch (data) {
    case "w:refresh":
      await sendWallet(ctx, true);
      return "Updated";
    case "w:withdraw":
      await startWithdraw(ctx);
      return;
    case "w:export":
      await exportWarning(ctx);
      return;
    case "w:export:show":
      await exportShow(ctx);
      return;
    case "w:del":
      await ctx.deleteMessage().catch(() => {});
      return;
    case "wd:yes":
      return confirmWithdraw(ctx);
    case "wd:no":
      await setUser(ctx.user.tgUserId, { pendingWithdraw: null, awaiting: null });
      await ctx.editMessageText("Withdrawal cancelled.").catch(() => {});
      return;
  }
}
