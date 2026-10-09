import { contactInputSchema, type ContactRow } from "@/lib/fields";
import { uploadImage } from "@/lib/server/google";
import { readImage } from "@/lib/server/images";
import { mergeContact } from "@/lib/server/merge";
import { errorResponse, HttpError, requireUser } from "@/lib/server/session";
import { appendContact, getContact, listContacts, updateContact } from "@/lib/server/sheet";

export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    await requireUser(req);
    return Response.json({ contacts: await listContacts() });
  } catch (err) {
    return errorResponse(err);
  }
}

// Saves an approved card: uploads the photos to Drive, then adds one row to the Sheet.
// Safe to retry: the phone sends the same id, and a second save is ignored.
// With "mergeInto", the card updates an existing contact instead (duplicate found on review).
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const form = await req.formData();
    const id = String(form.get("id") ?? "");
    if (!/^[a-zA-Z0-9-]{8,64}$/.test(id)) throw new HttpError(400, "Invalid id.");
    const parsed = contactInputSchema.safeParse(JSON.parse(String(form.get("contact") ?? "{}")));
    if (!parsed.success) throw new HttpError(400, "Some fields are invalid.");

    const mergeInto = String(form.get("mergeInto") ?? "");
    const existing = mergeInto ? await getContact(mergeInto) : null;
    if (mergeInto && !existing) throw new HttpError(404, "The contact to update no longer exists.");
    if (!existing && (await getContact(id))) return Response.json({ id, alreadySaved: true });

    const front = await readImage(form, "front");
    const back = await readImage(form, "back");
    const now = new Date().toISOString();
    const c = parsed.data;
    const baseName = [c.first_name, c.last_name, c.company].filter(Boolean).join(" ").slice(0, 80) || "card";
    const safeName = baseName.replace(/[\\/:*?"<>|]/g, "_");

    const uploaded = {
      front: front ? await uploadImage(user.googleAccessToken, `${safeName} - front - ${id}.jpg`, front) : null,
      back: back ? await uploadImage(user.googleAccessToken, `${safeName} - back - ${id}.jpg`, back) : null,
    };

    if (existing) {
      const merged = mergeContact(existing, c, uploaded, now);
      await updateContact(existing.id, merged);
      return Response.json({ id: existing.id, merged: true });
    }

    const row: ContactRow = {
      id,
      ...c,
      scanned_by: user.email,
      scanned_at: now,
      last_updated: now,
      image_front_link: uploaded.front?.link ?? "",
      image_back_link: uploaded.back?.link ?? "",
      image_file_ids: [uploaded.front?.id, uploaded.back?.id].filter(Boolean).join(","),
    };
    await appendContact(row);
    return Response.json({ id });
  } catch (err) {
    return errorResponse(err);
  }
}
