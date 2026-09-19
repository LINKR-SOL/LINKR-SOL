import { randomBytes } from "node:crypto";
import { activeCluster } from "../solana/cluster";
import { collections } from "../db/collections";
import type { TelegramDraftDoc, TelegramUserDoc } from "../db/types";
import { userWallet } from "./wallets";
import { telegramApi } from "./api";
import { sendLiveCard } from "./cards";

const cluster = activeCluster;

export const telegramUserId = (tgUserId: number) => `${cluster}:${tgUserId}`;
export const DRAFT_ID = /^[A-Za-z0-9_-]{22}$/;

/** A launch that has not been heard from for this long is treated as dead and may be retried. */
const LAUNCH_STALE_MS = 6 * 60_000;

/** Loads (or creates) the user and checks their bot wallet still derives to the address they were shown. */
export async function upsertTelegramUser(from: { id: number; username?: string; first_name?: string }, chatId: number): Promise<TelegramUserDoc> {
  const c = await collections();
  const now = new Date();
  const wallet = userWallet(from.id).publicKey.toBase58();
  const doc = await c.tgUsers.findOneAndUpdate(
    { _id: telegramUserId(from.id) },
    {
      $set: { chatId, username: from.username ?? null, firstName: from.first_name ?? null, lastSeenAt: now },
      $setOnInsert: { cluster, tgUserId: from.id, wallet, draftId: null, awaiting: null, pendingWithdraw: null, createdAt: now },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (!doc) throw new Error("could not load the Telegram user");
  // a different TELEGRAM_WALLET_SECRET would silently hand the user a new, empty wallet; refuse instead
  if (doc.wallet !== wallet) throw new Error("bot wallet mismatch: TELEGRAM_WALLET_SECRET differs from the one this user's wallet was created with");
  return doc;
}

export async function setUser(tgUserId: number, set: Partial<Omit<TelegramUserDoc, "_id">>): Promise<void> {
  const c = await collections();
  await c.tgUsers.updateOne({ _id: telegramUserId(tgUserId) }, { $set: set });
}

export async function getDraft(id: string): Promise<TelegramDraftDoc | null> {
  if (!DRAFT_ID.test(id)) return null;
  const c = await collections();
  return c.tgDrafts.findOne({ _id: id, cluster });
}

/** The draft the user is working on: still being edited, launching, or failed and waiting for a retry. */
export async function activeDraft(user: TelegramUserDoc): Promise<TelegramDraftDoc | null> {
  if (!user.draftId) return null;
  const d = await getDraft(user.draftId);
  return d && d.tgUserId === user.tgUserId && ["editing", "launching", "failed"].includes(d.status) ? d : null;
}

export async function createDraft(user: TelegramUserDoc): Promise<TelegramDraftDoc> {
  const c = await collections();
  const now = new Date();
  const d: TelegramDraftDoc = {
    _id: randomBytes(16).toString("base64url"),
    cluster,
    tgUserId: user.tgUserId,
    chatId: user.chatId,
    status: "editing",
    step: "name",
    editing: false,
    rev: 0,
    name: null,
    symbol: null,
    logo: null,
    description: null,
    socials: {},
    quote: null,
    basket: [],
    epochLength: null,
    initialBuy: null,
    signer: null,
    salt: null,
    vault: null,
    mint: null,
    prepareSignature: null,
    launchSignature: null,
    progressMessageId: null,
    error: null,
    launchedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await c.tgDrafts.insertOne(d);
  await setUser(user.tgUserId, { draftId: d._id, awaiting: null });
  return d;
}

export type DraftFields = Partial<Omit<TelegramDraftDoc, "_id" | "rev" | "cluster" | "tgUserId" | "createdAt">>;

/**
 * Writes `set` only if nobody changed the draft since `d` was read (two messages sent in quick succession are
 * handled concurrently). Returns the new draft, or null when the draft moved on.
 */
export async function saveDraft(d: TelegramDraftDoc, set: DraftFields): Promise<TelegramDraftDoc | null> {
  const c = await collections();
  return c.tgDrafts.findOneAndUpdate({ _id: d._id, rev: d.rev }, { $set: { ...set, updatedAt: new Date() }, $inc: { rev: 1 } }, { returnDocument: "after" });
}

/** Unconditional write, for the one process that owns a launching draft. */
export async function setDraft(id: string, set: DraftFields): Promise<void> {
  const c = await collections();
  await c.tgDrafts.updateOne({ _id: id }, { $set: { ...set, updatedAt: new Date() }, $inc: { rev: 1 } });
}

/** Moves a draft into `launching` for exactly one caller; a double tap or a retried update gets null. */
export async function claimDraftForLaunch(id: string, tgUserId: number): Promise<TelegramDraftDoc | null> {
  const c = await collections();
  const staleBefore = new Date(Date.now() - LAUNCH_STALE_MS);
  return c.tgDrafts.findOneAndUpdate(
    { _id: id, cluster, tgUserId, $or: [{ status: { $in: ["editing", "failed"] } }, { status: "launching", updatedAt: { $lt: staleBefore } }] },
    { $set: { status: "launching", signer: "bot", error: null, updatedAt: new Date() }, $inc: { rev: 1 } },
    { returnDocument: "after" },
  );
}

export async function cancelDraft(d: TelegramDraftDoc): Promise<boolean> {
  const c = await collections();
  const res = await c.tgDrafts.updateOne({ _id: d._id, status: { $in: ["editing", "failed"] } }, { $set: { status: "cancelled", updatedAt: new Date() }, $inc: { rev: 1 } });
  await c.tgUsers.updateOne({ _id: telegramUserId(d.tgUserId), draftId: d._id }, { $set: { draftId: null } });
  return res.modifiedCount === 1;
}

export async function launchedDrafts(tgUserId: number, limit = 10): Promise<TelegramDraftDoc[]> {
  const c = await collections();
  return c.tgDrafts.find({ cluster, tgUserId, status: "launched" }).sort({ launchedAt: -1 }).limit(limit).toArray();
}

/** What the web wizard needs to open prefilled from a draft (`/launch?draft=<id>`). No keys, nothing secret. */
export interface DraftForSite {
  id: string;
  name: string;
  symbol: string;
  logo: string;
  description: string;
  socials: { twitter?: string; telegram?: string; website?: string };
  quoteMint: string | null;
  initialBuy: string | null;
  basket: { mint: string; weight: number }[];
  epochLength: number | null;
}

export const draftForSite = (d: TelegramDraftDoc): DraftForSite => ({
  id: d._id,
  name: d.name ?? "",
  symbol: d.symbol ?? "",
  logo: d.logo ?? "",
  description: d.description ?? "",
  socials: d.socials ?? {},
  quoteMint: d.quote?.mint ?? null,
  initialBuy: d.initialBuy,
  basket: d.basket.map((b) => ({ mint: b.mint, weight: b.weight })),
  epochLength: d.epochLength,
});

/**
 * The web wizard launched a coin it was opened for from a Telegram draft: close the draft and tell the chat. Only
 * a launch whose on-chain creator is one of this deployment's vaults can close a draft.
 */
export async function completeDraftFromSite(id: string, p: { mint: string; vault: string; signature: string | null; symbol?: string; name?: string }): Promise<void> {
  if (!DRAFT_ID.test(id)) return;
  const c = await collections();
  if (!(await c.vaults.findOne({ _id: `${cluster}:${p.vault}` }, { projection: { _id: 1 } }))) return;
  const now = new Date();
  const d = await c.tgDrafts.findOneAndUpdate(
    { _id: id, cluster, status: { $in: ["editing", "failed"] } },
    {
      $set: {
        status: "launched",
        signer: "wallet",
        mint: p.mint,
        vault: p.vault,
        launchSignature: p.signature || null,
        launchedAt: now,
        error: null,
        updatedAt: now,
        ...(p.symbol ? { symbol: p.symbol } : {}),
        ...(p.name ? { name: p.name } : {}),
      },
      $inc: { rev: 1 },
    },
    { returnDocument: "after" },
  );
  if (!d) return;
  await c.tgUsers.updateOne({ _id: telegramUserId(d.tgUserId), draftId: d._id }, { $set: { draftId: null } });
  await sendLiveCard(telegramApi(), d);
}

/** Records an update id; false when it was already handled (Telegram redelivers updates it got no 200 for). */
export async function firstDelivery(updateId: number): Promise<boolean> {
  const c = await collections();
  try {
    await c.tgUpdates.insertOne({ _id: `${cluster}:${updateId}`, at: new Date() });
    return true;
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return false;
    throw e;
  }
}
