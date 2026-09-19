import type { Metadata } from "next";
import { ClaimsPanel } from "@/components/vaults/claims-panel";

export const metadata: Metadata = { title: "Portfolio" };

export default function ClaimsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your ideas.<br/>Your rewards.</h1>
        <p className="text-sm text-muted mt-1">Track accumulating rewards, upcoming distributions and the stocks already delivered to your wallet.</p>
      </div>
      <ClaimsPanel />
    </div>
  );
}
