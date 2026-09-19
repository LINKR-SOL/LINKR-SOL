import { put } from "@vercel/blob";
import { envText, envValue } from "../solana/cluster";
import { LaunchInputError } from "./errors";
import { BRAND } from "../brand";

/** The public origin, stamped into every coin's metadata as where it was created. */
const siteOrigin = () => (envText(process.env.NEXT_PUBLIC_SITE_URL) ?? BRAND.site).replace(/\/+$/, "");

export interface MetadataInput {
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * Pins the coin's metadata JSON (name, symbol, description, image, socials) and returns its URI, which the
 * LaunchLab create stores on the Token-2022 mint. Pinata (IPFS) when configured; otherwise the JSON goes to
 * Vercel Blob next to the logo. The image is an already-hosted https URL (see storeLogo); with Pinata it is
 * re-hosted on IPFS next to the metadata so the coin does not depend on our storage.
 */
export async function pinLaunchMetadata(body: MetadataInput): Promise<string> {
  const name = (body.name ?? "").trim().slice(0, 32);
  const symbol = (body.symbol ?? "").trim().replace(/^\$/, "").slice(0, 10);
  const description = (body.description ?? "").trim().slice(0, 1000);
  const image = (body.image ?? "").trim();
  if (!name || !symbol) throw new LaunchInputError("name and symbol required");
  if (!/^https:\/\//.test(image)) throw new LaunchInputError("image must be an https URL (upload it first)");
  const imageRes = await fetch(image, { signal: AbortSignal.timeout(15_000) });
  if (!imageRes.ok) throw new LaunchInputError("could not fetch the image", 400);
  const blob = await imageRes.blob();
  if (blob.size > MAX_IMAGE_BYTES) throw new LaunchInputError("image larger than 2 MB", 400);
  const socials = { twitter: body.twitter?.trim() || undefined, telegram: body.telegram?.trim() || undefined, website: body.website?.trim() || undefined };

  const pinata = envValue("PINATA_JWT");
  return pinata ? pinWithPinata(pinata, { name, symbol, description, blob, socials, image }) : pinWithBlob({ name, symbol, description, blob, socials, image });
}

interface Pin {
  name: string;
  symbol: string;
  description: string;
  blob: Blob;
  /** the already-hosted logo URL */
  image: string;
  socials: { twitter?: string; telegram?: string; website?: string };
}

const metadataJson = (p: Pin, image: string) => ({
  name: p.name,
  symbol: p.symbol,
  description: p.description,
  image,
  showName: true,
  createdOn: siteOrigin(),
  ...(p.socials.twitter ? { twitter: p.socials.twitter } : {}),
  ...(p.socials.telegram ? { telegram: p.socials.telegram } : {}),
  ...(p.socials.website ? { website: p.socials.website } : {}),
});

/** Vercel Blob: the same store the logo lives in. Public, immutable URL. */
async function pinWithBlob(p: Pin): Promise<string> {
  const token = envValue("BLOB_READ_WRITE_TOKEN");
  if (!token) throw new Error("set PINATA_JWT or BLOB_READ_WRITE_TOKEN to host coin metadata");
  // same call shape as /api/upload (which works on Vercel); a fixed filename without the random suffix is refused there.
  // The token is passed explicitly: with BLOB_STORE_ID also set, the SDK otherwise tries Vercel's OIDC flow, which
  // fails outside a Vercel deployment with "Access denied".
  const out = await put(`token-metadata/${crypto.randomUUID()}.json`, JSON.stringify(metadataJson(p, p.image)), { access: "public", contentType: "application/json", token });
  return out.url;
}

async function pinWithPinata(jwt: string, p: Pin): Promise<string> {
  const headers = { authorization: `Bearer ${jwt}` };
  const imgForm = new FormData();
  imgForm.append("file", p.blob, "logo.png");
  const img = await fetch("https://uploads.pinata.cloud/v3/files", { method: "POST", headers, body: imgForm, signal: AbortSignal.timeout(25_000) });
  if (!img.ok) throw new Error(`pinata image ${img.status}`);
  const imgCid = ((await img.json()) as { data?: { cid?: string } }).data?.cid;
  if (!imgCid) throw new Error("pinata returned no image cid");
  const metaForm = new FormData();
  metaForm.append("file", new Blob([JSON.stringify(metadataJson(p, `https://ipfs.io/ipfs/${imgCid}`))], { type: "application/json" }), "metadata.json");
  const meta = await fetch("https://uploads.pinata.cloud/v3/files", { method: "POST", headers, body: metaForm, signal: AbortSignal.timeout(25_000) });
  if (!meta.ok) throw new Error(`pinata metadata ${meta.status}`);
  const cid = ((await meta.json()) as { data?: { cid?: string } }).data?.cid;
  if (!cid) throw new Error("pinata returned no metadata cid");
  return `https://ipfs.io/ipfs/${cid}`;
}
