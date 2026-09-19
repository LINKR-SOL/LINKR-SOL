"use client";

import { useQuery } from "@tanstack/react-query";
import type { NewsCategory, NewsEnvelope } from "@/lib/news/types";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export interface NewsPayload extends NewsEnvelope {
  category: NewsCategory | "all";
}

/** The newswire. Refreshes on the same cadence as the wire's own cache TTL. */
export function useNews({
  category = "all",
  limit = 24,
}: { category?: NewsCategory | "all"; limit?: number } = {}) {
  return useQuery<NewsPayload>({
    queryKey: ["news", category, limit],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (category !== "all") params.set("category", category);
      return get<NewsPayload>(`/api/news?${params}`);
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}
