"use client";

import { useEffect } from "react";
import { fetchWithTimeout, RequestTimeout } from "@/lib/client/fetch";
import { getCard, listCardInfo, onQueueChange, updateCard } from "@/lib/client/queue";

// The server allows 60s per card; give up a little earlier and try again.
const EXTRACT_TIMEOUT_MS = 50_000;
// After this many slow or "busy" answers in a row the card is marked failed (Retry starts over),
// so a card the model can't handle doesn't keep using up the free quota. Losing signal doesn't count.
const MAX_TRIES = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let running = false;
let wakeAgain = false;
// Set when the server says we're signed out or not allowed; signing in reloads the app and clears it.
let stopped = false;

// Sends queued cards to /api/extract one at a time, while the app is open.
async function processQueue() {
  if (stopped) return;
  if (running) {
    // A card may have been added after the loop last looked; make it look once more.
    wakeAgain = true;
    return;
  }
  running = true;
  try {
    do {
      wakeAgain = false;
      await drainQueue();
    } while (wakeAgain && !stopped);
  } finally {
    running = false;
  }
}

async function drainQueue() {
  for (;;) {
    const info = (await listCardInfo()).find((c) => c.status === "queued");
    if (!info) return;
    const next = await getCard(info.id);
    if (!next || next.front.size === 0) {
      await updateCard(info.id, { status: "failed", error: "The photo is missing. Remove this card and scan it again." });
      continue;
    }
    await updateCard(next.id, { status: "processing", error: undefined });

    const form = new FormData();
    form.append("front", next.front, "front.jpg");
    if (next.back) form.append("back", next.back, "back.jpg");

    let res: Response;
    try {
      res = await fetchWithTimeout("/api/extract", { method: "POST", body: form }, EXTRACT_TIMEOUT_MS);
    } catch (err) {
      if (err instanceof RequestTimeout) await retryLater(next.id, "Slow connection or busy AI model. Will retry.", "This card took too long to read several times. Tap Retry to try again.");
      else await updateCard(next.id, { status: "queued", error: "No connection. Will retry." });
      await sleep(15_000);
      continue;
    }
    const body = await res.json().catch(() => ({}));
    if (res.status === 429) {
      await retryLater(next.id, body.error ?? "Rate limited. Will retry.", "The AI model stayed busy. Tap Retry to try again.");
      await sleep(20_000);
    } else if (res.status === 401) {
      // Signed out (session ended): keep the card queued so it continues after signing in again.
      stopped = true;
      await updateCard(next.id, { status: "queued", error: "Signed out. Sign in again to continue." });
      return;
    } else if (!res.ok) {
      if (res.status === 403) stopped = true;
      await updateCard(next.id, { status: "failed", error: body.error ?? `Error ${res.status}` });
      if (stopped) return;
    } else if (!body.extraction) {
      // A reply that could not be read (cut off, or a page from a Wi-Fi login): don't show an empty form.
      await updateCard(next.id, { status: "failed", error: "Could not read the result. Tap Retry." });
    } else {
      await updateCard(next.id, { status: "review", error: undefined, extraction: body.extraction, tries: 0 });
    }
  }
}

// Back in the queue with a message, or failed once it has been tried MAX_TRIES times.
function retryLater(id: string, message: string, gaveUp: string) {
  return updateCard(id, (c) => {
    const tries = (c.tries ?? 0) + 1;
    return tries >= MAX_TRIES ? { status: "failed", error: gaveUp, tries: 0 } : { status: "queued", error: message, tries };
  });
}

export function QueueRunner() {
  useEffect(() => {
    (async () => {
      // Requests that were in flight when the app was closed start over.
      for (const c of await listCardInfo()) {
        if (c.status === "processing") await updateCard(c.id, { status: "queued" });
        if (c.status === "saving") await updateCard(c.id, { status: "review" });
      }
      processQueue();
    })();
    const off = onQueueChange(() => processQueue());
    const onOnline = () => processQueue();
    window.addEventListener("online", onOnline);
    return () => {
      off();
      window.removeEventListener("online", onOnline);
    };
  }, []);
  return null;
}
