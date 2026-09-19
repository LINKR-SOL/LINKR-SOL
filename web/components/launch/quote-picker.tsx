"use client";

import { useMemo, useState } from "react";
import { MagnifyingGlass } from "@/components/ui/icons";
import type { QuotePair } from "@/lib/launchlab/pairs";
import { TokenIcon } from "@/components/token-icon";

/**
 * Which token the coin trades against. Every StonkFun category is offered — xStocks, PreStocks, Sunrise,
 * currencies, leverage, collectibles, SOL and custom tokens — because creator fees arrive in the quote, so a
 * coin quoted in TSLAX pays its holders' vault in TSLAX with nothing to swap. Same shelf as the basket step:
 * choosing what a coin is priced in and what its holders are paid in are the same kind of decision.
 */
export function QuotePicker({ pairs, value, onChange, loading = false }: { pairs: QuotePair[]; value: QuotePair | null; onChange: (p: QuotePair) => void; loading?: boolean }) {
  const tabs = useMemo(() => {
    const seen = new Map<string, { label: string; count: number }>();
    for (const p of pairs) {
      const t = seen.get(p.category) ?? { label: p.categoryLabel, count: 0 };
      t.count += 1;
      seen.set(p.category, t);
    }
    return [...seen].map(([category, t]) => ({ category, ...t }));
  }, [pairs]);
  const [tab, setTab] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const active = tab ?? value?.category ?? tabs[0]?.category ?? null;
  const q = search.trim().toLowerCase();
  const shown = pairs.filter((p) => p.category === active).filter((p) => !q || p.symbol.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
  const searchable = (tabs.find((t) => t.category === active)?.count ?? 0) > 12;

  if (pairs.length === 0) return <p className="mc-detail-hint">{loading ? "Loading quote tokens…" : "No quote tokens are available."}</p>;
  return (
    <div className="lw-quote">
      <div className="mc-shelf-row lw-quote-tabs" role="tablist" aria-label="Quote token categories">
        {tabs.map((t) => (
          <button
            key={t.category}
            type="button"
            role="tab"
            aria-selected={t.category === active}
            className={`mc-chip lw-pill ${t.category === active ? "is-in" : ""}`}
            onClick={() => {
              setTab(t.category);
              setSearch("");
            }}
          >
            <b>{t.label}</b>
            <small className="num">{t.count}</small>
          </button>
        ))}
        {searchable && (
          <label className="lw-search">
            <MagnifyingGlass size={13} aria-hidden="true" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${shown.length || ""}`} aria-label="Search quote tokens" />
          </label>
        )}
      </div>
      <div className="mc-shelf-row lw-shelf-scroll" role="listbox" aria-label="Quote token">
        {shown.map((p) => {
          const selected = value?.mint === p.mint;
          return (
            <button key={p.mint} type="button" role="option" aria-selected={selected} className={`mc-chip ${selected ? "is-in" : ""}`} onClick={() => onChange(p)}>
              <TokenIcon symbol={p.symbol} address={p.mint} logoUrl={p.logoUrl} size={18} />
              <span>
                <b>{p.symbol}</b>
                <small>{p.name}</small>
              </span>
            </button>
          );
        })}
        {shown.length === 0 && <p className="mc-detail-hint">{q ? `No quote token matches "${search}".` : "Nothing launchable in this category right now."}</p>}
      </div>
    </div>
  );
}
