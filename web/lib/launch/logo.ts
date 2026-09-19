import { put } from "@vercel/blob";
import { LaunchInputError } from "./errors";

export const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB — the logo only ever renders small
export const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" };

export const logoUploadsConfigured = () => !!process.env.BLOB_READ_WRITE_TOKEN;

/**
 * Stores a token logo and returns its public URL. The URL is what the coin's StonkFun metadata points at, so it
 * has to be a real hosted link — a data URI would blow up the launch's calldata cost.
 */
export async function storeLogo(file: Blob, opts: { type: string; name?: string }): Promise<string> {
  if (!logoUploadsConfigured()) {
    throw new LaunchInputError(
      "logo uploads are not configured: set BLOB_READ_WRITE_TOKEN (Vercel dashboard -> Storage -> Blob store -> .env.local, " +
        "or run `vercel env pull`). Pasting a logo URL works without it.",
      501,
    );
  }
  if (!LOGO_TYPES.has(opts.type)) throw new LaunchInputError(`unsupported type ${opts.type || "unknown"}; use PNG, JPEG, WebP, GIF or SVG`, 415);
  if (file.size > LOGO_MAX_BYTES) throw new LaunchInputError(`file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 2 MB`, 413);
  const ext = ((opts.name?.includes(".") ? opts.name.split(".").pop() : EXT[opts.type]) ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const blob = await put(`token-logos/${crypto.randomUUID()}.${ext}`, file, {
    access: "public",
    contentType: opts.type,
    addRandomSuffix: false,
    // Pass the token explicitly: when BLOB_STORE_ID is also present the SDK otherwise tries Vercel's OIDC flow,
    // which is not available in the development environment and fails with a confusing error.
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return blob.url;
}
