"use client";

import { useEffect } from "react";
import { getCard, listCardInfo, onQueueChange, updateCard } from "@/lib/client/queue";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let running = false;
let wakeAgain = false;

// Sends queued cards to /api/extract one at a time, while the app is open.
async function processQueue() {
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
    } while (wakeAgain);
  } finally {
    running = false;
  }
}

async function drainQueue() {
  for (;;) {
    const info = (await listCardInfo()).find((c) => c.status === "queued");
    if (!info) return;
    const next = await getCard(info.id);
    if (!next) {
      await updateCard(info.id, { status: "failed", error: "The photo is missing. Remove this card and scan it again." });
      continue;
    }
    await updateCard(next.id, { status: "processing", error: undefined });

    const form = new FormData();
    form.append("front", next.front, "front.jpg");
    if (next.back) form.append("back", next.back, "back.jpg");

    let res: Response;
    try {
      res = await fetch("/api/extract", { method: "POST", body: form });
    } catch {
      await updateCard(next.id, { status: "queued", error: "No connection. Will retry." });
      await sleep(15_000);
      continue;
    }
    const body = await res.json().catch(() => ({}));
    if (res.status === 429) {
      await updateCard(next.id, { status: "queued", error: body.error ?? "Rate limited. Will retry." });
      await sleep(20_000);
    } else if (res.status === 401) {
      // Signed out (session ended): keep the card queued so it continues after signing in again.
      await updateCard(next.id, { status: "queued", error: "Signed out. Sign in again to continue." });
      return;
    } else if (!res.ok) {
      await updateCard(next.id, { status: "failed", error: body.error ?? `Error ${res.status}` });
      if (res.status === 403) return;
    } else {
      await updateCard(next.id, { status: "review", error: undefined, extraction: body.extraction });
    }
  }
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
