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

export async function listCards(): Promise<QueuedCard[]> {
  const all = await values<QueuedCard>(store);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export const getCard = (id: string) => get<QueuedCard>(id, store);

export async function putCard(card: QueuedCard): Promise<void> {
  await set(card.id, card, store);
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
  window.dispatchEvent(new Event(CHANGED));
}

export function onQueueChange(fn: () => void): () => void {
  window.addEventListener(CHANGED, fn);
  return () => window.removeEventListener(CHANGED, fn);
}
