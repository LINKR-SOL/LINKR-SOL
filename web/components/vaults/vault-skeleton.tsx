import { Skeleton } from "@/components/ui/primitives";

/**
 * The coin page while it loads, in the page's own shape: title and details, the four stats, the payout timeline and
 * the basket, so nothing jumps when the data lands. Also the route's loading state when a coin is opened.
 */
export function VaultSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading the coin">
      <div className="flex flex-wrap items-start gap-4">
        <Skeleton className="h-14 w-14 shrink-0 rounded-2xl" />
        <div className="min-w-0 flex-1 space-y-3">
          <Skeleton className="h-9 w-[min(380px,70%)] rounded-xl" />
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
        <Skeleton className="h-10 w-28 rounded-full" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-border bg-surface-2/60 px-4 py-3 space-y-2.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>

      <section className="rounded-[var(--radius-card)] border border-border bg-surface px-5 py-5 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-28 rounded-full" />
          </div>
          <Skeleton className="h-3 w-44" />
        </div>
        <Skeleton className="h-1.5 w-full rounded-full" />
        <div className="grid grid-cols-4 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[var(--radius-card)] border border-border bg-surface px-5 py-5 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-3 w-40" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-7 w-7 rounded-full" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="ml-auto h-4 w-16" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </section>
    </div>
  );
}
