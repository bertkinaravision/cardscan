import { contactInputSchema, EXTRACTED_FIELDS, type ContactInput, type ContactRow } from "@/lib/fields";
import { uploadImage } from "@/lib/server/google";
import { readImage } from "@/lib/server/images";
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

type Uploaded = { front: { id: string; link: string } | null; back: { id: string; link: string } | null };

// Newer card details win where the new card has a value; follow-up fields stay as they were;
// events and notes are added to, not replaced. Old photos are kept (and deleted with the contact).
function mergeContact(old: ContactRow, card: ContactInput, uploaded: Uploaded, now: string): Partial<ContactRow> {
  const merged: Partial<ContactRow> = {};
  for (const f of EXTRACTED_FIELDS) merged[f] = card[f] || old[f];

  const addUnique = (a: string, b: string, sep: string) => (!b || a.includes(b) ? a : a ? `${a}${sep}${b}` : b);
  merged.event = addUnique(old.event, card.event, "; ");
  merged.date_met = old.date_met || card.date_met;
  const newNote = [card.notes, card.event && card.date_met ? `(met again at ${card.event}, ${card.date_met})` : ""]
    .filter(Boolean)
    .join(" ");
  merged.notes = addUnique(old.notes, newNote, "\n");
  merged.owner = old.owner || card.owner;
  merged.next_action = old.next_action || card.next_action;
  merged.next_action_date = old.next_action_date || card.next_action_date;

  if (uploaded.front) merged.image_front_link = uploaded.front.link;
  if (uploaded.back) merged.image_back_link = uploaded.back.link;
  merged.image_file_ids = [old.image_file_ids, uploaded.front?.id, uploaded.back?.id].filter(Boolean).join(",");
  merged.last_updated = now;
  return merged;
}
