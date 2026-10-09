import { contactInputSchema, type ContactInput, type ContactRow } from "@/lib/fields";
import { deleteImages, uploadImage } from "@/lib/server/google";
import { readImage } from "@/lib/server/images";
import { mergeContact, type Uploaded } from "@/lib/server/merge";
import { errorResponse, HttpError, requireUser } from "@/lib/server/session";
import { appendContact, listContacts, updateContact } from "@/lib/server/sheet";

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

    // A retry after a lost response must not save or merge the same card twice.
    const all = await listContacts();
    const already = all.find((r) => r.id === id || r.source_card_ids.split(",").includes(id));
    if (already) return Response.json({ id: already.id, alreadySaved: true });

    const mergeInto = String(form.get("mergeInto") ?? "");
    const existing = mergeInto ? (all.find((r) => r.id === mergeInto) ?? null) : null;
    if (mergeInto && !existing) throw new HttpError(404, "The contact to update no longer exists.");

    const front = await readImage(form, "front");
    const back = await readImage(form, "back");
    const now = new Date().toISOString();
    const c = parsed.data;
    const baseName = [c.first_name, c.last_name, c.company].filter(Boolean).join(" ").slice(0, 80) || "card";
    const safeName = baseName.replace(/[\\/:*?"<>|]/g, "_");

    const uploaded: Uploaded = { front: null, back: null };
    try {
      if (front) uploaded.front = await uploadImage(user.googleAccessToken, `${safeName} - front - ${id}.jpg`, front);
      if (back) uploaded.back = await uploadImage(user.googleAccessToken, `${safeName} - back - ${id}.jpg`, back);
      if (existing) {
        await updateContact(existing.id, {
          ...mergeContact(existing, c, uploaded, now),
          source_card_ids: [existing.source_card_ids, id].filter(Boolean).join(","),
        });
        return Response.json({ id: existing.id, merged: true });
      }
      await appendContact(newRow(id, c, user.email, now, uploaded));
      return Response.json({ id });
    } catch (err) {
      // Don't leave photos in Drive that no row points to (they could never be deleted from the app).
      const uploadedIds = [uploaded.front?.id, uploaded.back?.id].filter((x): x is string => !!x);
      await deleteImages(user.googleAccessToken, uploadedIds).catch(() => {});
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}

function newRow(id: string, c: ContactInput, email: string, now: string, uploaded: Uploaded): ContactRow {
  return {
    id,
    ...c,
    scanned_by: email,
    scanned_at: now,
    last_updated: now,
    image_front_link: uploaded.front?.link ?? "",
    image_back_link: uploaded.back?.link ?? "",
    image_file_ids: [uploaded.front?.id, uploaded.back?.id].filter(Boolean).join(","),
    source_card_ids: "",
  };
}
