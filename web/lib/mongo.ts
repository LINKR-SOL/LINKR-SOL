import { MongoClient, type Db } from "mongodb";

/**
 * Module-level cached client. Vercel's Fluid Compute keeps the instance alive between requests, so the pool
 * is reused; `maxPoolSize` stays small because many instances may run concurrently. The cache is keyed by the
 * URI so that changing MONGODB_URI in development (Next reloads .env files) switches databases without a restart.
 */
interface CachedClient {
  uri: string;
  client: Promise<MongoClient>;
}

declare global {
  var __causaMongo: CachedClient | undefined;
}

function validCache(c: unknown): c is CachedClient {
  return !!c && typeof (c as CachedClient).uri === "string" && typeof (c as CachedClient).client?.then === "function";
}

function connect(uri: string): Promise<MongoClient> {
  const client = new MongoClient(uri, {
    maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE ?? 5),
    minPoolSize: 0,
    maxIdleTimeMS: 30_000,
    serverSelectionTimeoutMS: 10_000,
  });
  return client.connect();
}

export function getMongoClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MONGODB_URI is not set");
  const cached = validCache(globalThis.__causaMongo) ? globalThis.__causaMongo : undefined;
  if (cached && cached.uri === uri) return cached.client;
  if (cached) void cached.client.then((c) => c.close()).catch(() => {});
  const client = connect(uri).catch((e) => {
    if (globalThis.__causaMongo?.uri === uri) globalThis.__causaMongo = undefined;
    throw e;
  });
  globalThis.__causaMongo = { uri, client };
  return client;
}

/** Database name: MONGODB_DB, else the path segment of the URI, else "linkr". */
export function getDbName(): string {
  if (process.env.MONGODB_DB) return process.env.MONGODB_DB;
  try {
    const path = new URL(process.env.MONGODB_URI?.trim() ?? "").pathname.replace(/^\//, "");
    if (path) return path;
  } catch {
    // ignore unparsable URIs
  }
  return "linkr";
}

export async function getDb(): Promise<Db> {
  const client = await getMongoClient();
  return client.db(getDbName());
}
