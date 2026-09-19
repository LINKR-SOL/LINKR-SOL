import { PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { InlineKeyboard } from "grammy";
import { explorerAddressUrl, explorerTxUrl } from "../solana/cluster";
import { serverConnection } from "../solana/connection";
import { sendKeeperTx } from "../solana/send";
import { WSOL_MINT } from "../launchlab/ids";
import { launchPricing } from "../launchlab/pricing";
import { buyIxs, createLaunchIx, tradeParamsFromPricing } from "../launchlab/tx";
import { formatSol, formatUnits, parseAmount } from "../format";
import type { TelegramDraftDoc } from "../db/types";
import { basketValid } from "../launch/options";
import { readLaunchCost } from "../launch/cost";
import { registerCustodialVault } from "../launch/vault";
import { prepareVaultIxs } from "../launch/prepare";
import { pinLaunchMetadata } from "../launch/metadata";
import { recordLaunch } from "../launch/record";
import { draftMint, userWallet } from "./wallets";
import { setDraft, setUser } from "./drafts";
import { ignoreNotModified, telegramApi } from "./api";
import { HTML, esc, go, link, shortAddr, stop } from "./ui";
import { sendLiveCard } from "./cards";

/**
 * A launch signed by the bot wallet: the server-side twin of the web wizard's onCreateVault + onLaunch.
 *
 *   1. register the custodial vault, committed to the draft's mint (derived from the draft id)
 *   2. "Prepare dividend vault": the bot wallet funds the vault's floor and opens its token accounts
 *   3. "Launch on StonkFun": LaunchLab initialize_with_token_2022 with creator = vault (+ the initial buy),
 *      signed by the bot wallet and the mint
 *   4. record the launch; the keeper binds it like any other
 *
 * Every step is safe to re-run: the vault is idempotent for (creator, salt), the floor transfer is skipped when the
 * vault already holds it, and the create is skipped when the mint already exists.
 */

export function missingFields(d: TelegramDraftDoc): string[] {
  const missing: string[] = [];
  if (!d.name) missing.push("name");
  if (!d.symbol) missing.push("symbol");
  if (!d.logo) missing.push("logo");
  if (!d.description) missing.push("description");
  if (!d.quote) missing.push("quote token");
  if (!basketValid(d.basket.map((b) => b.weight))) missing.push("basket");
  if (!d.epochLength) missing.push("payout period");
  return missing;
}

export interface Affordability {
  /** lamports the bot wallet must hold */
  required: bigint;
  /** lamports it will actually spend (rent + fees + a SOL initial buy) */
  spend: bigint;
  held: bigint;
  /** lamports short, or 0 */
  shortBy: bigint;
  /** a token-quoted initial buy the wallet does not hold enough of */
  quoteShort: { symbol: string; need: string; held: string } | null;
  solUsd: number | null;
}

export async function affordability(d: TelegramDraftDoc, wallet: PublicKey): Promise<Affordability> {
  const connection = serverConnection();
  const [cost, held] = await Promise.all([readLaunchCost(Math.max(d.basket.length, 1)), connection.getBalance(wallet, "confirmed").then(BigInt)]);
  const leg = d.prepareSignature ? cost.launchOnly : cost.withVault;
  const quoteIsSol = !d.quote || d.quote.mint === WSOL_MINT.toBase58();
  const buyRaw = d.quote ? (parseAmount(d.initialBuy ?? "0", d.quote.decimals) ?? 0n) : 0n;
  const solBuy = quoteIsSol ? buyRaw : 0n;
  const required = BigInt(leg.required) + solBuy;
  let quoteShort: Affordability["quoteShort"] = null;
  if (!quoteIsSol && buyRaw > 0n && d.quote) {
    const account = getAssociatedTokenAddressSync(new PublicKey(d.quote.mint), wallet, true, new PublicKey(d.quote.tokenProgram));
    const have = await getAccount(connection, account, "confirmed", new PublicKey(d.quote.tokenProgram)).then((a) => a.amount).catch(() => 0n);
    if (have < buyRaw) quoteShort = { symbol: d.quote.symbol, need: formatUnits(buyRaw, d.quote.decimals), held: formatUnits(have, d.quote.decimals) };
  }
  return { required, spend: BigInt(leg.spend) + solBuy, held, shortBy: held < required ? required - held : 0n, quoteShort, solUsd: cost.solUsd };
}

type StageState = "waiting" | "working" | "done" | "failed";
const STAGES = ["Register the vault", "Prepare the vault", "Create the coin on StonkFun"] as const;
/** What the draft's error says went wrong, per stage. */
const STAGE_ERROR = ["registering the vault", "preparing the vault", "creating the coin"] as const;
const STATE_ICON: Record<StageState, string> = { waiting: "▫️", working: "⏳", done: "✅", failed: "❌" };

/** The launch message: every stage listed from the start, each one ticking over as it lands. */
class Progress {
  private states: StageState[] = STAGES.map(() => "waiting");
  private notes: (string | null)[] = STAGES.map(() => null);
  constructor(
    private readonly chatId: number,
    private readonly messageId: number | null,
    private readonly symbol: string,
  ) {}
  async set(i: number, state: StageState, note?: string) {
    this.states[i] = state;
    if (note) this.notes[i] = note;
    await this.render();
  }
  text(title: string, footer: string[] = []) {
    const rows = STAGES.map((label, i) => `${STATE_ICON[this.states[i]]} ${label}${this.notes[i] ? `  ${this.notes[i]}` : ""}`);
    return [title, "", ...rows, ...(footer.length ? ["", ...footer] : [])].join("\n");
  }
  launchingTitle() {
    return `🚀 <b>Launching $${this.symbol}</b>`;
  }
  private async render() {
    if (!this.messageId) return;
    await telegramApi().editMessageText(this.chatId, this.messageId, this.text(this.launchingTitle()), HTML).catch(ignoreNotModified).catch(() => {});
  }
}

function describeError(e: unknown): string {
  const msg = String((e as Error)?.message ?? e);
  if (/insufficient (funds|lamports)|custom program error: 0x1\b/i.test(msg)) return "There isn't enough SOL (or quote token) in the bot wallet for this step.";
  if (/blockhash not found|block height exceeded|expired/i.test(msg)) return "The network was busy and the transaction expired before it landed.";
  return msg.split("\n")[0].slice(0, 300);
}

/** Runs a claimed (status `launching`) draft to the end, reporting into its progress message. */
export async function runBotLaunch(d: TelegramDraftDoc): Promise<void> {
  const api = telegramApi();
  const connection = serverConnection();
  const payer = userWallet(d.tgUserId);
  const mintKp = draftMint(d._id);
  const symbol = esc(d.symbol ?? "");
  const progress = new Progress(d.chatId, d.progressMessageId, symbol);
  let stage = 0;
  try {
    const missing = missingFields(d);
    if (missing.length) throw new Error(`the draft is missing: ${missing.join(", ")}`);
    const quote = d.quote!;

    // 1. the vault, committed to this draft's mint
    await progress.set(0, "working");
    const salt = d.salt ?? (BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000))).toString();
    if (!d.salt) await setDraft(d._id, { salt });
    const reg = await registerCustodialVault({
      creator: payer.publicKey.toBase58(),
      salt,
      legs: d.basket.map((b) => ({ mint: b.mint, tokenProgram: b.tokenProgram })),
      weightsBps: d.basket.map((b) => b.weight * 100),
      epochLength: d.epochLength!,
      expectedMint: mintKp.publicKey.toBase58(),
      quoteMint: quote.mint,
    });
    const vault = new PublicKey(reg.address);
    if (d.vault !== reg.address) await setDraft(d._id, { vault: reg.address, mint: mintKp.publicKey.toBase58() });
    await progress.set(0, "done", link(shortAddr(reg.address), explorerAddressUrl(reg.address)));

    // 2. prepare: floor + token accounts
    stage = 1;
    if (!d.prepareSignature) {
      await progress.set(1, "working");
      const floor = BigInt(reg.floorLamports);
      const held = BigInt(await connection.getBalance(vault, "confirmed"));
      const ixs = prepareVaultIxs({ payer: payer.publicKey, vault, floorLamports: held >= floor ? 0n : floor, basket: reg.basket, quote: reg.quote });
      const r = await sendKeeperTx(connection, payer, ixs, { computeUnits: 200_000, priorityFee: "auto" });
      await setDraft(d._id, { prepareSignature: r.signature });
      await progress.set(1, "done", link("tx", explorerTxUrl(r.signature)));
    } else {
      await progress.set(1, "done", link("tx", explorerTxUrl(d.prepareSignature)));
    }

    // 3. the coin; an earlier attempt may have landed even though it was not recorded
    stage = 2;
    let signature = d.launchSignature ?? "";
    let uri = "";
    if (!(await connection.getAccountInfo(mintKp.publicKey, "confirmed"))) {
      await progress.set(2, "working");
      uri = await pinLaunchMetadata({ name: d.name!, symbol: d.symbol!, description: d.description!, image: d.logo!, ...d.socials });
      const pricing = await launchPricing(quote.mint);
      const instructions = [createLaunchIx({ pricing, payer: payer.publicKey, creator: vault, mint: mintKp.publicKey, name: d.name!, symbol: d.symbol!, uri })];
      // the dev buy is the pool's very first trade, in the same transaction, so nothing can get in before it
      const buyRaw = parseAmount(d.initialBuy ?? "0", quote.decimals) ?? 0n;
      if (buyRaw > 0n) instructions.push(...buyIxs(tradeParamsFromPricing(pricing, mintKp.publicKey, vault, payer.publicKey), buyRaw, 1n));
      // the create writes LaunchLab's shared platform accounts: without a priority fee it loses to paying traffic and expires
      const r = await sendKeeperTx(connection, payer, instructions, { extraSigners: [mintKp], computeUnits: 600_000, priorityFee: "auto" });
      signature = r.signature;
    }
    await progress.set(2, "done", signature ? link("tx", explorerTxUrl(signature)) : undefined);

    // 4. record it so the vault page shows the coin before the keeper binds it
    await recordLaunch({
      mint: mintKp.publicKey.toBase58(),
      quoteMint: quote.mint,
      name: d.name!,
      symbol: d.symbol!,
      uri,
      logo: d.logo!,
      description: d.description!,
      deployer: payer.publicKey.toBase58(),
      signature,
    }).catch((e) => console.error("[telegram:launch] record", e));

    const launchedAt = new Date();
    await setDraft(d._id, { status: "launched", launchSignature: signature || null, launchedAt, error: null });
    await setUser(d.tgUserId, { draftId: null });
    const final = { ...d, status: "launched" as const, vault: reg.address, mint: mintKp.publicKey.toBase58(), launchSignature: signature || null, launchedAt };
    if (d.progressMessageId) {
      await api.editMessageText(d.chatId, d.progressMessageId, progress.text(`🚀 <b>$${symbol} launched</b>`), HTML).catch(() => {});
    }
    await sendLiveCard(api, final);
  } catch (e) {
    console.error("[telegram:launch]", d._id, e);
    const reason = describeError(e);
    await setDraft(d._id, { status: "failed", error: `${STAGE_ERROR[stage]}: ${reason}` });
    await progress.set(stage, "failed");
    const kb = new InlineKeyboard().text(go("🔁 Retry"), `r:bot:${d._id}`).row().text("✏️ Edit", `r:edit:${d._id}`).text(stop("✕ Cancel"), `r:cancel:${d._id}`);
    const text = progress.text(`⚠️ <b>$${symbol} didn't launch yet</b>`, [
      esc(reason),
      `<i>Nothing is lost. Retry picks up from the step that stopped${stage === 2 ? " and reuses your prepared vault" : ""}.</i>`,
    ]);
    if (d.progressMessageId) {
      await api.editMessageText(d.chatId, d.progressMessageId, text, { ...HTML, reply_markup: kb }).catch(() => api.sendMessage(d.chatId, text, { ...HTML, reply_markup: kb }));
    } else {
      await api.sendMessage(d.chatId, text, { ...HTML, reply_markup: kb });
    }
  }
}

export const formatNeed = (a: Affordability) => `${formatSol(a.required)}${a.solUsd ? ` (≈ $${((Number(a.required) / 1e9) * a.solUsd).toFixed(2)})` : ""}`;

