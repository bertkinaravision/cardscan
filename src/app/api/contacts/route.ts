import { blankContactInput, contactInputSchema, invalidFieldMessage, type ContactInput, type ContactRow } from "@/lib/fields";
import { deleteImages, uploadImage } from "@/lib/server/google";
import { readImage } from "@/lib/server/images";
import { mergeContact, type Uploaded } from "@/lib/server/merge";
import { errorResponse, HttpError, parseJson, readForm, requireUser } from "@/lib/server/session";
import { appendContact, listContacts, listContactsWithLayout, updateContact } from "@/lib/server/sheet";

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
    const form = await readForm(req);
    const id = String(form.get("id") ?? "");
    if (!/^[a-zA-Z0-9-]{8,64}$/.test(id)) throw new HttpError(400, "Invalid id.");
    const parsed = contactInputSchema.safeParse({ ...blankContactInput(), ...(parseJson(String(form.get("contact") ?? "{}")) as object) });
    if (!parsed.success) throw new HttpError(400, invalidFieldMessage(parsed.error));
    const { first_name, last_name, company, email, mobile } = parsed.data;
    if (![first_name, last_name, company, email, mobile].some(Boolean))
      throw new HttpError(400, "Add at least a name, company, email or mobile number before saving.");

    // A retry after a lost response must not save or merge the same card twice.
    const { contacts: all, layout } = await listContactsWithLayout();
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
        // Another card may be merged into the same contact at the same moment; the later write
        // would then drop this card's notes and photos. Check afterwards and merge again on top.
        let current: ContactRow | undefined = existing;
        for (let attempt = 0; attempt < 3 && current; attempt++) {
          if (current.source_card_ids.split(",").includes(id)) return Response.json({ id: existing.id, merged: true });
          const updated = await updateContact(current.id, {
            ...mergeContact(current, c, uploaded, now),
            source_card_ids: [current.source_card_ids, id].filter(Boolean).join(","),
          });
          if (!updated) break;
          current = (await listContacts()).find((r) => r.id === existing.id);
        }
        if (current?.source_card_ids.split(",").includes(id)) return Response.json({ id: existing.id, merged: true });
        if (!current) throw new HttpError(404, "The contact to update was deleted meanwhile. Save this card as a new contact.");
        throw new Error("The contact is being changed by someone else right now. Tap Approve again.");
      }
      const { duplicate } = await appendContact(newRow(id, c, user.email, now, uploaded), layout);
      if (duplicate) {
        // Saved by an earlier request for the same card: this copy's photos aren't used.
        const ids = [uploaded.front?.id, uploaded.back?.id].filter((x): x is string => !!x);
        await deleteImages(user.googleAccessToken, ids).catch(() => {});
        return Response.json({ id, alreadySaved: true });
      }
      return Response.json({ id });
    } catch (err) {
      // The write may have gone through even though its reply was lost: then keep the photos and report success.
      const saved = (await listContacts().catch(() => [])).find(
        (r) => r.id === id || r.source_card_ids.split(",").includes(id),
      );
      if (saved) return Response.json({ id: saved.id });
      // Otherwise don't leave photos in Drive that no row points to (they could never be deleted from the app).
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
