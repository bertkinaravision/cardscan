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
  return Buffer.from(await file.arrayBuffer());
}
