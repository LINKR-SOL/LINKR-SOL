"use client";

import { useCallback, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletSendTransactionError } from "@solana/wallet-adapter-base";
import { useQueryClient } from "@tanstack/react-query";
import {
  ComputeBudgetProgram,
  SendTransactionError,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Keypair,
  type PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import { notifyTx } from "./useApi";
import { useToast } from "@/components/ui/toast";
import { activeCluster, clusterLabel, explorerTxUrl } from "../solana/cluster";
import { formatSol } from "../format";

export type TxStatus = "idle" | "building" | "simulating" | "signing" | "confirming" | "success" | "error";

export interface TxState {
  status: TxStatus;
  signature?: string;
  error?: string;
}

/** What a caller assembles for one transaction. Extra signers are partial signers (e.g. a fresh mint keypair). */
export interface TxBuild {
  instructions: TransactionInstruction[];
  signers?: Keypair[];
  lookupTables?: AddressLookupTableAccount[];
  computeUnits?: number;
}

const DEFAULT_COMPUTE_UNITS = 400_000;

/** Friendly message from a wallet / RPC / Anchor error (custom errors surface by their message). */
export function describeError(e: unknown): string {
  const logs: string[] | undefined = e instanceof SendTransactionError ? e.logs : (e as { logs?: string[] })?.logs;
  const fromLogs = logs && anchorMessageFromLogs(logs);
  if (fromLogs) return fromLogs;
  const message = (e as Error)?.message ?? String(e);
  // only the wallet's own refusal counts as a rejection; an API error that happens to say "denied" is not one
  if (/user rejected|rejected the request|user denied|cancel/i.test(message)) return "Transaction rejected in wallet";
  if (/custom program error: 0x0\b/i.test(message)) return "An account this transaction creates already exists — an earlier attempt probably landed. Reload the page to continue from where it got to.";
  if (/insufficient lamports|insufficient funds/i.test(message)) return "Not enough SOL in your wallet for this transaction";
  return message.length > 220 ? `${message.slice(0, 217)}…` : message;
}

function anchorMessageFromLogs(logs: string[]): string | null {
  for (const line of logs) {
    const m = /Error Message: (.+?)\.?$/.exec(line);
    if (m) return m[1];
  }
  const custom = logs.find((l) => /custom program error/i.test(l));
  return custom ? custom.replace(/^Program .* failed: /, "") : null;
}

/**
 * build -> simulate -> sign -> send -> confirm -> notify indexer -> invalidate queries. Returns the signature or throws.
 */
export function useSolanaTx() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [state, setState] = useState<TxState>({ status: "idle" });

  const run = useCallback(
    async (build: (ctx: { payer: PublicKey }) => Promise<TxBuild> | TxBuild, label = "Transaction") => {
      if (!publicKey || !signTransaction) throw new Error("Wallet not connected");
      try {
        setState({ status: "building" });
        const b = await build({ payer: publicKey });
        const instructions = [
          ComputeBudgetProgram.setComputeUnitLimit({ units: b.computeUnits ?? DEFAULT_COMPUTE_UNITS }),
          ...b.instructions,
        ];
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        const message = new TransactionMessage({ payerKey: publicKey, recentBlockhash: blockhash, instructions })
          .compileToV0Message(b.lookupTables ?? []);
        const tx = new VersionedTransaction(message);
        // extra signers (a fresh mint keypair) sign only after the wallet has: some wallets — MetaMask's Solana
        // wallet among them — refuse a transaction that already carries another signature
        const extraSigners = b.signers ?? [];

        setState({ status: "simulating" });
        const [sim, fee, balance] = await Promise.all([
          connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true }),
          connection.getFeeForMessage(message, "confirmed"),
          connection.getBalance(publicKey),
        ]);
        if (sim.value.err) {
          const reason = anchorMessageFromLogs(sim.value.logs ?? []) ?? JSON.stringify(sim.value.err);
          throw new Error(`Simulation failed: ${reason}`);
        }
        const needed = fee.value ?? 5_000;
        if (balance < needed) {
          throw new Error(`Not enough SOL. This transaction needs about ${formatSol(needed)} in fees and your wallet holds ${formatSol(balance)}.`);
        }

        setState({ status: "signing" });
        // `sendTransaction` tells the wallet which chain the RPC endpoint is on (wallet-standard `chain`), so
        // MetaMask/Phantom simulate on devnet rather than assuming mainnet. A wallet that does not list this
        // chain fails the adapter's pre-check (a bare WalletSendTransactionError) — then we sign and send ourselves.
        let signature: string;
        try {
          if (extraSigners.length) {
            const signed = await signTransaction(tx);
            signed.sign(extraSigners);
            signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 3 });
          } else {
            signature = await sendTransaction(tx, connection, { skipPreflight: true, maxRetries: 3 });
          }
        } catch (e) {
          if (!(e instanceof WalletSendTransactionError) || e.error) throw e;
          if (activeCluster !== "mainnet-beta") {
            toast.push({
              kind: "info",
              title: `Your wallet does not know ${clusterLabel[activeCluster]}`,
              body: `It may warn that the transaction reverts because it simulates on mainnet. Confirm anyway — LINKR submits it to ${clusterLabel[activeCluster]} itself.`,
            });
          }
          const signed = await signTransaction(tx);
          if (extraSigners.length) signed.sign(extraSigners);
          signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 3 });
        }
        setState({ status: "confirming", signature });
        toast.push({ kind: "info", title: `${label} submitted`, link: explorerTxUrl(signature) });
        const conf = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
        if (conf.value.err) throw new Error(`${label} failed on-chain: ${JSON.stringify(conf.value.err)}`);
        setState({ status: "success", signature });
        toast.push({ kind: "success", title: `${label} confirmed`, link: explorerTxUrl(signature) });
        await notifyTx(signature);
        await queryClient.invalidateQueries();
        return signature;
      } catch (e) {
        const message = describeError(e);
        setState({ status: "error", error: message });
        toast.push({ kind: "error", title: `${label} failed`, body: message });
        throw e;
      }
    },
    [connection, publicKey, signTransaction, sendTransaction, queryClient, toast],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);
  return { run, state, reset, busy: ["building", "simulating", "signing", "confirming"].includes(state.status) };
}
