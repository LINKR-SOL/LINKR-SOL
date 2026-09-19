import type { Metadata } from "next";
import { VaultPanel } from "@/components/vaults/vault-panel";

export const metadata: Metadata = { title: "Dividend vault" };

export default async function VaultPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <VaultPanel address={address as `0x${string}`} />;
}
