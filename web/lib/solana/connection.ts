import { Connection } from "@solana/web3.js";
import { envValue, publicRpcUrl } from "./cluster";

let conn: Connection | undefined;

/** Server-side RPC connection. Prefers the paid indexer endpoint; falls back to the public one. */
export function serverConnection(): Connection {
  if (!conn) {
    conn = new Connection(envValue("INDEXER_RPC_URL") ?? publicRpcUrl, {
      commitment: "confirmed",
      // The public endpoints answer bursts with 429; web3.js backs off on its own when this is false.
      disableRetryOnRateLimit: false,
    });
  }
  return conn;
}
