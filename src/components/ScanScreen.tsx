"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BlobImage } from "@/components/BlobImage";
import { compressImage } from "@/lib/client/image";
import { SuggestionLists, useSuggestions } from "@/lib/client/suggestions";
import {
  addCard as addToQueue,
  listCards,
  onQueueChange,
  removeCard,
  STATUS_LABELS,
  updateCard,
  type CardStatus,
  type QueuedCard,
} from "@/lib/client/queue";
import { today } from "@/lib/client/date";

const STATUS_STYLES: Record<CardStatus, string> = {
  queued: "bg-stone-200 text-stone-700",
  processing: "bg-sky-100 text-sky-800",
  review: "bg-amber-100 text-amber-900",
  saving: "bg-sky-100 text-sky-800",
  saved: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
};

function readPref(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function ScanScreen() {
  const [cards, setCards] = useState<QueuedCard[]>([]);
  const [event, setEvent] = useState("");
  const [dateMet, setDateMet] = useState("");
  const [front, setFront] = useState<Blob | null>(null);
  const [back, setBack] = useState<Blob | null>(null);
  const [busy, setBusy] = useState<"front" | "back" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const suggestions = useSuggestions();
  const frontInput = useRef<HTMLInputElement>(null);
  const backInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Saved preferences live in localStorage, which only exists in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEvent(readPref("cardscan:event", ""));
    // The date resets to today on a new day.
    const savedDate = readPref("cardscan:dateMet", "");
    const savedOn = readPref("cardscan:dateSetOn", "");
    setDateMet(savedOn === today() && savedDate ? savedDate : today());
    const refresh = () => listCards().then(setCards);
    refresh();
    return onQueueChange(refresh);
  }, []);

  async function pickPhoto(side: "front" | "back", file: File | undefined) {
    if (!file) return;
    setBusy(side);
    setError(null);
    try {
      const blob = await compressImage(file);
      if (side === "front") setFront(blob);
      else setBack(blob);
    } catch {
      setError("Could not read that photo. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function addCard() {
    if (!front) return;
    // Clear the slots straight away: a quick double tap can't add the card twice, and the next
    // photo can be taken while this one is being stored.
    const card = { id: crypto.randomUUID(), createdAt: Date.now(), status: "queued" as const, event: event.trim(), dateMet };
    const photos = { front, back };
    setFront(null);
    setBack(null);
    if (frontInput.current) frontInput.current.value = "";
    if (backInput.current) backInput.current.value = "";
    try {
      await addToQueue(card, photos.front, photos.back);
    } catch {
      setError("Could not store this card on the phone. Please try again.");
      setFront((f) => f ?? photos.front);
      setBack((b) => b ?? photos.back);
    }
  }

  // Several photos at once (for example, cards shot earlier with the phone's own camera):
  // each photo becomes one card, front only.
  async function importMany(files: FileList | null) {
    const list = files ? [...files] : [];
    if (list.length === 0) return;
    setError(null);
    setImporting({ done: 0, total: list.length });
    let failed = 0;
    for (const [i, file] of list.entries()) {
      try {
        const blob = await compressImage(file);
        await addToQueue(
          { id: crypto.randomUUID(), createdAt: Date.now() + i, status: "queued", event: event.trim(), dateMet },
          blob,
          null,
        );
      } catch {
        failed++;
      }
      setImporting({ done: i + 1, total: list.length });
    }
    setImporting(null);
    if (failed > 0) setError(`${failed} photo${failed > 1 ? "s" : ""} could not be read and ${failed > 1 ? "were" : "was"} skipped.`);
  }

  // Cards not yet saved whose event or date differ from what is entered now (e.g. the event was
  // typed after scanning): offer to apply the current event and date to them.
  const unsaved = cards.filter((c) => c.status !== "saved" && c.status !== "saving");
  const mismatched = unsaved.filter((c) => c.event !== event.trim() || c.dateMet !== dateMet);
  async function applyToQueue() {
    const ev = event.trim();
    for (const c of mismatched) {
      await updateCard(c.id, (cur) => ({
        event: ev,
        dateMet,
        draft: cur.draft ? { ...cur.draft, event: ev, date_met: dateMet } : cur.draft,
      }));
    }
  }

  const toReview = cards.filter((c) => c.status === "review");
  const saved = cards.filter((c) => c.status === "saved");
  const inProgress = cards.filter((c) => c.status === "queued" || c.status === "processing").length;

  return (
    <div className="flex flex-col gap-5">
      <section className="grid grid-cols-[minmax(0,1fr)_9.5rem] gap-2 rounded-xl border border-stone-200 bg-white p-3">
        <label className="flex flex-col gap-1 text-sm text-stone-600">
          Event / place met
          <input
            value={event}
            onChange={(e) => {
              setEvent(e.target.value);
              writePref("cardscan:event", e.target.value);
            }}
            placeholder="e.g. MedTech Asia"
            list="cardscan-events"
            className="w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm text-stone-600">
          Date met
          <input
            type="date"
            value={dateMet}
            onChange={(e) => {
              setDateMet(e.target.value);
              writePref("cardscan:dateMet", e.target.value);
              writePref("cardscan:dateSetOn", today());
            }}
            className="w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900"
          />
        </label>
        {mismatched.length > 0 && (event.trim() || dateMet) && (
          <button
            onClick={applyToQueue}
            className="col-span-2 rounded-lg border border-brand-dark px-3 py-2 text-sm font-medium text-brand"
          >
            Use this event &amp; date for {mismatched.length} card{mismatched.length > 1 ? "s" : ""} in the queue
          </button>
        )}
        <SuggestionLists {...suggestions} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          {(["front", "back"] as const).map((side) => {
            const blob = side === "front" ? front : back;
            return (
              <label
                key={side}
                className="relative flex aspect-[3/2] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-stone-300 bg-white text-stone-500 active:bg-stone-100"
              >
                {blob ? (
                  <BlobImage blob={blob} alt={`${side} of card`} className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <>
                    <span className="text-3xl">📷</span>
                    <span className="mt-1 text-sm font-medium">
                      {busy === side ? "Processing…" : side === "front" ? "Front" : "Back (optional)"}
                    </span>
                  </>
                )}
                <input
                  ref={side === "front" ? frontInput : backInput}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(e) => pickPhoto(side, e.target.files?.[0])}
                />
              </label>
            );
          })}
        </div>
        <div className="-mt-1 grid grid-cols-2 gap-3 text-center text-sm">
          {(["front", "back"] as const).map((side) => (
            <label key={side} className="cursor-pointer text-brand underline">
              {side === "front" ? "Front" : "Back"} from photos
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  pickPhoto(side, e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          ))}
        </div>
        <label className="cursor-pointer rounded-xl border border-stone-300 bg-white px-4 py-3 text-center font-medium text-stone-700 active:bg-stone-100">
          {importing ? `Importing ${importing.done} of ${importing.total}…` : "Import many photos (one card each)"}
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={importing !== null}
            className="sr-only"
            onChange={(e) => {
              importMany(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        {error && <p className="text-sm text-red-700">{error}</p>}
        {!front && !importing && (
          <p className="-mb-1 text-center text-sm text-stone-500">Take a photo of the front to add a card.</p>
        )}
        <button
          onClick={addCard}
          disabled={!front || busy !== null || importing !== null}
          className="rounded-xl bg-brand-dark px-4 py-3 text-lg font-medium text-on-accent disabled:bg-stone-300 active:bg-brand-darker"
        >
          Add card to queue
        </button>
      </section>

      {toReview.length > 0 && (
        <Link
          href={`/review/${toReview[0].id}`}
          className="rounded-xl bg-amber-700 px-4 py-3 text-center text-lg font-medium text-on-accent active:bg-amber-800"
        >
          Review {toReview.length} card{toReview.length > 1 ? "s" : ""}
        </Link>
      )}

      {cards.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">
              Queue{inProgress > 0 && <span className="font-normal text-stone-500"> · {inProgress} processing</span>}
            </h2>
            {saved.length > 0 && (
              <button
                onClick={() => saved.forEach((c) => removeCard(c.id))}
                className="text-sm text-stone-500 underline"
              >
                Clear saved
              </button>
            )}
          </div>
          <ul className="flex flex-col gap-2">
            {cards.map((card) => (
              <QueueItem key={card.id} card={card} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function QueueItem({ card }: { card: QueuedCard }) {
  const name =
    card.draft || card.extraction
      ? [
          [(card.draft ?? card.extraction)!.first_name, (card.draft ?? card.extraction)!.last_name].join(" ").trim(),
          (card.draft ?? card.extraction)!.company,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  return (
    <li className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-2">
      <BlobImage blob={card.front} alt="card" className="h-12 w-[4.5rem] shrink-0 rounded-md object-cover" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name || card.event || "Card"}</p>
        <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-sm ${STATUS_STYLES[card.status]}`}>
          {STATUS_LABELS[card.status]}
        </span>
        {card.error && <p className="truncate text-sm text-red-700">{card.error}</p>}
      </div>
      <div className="flex shrink-0 gap-1">
        {card.status === "review" && (
          <Link href={`/review/${card.id}`} className="rounded-lg bg-amber-700 px-3 py-2 text-sm text-on-accent">
            Review
          </Link>
        )}
        {card.status === "failed" && (
          <button
            onClick={() => updateCard(card.id, { status: "queued", error: undefined })}
            className="rounded-lg bg-brand-dark px-3 py-2 text-sm text-on-accent"
          >
            Retry
          </button>
        )}
        {card.status !== "processing" && card.status !== "saving" && (
          <button
            onClick={() => {
              if (card.status === "saved" || confirm("Remove this card from the queue? It has not been saved."))
                removeCard(card.id);
            }}
            aria-label="Remove"
            className="rounded-lg px-2 py-2 text-stone-400"
          >
            ✕
          </button>
        )}
      </div>
    </li>
  );
}
