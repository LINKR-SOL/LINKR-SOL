import { PublicKey } from "@solana/web3.js";

export type Cluster = "mainnet-beta" | "devnet" | "localnet";

/** Normalises an env value: quotes and whitespace stripped, blank treated as unset (an empty line in .env is not a setting). */
export function envText(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim().replace(/^["']|["']$/g, "");
  return trimmed ? trimmed : undefined;
}

/**
 * Reads a **server-side** env var. Never use this for a `NEXT_PUBLIC_*` name: the dynamic index defeats
 * Next's build-time inlining, so the browser reads `undefined` and silently falls back to the default.
 * Client-visible settings must be written as a literal `process.env.NEXT_PUBLIC_…` member access.
 */
export function envValue(name: string): string | undefined {
  return envText(process.env[name]);
}

const CLUSTERS: Cluster[] = ["mainnet-beta", "devnet", "localnet"];

/** The cluster this deployment targets. Set NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta for production; defaults to devnet. */
export const activeCluster: Cluster = (() => {
  const raw = envText(process.env.NEXT_PUBLIC_SOLANA_CLUSTER) ?? "devnet";
  if (!CLUSTERS.includes(raw as Cluster)) throw new Error(`Unsupported NEXT_PUBLIC_SOLANA_CLUSTER ${raw}`);
  return raw as Cluster;
})();

export const isMainnet = activeCluster === "mainnet-beta";

const DEFAULT_RPC: Record<Cluster, string> = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  localnet: "http://127.0.0.1:8899",
};

/** Browser RPC. The public endpoints are rate-limited; set a Helius/QuickNode URL in production. */
export const publicRpcUrl: string = envText(process.env.NEXT_PUBLIC_RPC_URL) ?? DEFAULT_RPC[activeCluster];

export const clusterLabel: Record<Cluster, string> = {
  "mainnet-beta": "Solana",
  devnet: "Solana devnet",
  localnet: "Localnet",
};

const clusterQuery =
  activeCluster === "mainnet-beta"
    ? ""
    : activeCluster === "devnet"
      ? "?cluster=devnet"
      : "?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899";

export const explorerUrl = "https://solscan.io";
export const explorerTxUrl = (signature: string) => `${explorerUrl}/tx/${signature}${clusterQuery}`;
export const explorerAddressUrl = (address: string) => `${explorerUrl}/account/${address}${clusterQuery}`;
export const explorerTokenUrl = (mint: string) => `${explorerUrl}/token/${mint}${clusterQuery}`;

/** The causa_vault program. Override per environment; the default is the devnet deploy keypair. */
export const PROGRAM_ID = new PublicKey(
  envText(process.env.NEXT_PUBLIC_PROGRAM_ID) ?? "99n7VGd6132b4UUwhSezLm9xXssdnJFiSPrEKkCuMHPF",
);

export const SYSTEM_ADDRESS = "11111111111111111111111111111111";

/**
 * How vaults are run. `program`: the on-chain causa_vault program owns every vault (trustless; costs the program's
 * rent deposit once per cluster). `custodial`: each vault is a keypair derived from the keeper's secret; the keeper
 * does the same accounting off-chain, publishes every payout's root on-chain as a memo, and delivers stocks itself.
 * Client-visible because the launch wizard builds different transactions in each mode.
 */
export type VaultMode = "program" | "custodial";
export const VAULT_MODE: VaultMode = (envText(process.env.NEXT_PUBLIC_VAULT_MODE) ?? "program") === "custodial" ? "custodial" : "program";
export const isCustodial = VAULT_MODE === "custodial";
/** The `programId` vault documents are filed under: the program's id, or the literal "custodial". */
export const VAULT_PROGRAM_KEY = isCustodial ? "custodial" : PROGRAM_ID.toBase58();
