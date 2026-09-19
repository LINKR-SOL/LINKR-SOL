import { PublicKey } from "@solana/web3.js";
import { getAccount, getTokenMetadata } from "@solana/spl-token";
import { activeCluster, isCustodial, VAULT_PROGRAM_KEY } from "../solana/cluster";
import { serverConnection } from "../solana/connection";
import { ata, big, readonlyProgram, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../solana/program";
import { creatorFeeVault, fetchLaunchpadPoolFor } from "../launchlab/pool";
import { collections } from "../db/collections";
import { epochDocId, launchId, vaultId } from "./ingest";

const cluster = activeCluster;

/** Fills coin metadata and pool state for launches (bound coins and feed entries alike). */
export async function refreshLaunches(mints: string[]): Promise<void> {
  if (mints.length === 0) return;
  const c = await collections();
  const connection = serverConnection();
  const now = new Date();
  for (const mint of mints) {
    const set: Record<string, unknown> = { updatedAt: now };
    const pk = new PublicKey(mint);
    const existing = await c.launches.findOne({ _id: launchId(mint) }, { projection: { symbol: 1, uri: 1, quoteMint: 1, graduatedAt: 1 } });
    if (existing?.quoteMint) {
      try {
        const pool = await fetchLaunchpadPoolFor(connection, pk, new PublicKey(existing.quoteMint));
        if (pool) {
          set.creator = pool.creator;
          set.complete = pool.status !== 0;
          if (pool.status !== 0 && !existing.graduatedAt) set.graduatedAt = now;
        }
      } catch {
        // RPC lagging; leave pool fields as they are
      }
    }
    if (existing && (!existing.symbol || !existing.uri)) {
      try {
        const meta = await getTokenMetadata(connection, pk, "confirmed", TOKEN_2022_PROGRAM_ID);
        if (meta) {
          set.symbol = meta.symbol;
          set.name = meta.name;
          set.uri = meta.uri;
        }
      } catch {
        // classic SPL mint (pre-create_v2 coin): metadata lives with Metaplex; the feed usually has it already
      }
    }
    await c.launches.updateOne({ _id: launchId(mint) }, { $set: set });
  }
}

/**
 * Re-reads vaults from chain, recomputes harvest totals from the indexed rows and syncs claimed totals /
 * terminal status of published epochs. Passing no addresses refreshes every vault.
 */
export async function refreshVaults(vaultAddresses?: string[]): Promise<void> {
  const c = await collections();
  const connection = serverConnection();
  const targets =
    vaultAddresses ?? (await c.vaults.find({ cluster, programId: VAULT_PROGRAM_KEY }, { projection: { address: 1 } }).toArray()).map((v) => v.address);
  if (targets.length === 0) return;
  if (isCustodial) return refreshCustodialVaults(targets);
  const program = readonlyProgram(connection);
  const now = new Date();
  const keys = targets.map((t) => new PublicKey(t));
  const states = await program.account.vault.fetchMultiple(keys);
  // Raw account infos for lamports + real data length: the IDL size only covers an empty legs Vec, while the
  // program allocates room for MAX_LEGS, so rent must come from the account as it exists on chain.
  const infos = await connection.getMultipleAccountsInfo(keys).catch(() => keys.map(() => null));

  for (let i = 0; i < targets.length; i++) {
    const s = states[i];
    if (!s) continue;
    const vault = targets[i];
    const vaultKey = keys[i];
    const [harvests, swaps] = await Promise.all([
      c.harvests.find({ cluster, vault }, { projection: { input: 1, protocolCut: 1, timestamp: 1 } }).sort({ timestamp: 1 }).toArray(),
      c.swaps.find({ cluster, vault }, { projection: { leg: 1, amountOut: 1 } }).toArray(),
    ]);
    let input = 0n;
    let cut = 0n;
    for (const h of harvests) {
      input += BigInt(h.input);
      cut += BigInt(h.protocolCut);
    }
    const legs = s.legs as { mint: PublicKey; tokenProgram: PublicKey; decimals: number; weightBps: number; unallocated: unknown; allocated: unknown; pendingSwap: unknown; harvestedTotal: unknown }[];

    // what is collectable but not yet harvested: lamports on the PDA above rent + unaccounted WSOL in the ATA
    const info = infos[i];
    const lamports = info?.lamports ?? 0;
    const rent = info ? await connection.getMinimumBalanceForRentExemption(info.data.length).catch(() => lamports) : lamports;
    const idleLamports = BigInt(Math.max(0, lamports - rent));
    let quoteAmount = 0n;
    try {
      const q = await getAccount(connection, ata(vaultKey, s.quoteMint, s.quoteTokenProgram), "confirmed", s.quoteTokenProgram);
      quoteAmount = q.amount;
    } catch {
      // ATA not created yet
    }
    let quoteAccounted = 0n;
    for (const l of legs) {
      if (l.mint.equals(s.quoteMint)) quoteAccounted += big(l.unallocated as never) + big(l.allocated as never);
      quoteAccounted += big(l.pendingSwap as never);
    }
    const idleQuote = quoteAmount > quoteAccounted ? quoteAmount - quoteAccounted : 0n;
    let creatorVaultBalance = "0";
    try {
      creatorVaultBalance = (await getAccount(connection, creatorFeeVault(vaultKey, s.quoteMint), "confirmed", s.quoteTokenProgram)).amount.toString();
    } catch {
      // no fee vault yet — the vault can still be harvested from idle balances
    }

    const bound = !s.launchMint.equals(PublicKey.default);
    const set: Record<string, unknown> = {
      basket: legs.map((l) => ({ mint: l.mint.toBase58(), tokenProgram: l.tokenProgram.toBase58(), decimals: l.decimals, weightBps: l.weightBps })),
      quoteMint: s.quoteMint.toBase58(),
      quoteTokenProgram: s.quoteTokenProgram.toBase58(),
      quoteDecimals: 9,
      epochLength: s.epochLength,
      unallocated: legs.map((l) => big(l.unallocated as never).toString()),
      allocated: legs.map((l) => big(l.allocated as never).toString()),
      pendingSwap: legs.map((l) => big(l.pendingSwap as never).toString()),
      harvestedTotals: legs.map((l) => big(l.harvestedTotal as never).toString()),
      creatorVaultBalance,
      idleLamports: idleLamports.toString(),
      idleQuote: idleQuote.toString(),
      inputTotal: input.toString(),
      protocolCutTotal: cut.toString(),
      harvestCount: harvests.length,
      lastHarvestAt: harvests.length ? harvests[harvests.length - 1].timestamp : null,
      swapCount: swaps.length,
      epochCount: Number(s.epochCount),
      lastPeriodEnd: bound ? Number(s.lastPeriodEnd) : null,
      autoClaim: s.autoClaim,
      updatedAt: now,
    };
    if (bound) {
      // binding is irreversible, so chain state may fill it in even if the LaunchBound event was missed
      set.launchMint = s.launchMint.toBase58();
      set.status = "active";
      set.boundAt = new Date(Number(s.boundAt) * 1000);
    }
    await c.vaults.updateOne({ _id: vaultId(vault) }, { $set: set });

    // Published epochs: claimed totals + terminal status from chain.
    const open = await c.epochs.find({ cluster, vault, status: "published" }, { projection: { epochId: 1, address: 1 } }).toArray();
    if (open.length) {
      const epochKeys = open.map((e) => new PublicKey(e.address!));
      const eps = await program.account.epoch.fetchMultiple(epochKeys);
      for (let k = 0; k < open.length; k++) {
        const e = eps[k];
        if (!e) continue;
        const status = e.status as { open?: unknown; cancelled?: unknown; expired?: unknown };
        const upd: Record<string, unknown> = {
          claimedTotals: (e.legs as { claimedTotal: unknown }[]).map((l) => big(l.claimedTotal as never).toString()),
          updatedAt: now,
        };
        if ("cancelled" in status) upd.status = "cancelled";
        if ("expired" in status) upd.status = "expired";
        await c.epochs.updateOne({ _id: epochDocId(vault, open[k].epochId) }, { $set: upd });
      }
    }
  }
}

export { TOKEN_PROGRAM_ID };

/**
 * Custodial vaults: the ledger fields are already the keeper's, so only the live chain numbers are read — quote
 * on the vault wallet that nothing accounts for yet (StonkFun's forwarded fees) and LaunchLab's unclaimed
 * on-chain creator fee — and the stock balances are checked against the ledger so a drift (a donation, a paused
 * stock) shows up as idle rather than silently.
 */
async function refreshCustodialVaults(targets: string[]): Promise<void> {
  const c = await collections();
  const connection = serverConnection();
  const { idleQuoteOf } = await import("../custody/keeper");
  const now = new Date();
  const floor = BigInt(await connection.getMinimumBalanceForRentExemption(0));
  for (const address of targets) {
    const v = await c.vaults.findOne({ _id: vaultId(address) });
    if (!v || v.programId !== VAULT_PROGRAM_KEY) continue;
    const key = new PublicKey(address);
    const quoteMint = new PublicKey(v.quoteMint);
    const quoteProgram = new PublicKey(v.quoteTokenProgram ?? TOKEN_PROGRAM_ID.toBase58());
    const isSol = v.quoteMint === "So11111111111111111111111111111111111111112";
    const q = { mint: quoteMint, program: quoteProgram, decimals: v.quoteDecimals ?? 9, isSol, ata: ata(key, quoteMint, quoteProgram) };
    const idle = await idleQuoteOf(v, key, q, floor).catch(() => 0n);
    let creatorVaultBalance = "0";
    try {
      creatorVaultBalance = (await getAccount(connection, creatorFeeVault(key, quoteMint), "confirmed", quoteProgram)).amount.toString();
    } catch {
      // no fee vault yet: nothing accrued on chain
    }
    await c.vaults.updateOne(
      { _id: vaultId(address) },
      { $set: { creatorVaultBalance, idleLamports: isSol ? idle.toString() : "0", idleQuote: isSol ? "0" : idle.toString(), updatedAt: now } },
    );
  }
}
