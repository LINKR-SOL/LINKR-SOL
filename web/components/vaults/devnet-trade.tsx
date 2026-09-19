"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { useSolanaTx } from "@/lib/hooks/useSolanaTx";
import { parseAmount } from "@/lib/format";
import { LAUNCHLAB_PROGRAM_ID } from "@/lib/launchlab/ids";
import { fetchLaunchpadPoolFor } from "@/lib/launchlab/pool";
import { buyIxs, sellIxs, type TradeParams } from "@/lib/launchlab/tx";
import { AmountInput, Button, Card } from "@/components/ui/primitives";

/**
 * Devnet only: StonkFun's site trades mainnet coins, so on devnet the only way to move a coin's curve (and so to
 * generate creator fees for its vault) is to send the buy/sell instructions yourself. This does that with the
 * connected wallet, straight against LaunchLab's devnet program. LINKR's devnet platform pays a 0.5% creator
 * fee on chain, which the keeper claims into the vault.
 */
export function DevnetTrade({ mint, symbol, quote }: { mint: string; symbol: string; quote: { mint: string; tokenProgram: string; decimals: number; symbol: string } }) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const tx = useSolanaTx();
  const [buyAmount, setBuyAmount] = useState("0.01");
  const [sellPct, setSellPct] = useState("50");
  const mintKey = new PublicKey(mint);
  const quoteKey = new PublicKey(quote.mint);
  const ticker = symbol.startsWith("$") ? symbol : `$${symbol}`;

  async function params(owner: PublicKey): Promise<TradeParams> {
    const pool = await fetchLaunchpadPoolFor(connection, mintKey, quoteKey);
    if (!pool) throw new Error("launch pool not found on this cluster");
    if (pool.status !== 0) throw new Error("this coin has graduated; trade it on Raydium");
    return {
      programId: LAUNCHLAB_PROGRAM_ID,
      configId: new PublicKey(pool.configId),
      platformId: new PublicKey(pool.platformId),
      creator: new PublicKey(pool.creator),
      mint: mintKey,
      quote: quoteKey,
      quoteTokenProgram: new PublicKey(quote.tokenProgram),
      owner,
    };
  }

  async function heldBy(owner: PublicKey): Promise<bigint> {
    const res = await connection.getParsedTokenAccountsByOwner(owner, { mint: mintKey }, "confirmed");
    let total = 0n;
    for (const a of res.value) {
      const amt = (a.account.data as { parsed?: { info?: { tokenAmount?: { amount: string } } } }).parsed?.info?.tokenAmount?.amount;
      if (amt) total += BigInt(amt);
    }
    return total;
  }

  async function onBuy() {
    const amount = parseAmount(buyAmount, quote.decimals);
    if (!amount) return;
    await tx.run(async ({ payer }) => ({ instructions: buyIxs(await params(payer), amount, 1n), computeUnits: 400_000 }), `Buy ${ticker}`);
  }

  async function onSell() {
    const pct = Number(sellPct);
    if (!(pct > 0 && pct <= 100)) return;
    await tx.run(async ({ payer }) => {
      const held = await heldBy(payer);
      const amount = (held * BigInt(Math.round(pct * 100))) / 10_000n;
      if (amount === 0n) throw new Error(`you hold no ${ticker} in this wallet`);
      return { instructions: sellIxs(await params(payer), amount, 1n), computeUnits: 400_000 };
    }, `Sell ${ticker}`);
  }

  return (
    <Card title={`Trade ${ticker} on devnet`} action={<span className="text-xs text-muted">StonkFun&apos;s site only shows mainnet coins</span>}>
      <p className="text-sm text-muted mb-3">
        Every buy or sell here goes straight to LaunchLab&apos;s devnet program and pays 0.5% of the trade into this vault as creator fees. Trade from a
        second wallet too to see a payout split between holders.
      </p>
      {!publicKey ? (
        <Button size="sm" onClick={() => setVisible(true)}>
          Connect wallet
        </Button>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          <AmountInput
            value={buyAmount}
            onChange={setBuyAmount}
            placeholder={`${quote.symbol} to spend`}
            right={
              <Button size="sm" loading={tx.busy} disabled={!parseAmount(buyAmount, quote.decimals)} onClick={onBuy}>
                Buy
              </Button>
            }
            below={<span>Spends {quote.symbol} on the curve. Devnet: no slippage floor.</span>}
          />
          <AmountInput
            value={sellPct}
            onChange={setSellPct}
            placeholder="% of your holding"
            right={
              <Button size="sm" variant="secondary" loading={tx.busy} disabled={!(Number(sellPct) > 0 && Number(sellPct) <= 100)} onClick={onSell}>
                Sell
              </Button>
            }
            below={<span>Sells that share of the {ticker} this wallet holds.</span>}
          />
        </div>
      )}
    </Card>
  );
}
