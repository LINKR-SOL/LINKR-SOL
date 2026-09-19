"use client";

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type {
  ClaimsJson,
  EpochJson,
  EpochLeafJson,
  HarvestJson,
  LaunchCostJson,
  HarvestQuoteJson,
  LaunchJson,
  TokenJson,
  VaultConfigJson,
  VaultJson,
} from "../api-types";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export function useApi<T>(path: string | null, options: Partial<UseQueryOptions<T>> = {}) {
  return useQuery<T>({
    queryKey: ["api", path],
    queryFn: () => fetchJson<T>(path!),
    enabled: path !== null && (options.enabled ?? true),
    ...options,
  });
}

export const useTokens = (kinds?: string[]) =>
  useApi<TokenJson[]>(`/api/tokens${kinds?.length ? `?kind=${kinds.join(",")}` : ""}`, { staleTime: 60_000 });

export const useReferencePrice = (address: string | null) =>
  useApi<{ priceUsd: string | null }>(address ? `/api/tokens/${address}/reference-price` : null, { retry: false, staleTime: 60_000 });

/** Tell the indexer about a just-confirmed transaction so the UI reflects it immediately. */
export async function notifyTx(signature: string): Promise<void> {
  try {
    await fetch("/api/sync/tx", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signature }) });
  } catch {
    // best effort; the cron will pick it up
  }
}

export const useLaunches = (opts: { creator?: string | null; deployer?: string | null } = {}) => {
  const q = new URLSearchParams();
  if (opts.creator) q.set("creator", opts.creator);
  if (opts.deployer) q.set("deployer", opts.deployer);
  return useApi<{ launches: LaunchJson[] }>(`/api/launches?${q.toString()}`, { refetchInterval: 20_000 });
};

/** Registers a coin the wizard just created so the vault page shows it before the keeper binds it; `draft` is the Telegram draft it came from. */
export async function registerLaunch(body: { mint: string; quoteMint?: string; name?: string; symbol?: string; uri?: string; logo?: string; description?: string; deployer?: string; signature?: string; draft?: string }): Promise<void> {
  try {
    await fetch("/api/launches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    // best effort; the keeper finds the coin on chain anyway
  }
}

// --- dividend vaults ---

export const useVaults = (opts: { creator?: string | null; mint?: string | null } = {}) => {
  const q = new URLSearchParams();
  if (opts.creator) q.set("creator", opts.creator);
  if (opts.mint) q.set("mint", opts.mint);
  return useApi<{ vaults: VaultJson[] }>(`/api/vaults?${q.toString()}`, { refetchInterval: 20_000 });
};

export const useVault = (address: string | null) =>
  useApi<VaultJson>(address ? `/api/vaults/${address}?refresh=1` : null, { refetchInterval: 15_000 });

export const useVaultEpochs = (address: string | null) =>
  useApi<{ epochs: EpochJson[] }>(address ? `/api/vaults/${address}/epochs` : null, { refetchInterval: 20_000 });

export const useVaultHarvests = (address: string | null) =>
  useApi<{ harvests: HarvestJson[] }>(address ? `/api/vaults/${address}/harvests` : null, { refetchInterval: 30_000 });

export const useEpochLeaves = (address: string | null, epochId: number | null) =>
  useApi<{ epoch: EpochJson; leaves: EpochLeafJson[]; total: number }>(
    address && epochId ? `/api/vaults/${address}/epochs/${epochId}/leaves` : null,
    { staleTime: 60_000 },
  );

export const useHarvestQuote = (address: string | null, enabled = true) =>
  useApi<HarvestQuoteJson>(address && enabled ? `/api/vaults/${address}/harvest-quote` : null, {
    refetchInterval: 20_000,
    retry: false,
  });

export const useClaims = (account: string | null) =>
  useApi<ClaimsJson>(account ? `/api/claims/${account}` : null, { refetchInterval: 20_000 });

export const useLaunchCost = (legs = 3) =>
  useApi<LaunchCostJson>(`/api/launch/cost?legs=${legs}`, { refetchInterval: 30_000, retry: false });

export const useVaultConfig = () => useApi<VaultConfigJson>("/api/vaults/config", { staleTime: 60_000, retry: false });
