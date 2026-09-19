import { LaunchInputError } from "@/lib/launch/errors";
import { pinLaunchMetadata, type MetadataInput } from "@/lib/launch/metadata";
import { error, json } from "@/lib/serialize";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Pins the coin's metadata JSON (name, symbol, description, image, socials) and returns its URI, which the
 * LaunchLab create stores on the Token-2022 mint. See lib/launch/metadata.ts.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as MetadataInput;
  try {
    return json({ uri: await pinLaunchMetadata(body) });
  } catch (e) {
    if (e instanceof LaunchInputError) return error(e.message, e.status);
    console.error("[launch/metadata]", e);
    return error(`could not pin metadata: ${(e as Error).message}`, 502);
  }
}
