"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { ArrowUpRight } from "@/components/ui/icons";
import { activeCluster, clusterLabel, explorerAddressUrl, PROGRAM_ID } from "@/lib/solana/cluster";
import { basketPda, configPda } from "@/lib/solana/program";
import { EVENT_AUTHORITY } from "@/lib/solana/ix";
import { readMintExtensions } from "@/lib/xstocks/extensions";
import { useConnection } from "@solana/wallet-adapter-react";
import { useSolanaTx } from "@/lib/hooks/useSolanaTx";
import { useProgram } from "@/lib/hooks/useProgram";
import { bn } from "@/lib/solana/program";
import { shortAddress } from "@/lib/format";
import { isBase58Address } from "@/lib/solana/address";
import { Badge, Button, Callout, Card, Input, Stat } from "@/components/ui/primitives";

const fmtWindow = (s: number) => (s % 86_400 === 0 ? `${s / 86_400} d` : s % 3_600 === 0 ? `${s / 3_600} h` : `${s} s`);
const DEFAULT = PublicKey.default.toBase58();

/** causa_vault governance: initialisation, config, basket allowlist and admin hand-over. Rendered inside the Admin page. */
export function VaultAdmin() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const program = useProgram();
  const tx = useSolanaTx();
  const user = publicKey?.toBase58() ?? null;
  const [operator, setOperator] = useState("");
  const [shareBps, setShareBps] = useState("");
  const [shareRecipient, setShareRecipient] = useState("");
  const [dispute, setDispute] = useState("");
  const [claimWin, setClaimWin] = useState("");
  const [minEpoch, setMinEpoch] = useState("");
  const [basketMint, setBasketMint] = useState("");
  const [newAdmin, setNewAdmin] = useState("");

  const cfg = useQuery({
    queryKey: ["admin", "config", PROGRAM_ID.toBase58()],
    queryFn: async () => {
      const c = await program.account.config.fetchNullable(configPda());
      const allowed = await program.account.allowedBasketMint.all();
      const vaults = await program.account.vault.all();
      return { c, allowed: allowed.map((a) => (a.account.mint as PublicKey).toBase58()), vaultCount: vaults.length };
    },
    refetchInterval: 10_000,
  });
  const c = cfg.data?.c ?? null;
  const isAdmin = !!user && !!c && c.admin.toBase58() === user;
  const isPending = !!user && !!c && c.pendingAdmin.toBase58() !== DEFAULT && c.pendingAdmin.toBase58() === user;

  const run = (label: string, build: (payer: PublicKey) => Promise<import("@solana/web3.js").TransactionInstruction>) =>
    tx.run(async ({ payer }) => ({ instructions: [await build(payer)] }), label).then(() => cfg.refetch());

  const updateConfig = (label: string, params: Partial<{ operator: PublicKey; protocolShareBps: number; protocolRecipient: PublicKey; disputeWindow: number; claimWindow: number; minEpochLength: number; paused: boolean }>) =>
    run(label, (payer) =>
      program.methods
        .updateConfig({
          operator: params.operator ?? null,
          protocolShareBps: params.protocolShareBps ?? null,
          protocolRecipient: params.protocolRecipient ?? null,
          disputeWindow: params.disputeWindow ?? null,
          claimWindow: params.claimWindow ?? null,
          minEpochLength: params.minEpochLength ?? null,
          paused: params.paused ?? null,
        })
        .accountsStrict({ admin: payer, config: configPda(), eventAuthority: EVENT_AUTHORITY, program: PROGRAM_ID })
        .instruction(),
    );

  async function initConfig() {
    const op = isBase58Address(operator) ? new PublicKey(operator) : publicKey!;
    await run("Initialise dividend program", (payer) =>
      program.methods
        .initConfig({ operator: op, protocolShareBps: 500, protocolRecipient: payer, disputeWindow: 300, claimWindow: 180 * 86_400, minEpochLength: 600 })
        .accountsStrict({ admin: payer, config: configPda(), systemProgram: SystemProgram.programId, eventAuthority: EVENT_AUTHORITY, program: PROGRAM_ID })
        .instruction(),
    );
  }

  async function allowMint(allowed: boolean) {
    const mint = new PublicKey(basketMint);
    if (allowed) {
      const ext = await readMintExtensions(connection, mint);
      if (!ext) throw new Error("mint not found");
      await run("Allow basket mint", (payer) =>
        program.methods
          .allowBasketMint()
          .accountsStrict({ admin: payer, config: configPda(), mint, tokenProgram: ext.tokenProgram, basket: basketPda(mint), systemProgram: SystemProgram.programId, eventAuthority: EVENT_AUTHORITY, program: PROGRAM_ID })
          .instruction(),
      );
    } else {
      await run("Revoke basket mint", (payer) =>
        program.methods.revokeBasketMint().accountsStrict({ admin: payer, config: configPda(), basket: basketPda(mint), eventAuthority: EVENT_AUTHORITY, program: PROGRAM_ID }).instruction(),
      );
    }
    setBasketMint("");
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Dividend vaults</h2>
        <p className="text-sm text-muted mt-1">
          Program{" "}
          <a href={explorerAddressUrl(PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer" className="num hover:text-text">
            {shortAddress(PROGRAM_ID.toBase58(), 6)}
            <ArrowUpRight size={12} className="inline align-[-1px] ml-0.5 opacity-60" />
          </a>{" "}
          on {clusterLabel[activeCluster]}.
        </p>
      </div>

      {cfg.isFetched && !c && (
        <Callout tone="warn">
          The program has no config on this cluster yet.{" "}
          {user ? (
            <span>
              <Input placeholder="operator (keeper) pubkey — defaults to you" value={operator} onChange={(e) => setOperator(e.target.value.trim())} className="num my-2" />
              <Button loading={tx.busy} onClick={initConfig}>
                Initialise (you become admin)
              </Button>
            </span>
          ) : (
            "Connect the deployer wallet to initialise it."
          )}
        </Callout>
      )}

      {c && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Admin" value={<span className="num text-sm">{shortAddress(c.admin.toBase58())}</span>} sub={isAdmin ? "that's you" : undefined} />
          <Stat label="Keeper (operator)" value={<span className="num text-sm">{shortAddress(c.operator.toBase58())}</span>} sub="harvests and publishes payouts" />
          <Stat label="Protocol share" value={`${c.protocolShareBps / 100}%`} sub={`to ${shortAddress(c.protocolRecipient.toBase58())}`} />
          <Stat
            label="Windows"
            value={<span className="text-sm">review {fmtWindow(c.disputeWindow)} · claim {fmtWindow(c.claimWindow)}</span>}
            sub={`min period ${fmtWindow(c.minEpochLength)} · ${cfg.data?.vaultCount ?? 0} vaults · ${c.paused ? "paused" : "live"}`}
          />
        </div>
      )}

      {isPending && (
        <Callout tone="info">
          Admin of the program has been offered to your wallet.{" "}
          <button className="underline ml-1" onClick={() => run("Accept admin", (payer) => program.methods.acceptAdmin().accountsStrict({ pendingAdmin: payer, config: configPda(), eventAuthority: EVENT_AUTHORITY, program: PROGRAM_ID }).instruction())}>
            Accept
          </button>
        </Callout>
      )}

      {isAdmin && c && (
        <Card title="Program controls">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-xs text-faint uppercase tracking-wider">Pause</div>
              <Button variant={c.paused ? "primary" : "danger"} loading={tx.busy} onClick={() => updateConfig(c.paused ? "Unpause vaults" : "Pause vaults", { paused: !c.paused })}>
                {c.paused ? "Unpause" : "Pause vault creation & harvests"}
              </Button>
            </div>
            <div className="space-y-2">
              <div className="text-xs text-faint uppercase tracking-wider">Keeper operator</div>
              <div className="flex gap-2">
                <Input placeholder="pubkey" value={operator} onChange={(e) => setOperator(e.target.value.trim())} className="num" />
                <Button variant="secondary" disabled={!isBase58Address(operator)} onClick={() => updateConfig("Set operator", { operator: new PublicKey(operator) })}>
                  Set
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs text-faint uppercase tracking-wider">Protocol share (bps, max 2000) + recipient</div>
              <div className="flex gap-2">
                <Input inputMode="numeric" placeholder="500 = 5%" value={shareBps} onChange={(e) => setShareBps(e.target.value.replace(/[^\d]/g, ""))} />
                <Input placeholder="recipient pubkey" value={shareRecipient} onChange={(e) => setShareRecipient(e.target.value.trim())} className="num" />
                <Button
                  variant="secondary"
                  disabled={shareBps === "" || Number(shareBps) > 2000}
                  onClick={() => updateConfig("Set protocol share", { protocolShareBps: Number(shareBps), ...(isBase58Address(shareRecipient) ? { protocolRecipient: new PublicKey(shareRecipient) } : {}) })}
                >
                  Set
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs text-faint uppercase tracking-wider">Review window / claim window / min period (seconds)</div>
              <div className="flex gap-2">
                <Input inputMode="numeric" placeholder="300" value={dispute} onChange={(e) => setDispute(e.target.value.replace(/[^\d]/g, ""))} />
                <Button variant="secondary" disabled={!dispute} onClick={() => updateConfig("Set review window", { disputeWindow: Number(dispute) })}>
                  Set
                </Button>
              </div>
              <div className="flex gap-2">
                <Input inputMode="numeric" placeholder="15552000" value={claimWin} onChange={(e) => setClaimWin(e.target.value.replace(/[^\d]/g, ""))} />
                <Button variant="secondary" disabled={!claimWin} onClick={() => updateConfig("Set claim window", { claimWindow: Number(claimWin) })}>
                  Set
                </Button>
              </div>
              <div className="flex gap-2">
                <Input inputMode="numeric" placeholder="600" value={minEpoch} onChange={(e) => setMinEpoch(e.target.value.replace(/[^\d]/g, ""))} />
                <Button variant="secondary" disabled={!minEpoch} onClick={() => updateConfig("Set min period", { minEpochLength: Number(minEpoch) })}>
                  Set
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs text-faint uppercase tracking-wider">Basket allowlist ({cfg.data?.allowed.length ?? 0} mints)</div>
              <div className="flex gap-2">
                <Input placeholder="mint" value={basketMint} onChange={(e) => setBasketMint(e.target.value.trim())} className="num" />
                <Button variant="secondary" loading={tx.busy} disabled={!isBase58Address(basketMint)} onClick={() => allowMint(true)}>
                  Allow
                </Button>
                <Button variant="ghost" loading={tx.busy} disabled={!isBase58Address(basketMint)} onClick={() => allowMint(false)}>
                  Remove
                </Button>
              </div>
              {!!cfg.data?.allowed.length && <p className="text-[11px] text-faint num break-all">{cfg.data.allowed.map((m) => shortAddress(m, 6)).join(" · ")}</p>}
            </div>
            <div className="space-y-2">
              <div className="text-xs text-faint uppercase tracking-wider">Transfer admin (2-step)</div>
              <div className="flex gap-2">
                <Input placeholder="pubkey" value={newAdmin} onChange={(e) => setNewAdmin(e.target.value.trim())} className="num" />
                <Button
                  variant="secondary"
                  disabled={!isBase58Address(newAdmin)}
                  onClick={() => run("Offer admin", (payer) => program.methods.transferAdmin(new PublicKey(newAdmin)).accountsStrict({ admin: payer, config: configPda(), eventAuthority: EVENT_AUTHORITY, program: PROGRAM_ID }).instruction())}
                >
                  Offer
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}
      {c && !isAdmin && !isPending && (
        <p className="text-sm text-muted">
          <Badge>read-only</Badge> your wallet is not the program admin.
        </p>
      )}
      <span className="hidden">{bn(0).toString()}</span>
    </div>
  );
}
