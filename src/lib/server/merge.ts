import { EXTRACTED_FIELDS, type ContactInput, type ContactRow } from "@/lib/fields";

export type Uploaded = { front: { id: string; link: string } | null; back: { id: string; link: string } | null };

// Newer card details win where the new card has a value; follow-up fields stay as they were;
// events and notes are added to, not replaced. Old photos are kept (and deleted with the contact).
export function mergeContact(old: ContactRow, card: ContactInput, uploaded: Uploaded, now: string): Partial<ContactRow> {
  const merged: Partial<ContactRow> = {};
  for (const f of EXTRACTED_FIELDS) merged[f] = card[f] || old[f];

  const addUnique = (a: string, b: string, sep: string) => (!b || a.includes(b) ? a : a ? `${a}${sep}${b}` : b);
  const events = old.event.split("; ").filter(Boolean);
  merged.event = card.event && !events.includes(card.event) ? [...events, card.event].join("; ") : old.event;
  merged.date_met = old.date_met || card.date_met;
  const newNote = [card.notes, card.event && card.date_met ? `(met again at ${card.event}, ${card.date_met})` : ""]
    .filter(Boolean)
    .join(" ");
  merged.notes = addUnique(old.notes, newNote, "\n");
  merged.owner = old.owner || card.owner;
  merged.contact_type = old.contact_type || card.contact_type;
  merged.next_action = old.next_action || card.next_action;
  merged.next_action_date = old.next_action_date || card.next_action_date;

  if (uploaded.front) merged.image_front_link = uploaded.front.link;
  if (uploaded.back) merged.image_back_link = uploaded.back.link;
  merged.image_file_ids = [old.image_file_ids, uploaded.front?.id, uploaded.back?.id].filter(Boolean).join(",");
  merged.last_updated = now;
  return merged;
}
