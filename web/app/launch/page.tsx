import type { Metadata } from "next";
import { Suspense } from "react";
import { LaunchWizard } from "@/components/launch/launch-wizard";
import { Skeleton } from "@/components/ui/primitives";
import { activeCluster, clusterLabel } from "@/lib/solana/cluster";
import "./studio.css";

export const metadata: Metadata = { title: "Create a market" };

export default function LaunchPage() {
  return (
    <div className="lw-page studio-page">
      <header className="studio-page-head">
        <div><span className="studio-kicker">LINKR / LAUNCH STUDIO</span><h1>Your idea.<br /><em>The next market.</em></h1></div>
        <div className="studio-intro"><span className="studio-network"><i />{clusterLabel[activeCluster]}</span><p>Create a coin with conviction.<br />Connect its holders to stock rewards.</p></div>
      </header>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <LaunchWizard />
      </Suspense>
    </div>
  );
}
