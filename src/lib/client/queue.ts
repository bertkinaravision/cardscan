// The scan queue lives on the phone (IndexedDB), so it survives refreshes and bad signal.
import { createStore, del, get, set, values } from "idb-keyval";
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

export type QueuedCard = {
  id: string;
  createdAt: number;
  front: Blob;
  back: Blob | null;
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

const store = typeof indexedDB !== "undefined" ? createStore("cardscan", "cards") : undefined;
const CHANGED = "cardscan:queue-changed";

// Photos are stored as raw bytes rather than Blobs: some Safari versions lose Blobs kept in IndexedDB.
type StoredPhoto = { bytes: ArrayBuffer; type: string };
type StoredCard = Omit<QueuedCard, "front" | "back"> & { front: StoredPhoto | Blob; back: StoredPhoto | Blob | null };

const toStored = async (b: Blob): Promise<StoredPhoto> => ({ bytes: await b.arrayBuffer(), type: b.type || "image/jpeg" });
const fromStored = (p: StoredPhoto | Blob): Blob => (p instanceof Blob ? p : new Blob([p.bytes], { type: p.type }));
const fromStoredCard = (c: StoredCard): QueuedCard => ({ ...c, front: fromStored(c.front), back: c.back ? fromStored(c.back) : null });

// Blobs are rebuilt on every read, so keep one per card: images don't flicker on each queue update.
const blobCache = new Map<string, { front: Blob; back: Blob | null }>();
function withCachedBlobs(card: QueuedCard): QueuedCard {
  const hit = blobCache.get(card.id);
  if (hit && hit.front.size === card.front.size && (hit.back?.size ?? 0) === (card.back?.size ?? 0)) {
    return { ...card, front: hit.front, back: hit.back };
  }
  blobCache.set(card.id, { front: card.front, back: card.back });
  return card;
}

export async function listCards(): Promise<QueuedCard[]> {
  const all = await values<StoredCard>(store);
  return all.map((c) => withCachedBlobs(fromStoredCard(c))).sort((a, b) => a.createdAt - b.createdAt);
}

export async function getCard(id: string): Promise<QueuedCard | undefined> {
  const c = await get<StoredCard>(id, store);
  return c ? withCachedBlobs(fromStoredCard(c)) : undefined;
}

export async function putCard(card: QueuedCard): Promise<void> {
  const stored: StoredCard = {
    ...card,
    front: await toStored(card.front),
    back: card.back ? await toStored(card.back) : null,
  };
  await set(card.id, stored, store);
  window.dispatchEvent(new Event(CHANGED));
}

export async function updateCard(id: string, patch: Partial<QueuedCard>): Promise<QueuedCard | undefined> {
  const card = await getCard(id);
  if (!card) return undefined;
  const next = { ...card, ...patch };
  await putCard(next);
  return next;
}

export async function removeCard(id: string): Promise<void> {
  await del(id, store);
  blobCache.delete(id);
  window.dispatchEvent(new Event(CHANGED));
}

export function onQueueChange(fn: () => void): () => void {
  window.addEventListener(CHANGED, fn);
  return () => window.removeEventListener(CHANGED, fn);
}
