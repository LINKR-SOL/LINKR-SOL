"use client";

import { useQuery } from "@tanstack/react-query";
import type { Feed, LiveEnvelope, Market, Pulse } from "@/lib/stonkfun/types";
import type { StockQuote } from "@/lib/xstocks/quotes";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export interface NarrativeMember {
  symbol: string;
  name: string;
  mint: string;
  logoUrl: string | null;
  priceUsd: number | null;
  change24h: number | null;
  liquidityUsd: number | null;
}

export interface NarrativeLive {
  id: string;
  name: string;
  thesis: string;
  dispersion: string;
  accent: string;
  size: number;
  members: NarrativeMember[];
  pricedCount: number;
  best: { symbol: string; change24h: number } | null;
  worst: { symbol: string; change24h: number } | null;
  spreadPct: number | null;
  basketChange24h: number | null;
}

export interface PulsePayload {
  pulse: LiveEnvelope<Pulse>;
  stocks: { quotes: StockQuote[]; fetchedAt: number; stale: boolean };
  narratives: NarrativeLive[];
}

export interface FeedPayload extends LiveEnvelope<Feed> {
  sort: string;
  pairing: { symbol: string; kind: string; count: number; logoUrl: string | null }[];
  causaVaulted: number;
  stockPaired: number;
  sampled: number;
}

export interface TapeTrade {
  side: "buy" | "sell";
  timestamp: number;
  signature: string;
  trader: string;
  valueUsd: number | null;
  priceUsd: number | null;
  mint: string;
  symbol: string;
  name: string;
  logo: string | null;
  quoteSymbol: string;
  quoteKind: string;
  causaVaulted: boolean;
}

export interface TapePayload {
  trades: TapeTrade[];
  watched: number;
  stale: boolean;
  error: string | null;
  fetchedAt: number;
}

export type FeedSort = "recentBuys" | "marketCap" | "newest" | "graduating" | "graduated";

/** Network totals, live xStock quotes and narrative-basket scores. */
export const usePulse = () =>
  useQuery<PulsePayload>({ queryKey: ["terminal", "pulse"], queryFn: () => get<PulsePayload>("/api/terminal/pulse"), refetchInterval: 60_000, staleTime: 30_000 });

/** Live StonkFun launch feed. */
export const useFeed = (sort: FeedSort, limit = 60) =>
  useQuery<FeedPayload>({
    queryKey: ["terminal", "feed", sort, limit],
    queryFn: () => get<FeedPayload>(`/api/terminal/feed?sort=${sort}&limit=${limit}`),
    refetchInterval: 20_000,
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });

/** Merged trade tape across the busiest coins. */
export const useTape = (limit = 24) =>
  useQuery<TapePayload>({ queryKey: ["terminal", "tape", limit], queryFn: () => get<TapePayload>(`/api/terminal/tape?limit=${limit}`), refetchInterval: 12_000, staleTime: 6_000 });

export const useMarket = (mint: string | null) =>
  useQuery<LiveEnvelope<Market>>({
    queryKey: ["terminal", "market", mint],
    queryFn: () => get<LiveEnvelope<Market>>(`/api/terminal/market/${mint}`),
    enabled: Boolean(mint),
    refetchInterval: 15_000,
  });
