// The scan queue lives on the phone (IndexedDB), so it survives refreshes and bad signal.
import { createStore, del, get, promisifyRequest, set, values } from "idb-keyval";
import type { ContactInput, Extraction } from "@/lib/fields";

export type CardStatus = "queued" | "processing" | "review" | "saving" | "saved" | "failed";

export const STATUS_LABELS: Record<CardStatus, string> = {
  queued: "Queued",
  processing: "Processing",
  review: "Ready to review",
  saving: "Saving",
  saved: "Saved",
  failed: "Failed",
};

// Everything about a card except its photos.
export type CardInfo = {
  id: string;
  createdAt: number;
  hasBack: boolean;
  status: CardStatus;
  error?: string;
  // Set when the model has read the card.
  extraction?: Extraction;
  // The person's edits on the review screen (kept if they leave and come back).
  draft?: ContactInput;
  // Event and date captured with the card.
  event: string;
  dateMet: string;
};

export type QueuedCard = CardInfo & { front: Blob; back: Blob | null };

const browser = typeof indexedDB !== "undefined";
// Card details and photos are kept apart: photos are written once, and status or draft
// updates are small single-transaction writes, so two screens can't overwrite each other.
const cards = browser ? createStore("cardscan-v2", "cards") : undefined;
// The first version kept everything in one store. Nothing was saved there in real use; clear it out.
if (browser) indexedDB.deleteDatabase("cardscan");
const photos = browser ? createStore("cardscan-v2-photos", "photos") : undefined;
const CHANGED = "cardscan:queue-changed";

// Photos are stored as raw bytes rather than Blobs: some Safari versions lose Blobs kept in IndexedDB.
type StoredPhoto = { bytes: ArrayBuffer; type: string };
const photoCache = new Map<string, Blob>();

async function loadPhoto(key: string): Promise<Blob | null> {
  const hit = photoCache.get(key);
  if (hit) return hit;
  const stored = await get<StoredPhoto>(key, photos);
  if (!stored) return null;
  const blob = new Blob([stored.bytes], { type: stored.type });
  photoCache.set(key, blob);
  return blob;
}

// A card whose photo went missing still comes back (with an empty photo), so it can be seen and removed.
async function withPhotos(info: CardInfo): Promise<QueuedCard> {
  const front = (await loadPhoto(`${info.id}:front`)) ?? new Blob([], { type: "image/jpeg" });
  const back = info.hasBack ? await loadPhoto(`${info.id}:back`) : null;
  return { ...info, front, back };
}

const changed = () => window.dispatchEvent(new Event(CHANGED));

export async function listCardInfo(): Promise<CardInfo[]> {
  return (await values<CardInfo>(cards)).sort((a, b) => a.createdAt - b.createdAt);
}

export async function listCards(): Promise<QueuedCard[]> {
  return Promise.all((await listCardInfo()).map(withPhotos));
}

export async function getCard(id: string): Promise<QueuedCard | undefined> {
  const info = await get<CardInfo>(id, cards);
  return info ? withPhotos(info) : undefined;
}

export async function addCard(info: Omit<CardInfo, "hasBack">, front: Blob, back: Blob | null): Promise<void> {
  const save = async (key: string, blob: Blob) => {
    await set(key, { bytes: await blob.arrayBuffer(), type: blob.type || "image/jpeg" } satisfies StoredPhoto, photos);
    photoCache.set(key, blob);
  };
  await save(`${info.id}:front`, front);
  if (back) await save(`${info.id}:back`, back);
  await set(info.id, { ...info, hasBack: !!back } satisfies CardInfo, cards);
  changed();
}

// Read-modify-write in one IndexedDB transaction. `patch` may be a function of the current card,
// so a change can depend on the latest state (for example "only if still saving").
export async function updateCard(
  id: string,
  patch: Partial<CardInfo> | ((current: CardInfo) => Partial<CardInfo> | null),
): Promise<void> {
  if (!cards) return;
  let wrote = false;
  await cards("readwrite", async (store) => {
    const current = (await promisifyRequest(store.get(id))) as CardInfo | undefined;
    if (!current) return; // removed meanwhile
    const p = typeof patch === "function" ? patch(current) : patch;
    if (!p) return;
    store.put({ ...current, ...p }, id);
    wrote = true;
    await promisifyRequest(store.transaction);
  });
  if (wrote) changed();
}

export async function removeCard(id: string): Promise<void> {
  await del(id, cards);
  await del(`${id}:front`, photos);
  await del(`${id}:back`, photos);
  photoCache.delete(`${id}:front`);
  photoCache.delete(`${id}:back`);
  changed();
}

export function onQueueChange(fn: () => void): () => void {
  window.addEventListener(CHANGED, fn);
  return () => window.removeEventListener(CHANGED, fn);
}
