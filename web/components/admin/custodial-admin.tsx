"use client";

import { useVaultConfig, useVaults } from "@/lib/hooks/useApi";
import { clusterLabel, activeCluster } from "@/lib/solana/cluster";
import { Badge, Callout, Card, Skeleton, Stat } from "@/components/ui/primitives";
import { TokenIcon } from "@/components/token-icon";
import { fmtDuration } from "@/lib/launch/options";

/**
 * Custodial deployments have no on-chain Config to govern: the policy lives in the server environment and this
 * page shows what the keeper is running with, so an operator can check a deploy at a glance.
 */
export function CustodialAdmin() {
  const { data: cfg, isLoading, error } = useVaultConfig();
  const { data: vaults } = useVaults({});
  if (isLoading) return <Skeleton className="h-48" />;
  if (error || !cfg) return <Callout tone="danger">Config unavailable: the server could not read its environment.</Callout>;
  const list = vaults?.vaults ?? [];
  return (
    <div className="space-y-4">
      <Callout tone="info">
        Custodial mode on {clusterLabel[activeCluster]}: vaults are wallets derived from the keeper key, payouts are computed by the keeper and each
        one&apos;s Merkle root is written on-chain as a memo. Change these settings in the hosting environment (see <code>.env.example</code>) and redeploy.
      </Callout>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Keeper" value={<span className="num text-xs break-all">{cfg.operator}</span>} sub="operator + fee payer" />
        <Stat label="Protocol share" value={`${cfg.protocolShareBps / 100}%`} sub={<span className="num text-[10px] break-all">{cfg.protocolRecipient}</span>} />
        <Stat label="Review / claim window" value={`${fmtDuration(cfg.disputeWindow)} / ${fmtDuration(cfg.claimWindow)}`} sub={`min period ${fmtDuration(cfg.minEpochLength)}`} />
        <Stat label="Vaults" value={list.length} sub={cfg.paused ? "PAUSED" : `${list.filter((v) => v.status === "active").length} active`} />
      </div>
      <Card title="Allowed basket stocks" action={<Badge tone={cfg.paused ? "danger" : "success"}>{cfg.paused ? "paused" : "running"}</Badge>}>
        {cfg.basketTokens.length === 0 ? (
          <p className="text-sm text-muted">BASKET_ALLOWLIST is empty — creators cannot pick any stock.</p>
        ) : (
          <ul className="grid sm:grid-cols-2 gap-2 text-sm">
            {cfg.basketTokens.map((t) => (
              <li key={t.mint} className="flex items-center gap-2">
                <TokenIcon symbol={t.symbol} address={t.mint} logoUrl={t.logoUrl} size={20} />
                <span className="font-medium">{t.symbol}</span>
                <span className="text-muted truncate">{t.name}</span>
                <span className="ml-auto num text-xs text-faint">{t.mint.slice(0, 4)}…{t.mint.slice(-4)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
