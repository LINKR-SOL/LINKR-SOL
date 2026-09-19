import { LaunchInputError } from "@/lib/launch/errors";
import { logoUploadsConfigured, storeLogo } from "@/lib/launch/logo";
import { error } from "@/lib/serialize";

export const runtime = "nodejs";

/** Stores a token logo and returns its public URL (see lib/launch/logo.ts). */
export async function POST(req: Request) {
  if (!logoUploadsConfigured()) {
    return error(
      "logo uploads are not configured: set BLOB_READ_WRITE_TOKEN (Vercel dashboard -> Storage -> Blob store -> .env.local, " +
        "or run `vercel env pull`). Pasting a logo URL works without it.",
      501,
    );
  }
  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return error("expected multipart/form-data with a 'file' field", 400);
  }
  if (!file) return error("no file provided", 400);
  try {
    return Response.json({ url: await storeLogo(file, { type: file.type, name: file.name }) });
  } catch (e) {
    if (e instanceof LaunchInputError) return error(e.message, e.status);
    console.error("[upload]", e);
    return error(`upload failed: ${(e as Error).message}`, 502);
  }
}
