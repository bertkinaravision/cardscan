import "server-only";
import { HttpError } from "./session";

const MAX_BYTES = 3 * 1024 * 1024;

// Reads an optional JPEG upload from a form. The phone compresses photos before sending.
export async function readImage(form: FormData, name: string): Promise<Buffer | null> {
  const file = form.get(name);
  if (file == null || file === "") return null;
  if (!(file instanceof Blob)) throw new HttpError(400, `${name} is not a file.`);
  if (file.type !== "image/jpeg") throw new HttpError(400, `${name} must be a JPEG.`);
  if (file.size > MAX_BYTES) throw new HttpError(413, `${name} is too large.`);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) throw new HttpError(400, `The ${name} photo is empty. Remove this card and scan it again.`);
  // Every JPEG starts with FF D8 FF; the declared type alone is whatever the sender says.
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new HttpError(400, `${name} must be a JPEG.`);
  return bytes;
}
