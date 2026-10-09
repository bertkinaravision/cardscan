"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BlobImage } from "@/components/BlobImage";
import { NextActionPicker } from "@/components/NextActionPicker";
import {
  EXTRACTED_FIELDS,
  FIELD_LABELS,
  STATUSES,
  emptyExtraction,
  type ContactInput,
  type ContactRow,
  type ExtractedField,
} from "@/lib/fields";
import { displayName, fetchContacts, findDuplicates, invalidateContacts } from "@/lib/client/contacts";
import { fetchWithTimeout, RequestTimeout } from "@/lib/client/fetch";
import { SuggestionLists, useSuggestions } from "@/lib/client/suggestions";
import { getCard, listCardInfo, removeCard, updateCard, type QueuedCard } from "@/lib/client/queue";

const MULTILINE = new Set(["address", "other", "notes"]);
const INPUT_MODES: Partial<Record<string, "email" | "tel" | "url">> = {
  email: "email",
  mobile: "tel",
  website: "url",
  linkedin: "url",
};

function initialDraft(card: QueuedCard, defaultOwner: string): ContactInput {
  const e = card.extraction ?? emptyExtraction();
  return {
    ...Object.fromEntries(EXTRACTED_FIELDS.map((f) => [f, e[f] ?? ""])),
    event: card.event,
    date_met: card.dateMet,
    notes: "",
    status: "To contact",
    owner: defaultOwner,
    next_action: "",
    next_action_date: "",
  } as ContactInput;
}

export function ReviewScreen({ id, defaultOwner }: { id: string; defaultOwner: string }) {
  const router = useRouter();
  const [card, setCard] = useState<QueuedCard | null | undefined>(undefined);
  const [draft, setDraft] = useState<ContactInput | null>(null);
  const [side, setSide] = useState<"front" | "back">("front");
  const [zoom, setZoom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The action bar is fixed to the bottom and grows when a duplicate is shown; keep that much space free
  // under the form so the last fields can always be scrolled into view.
  const [barHeight, setBarHeight] = useState(0);
  const barRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(() => setBarHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [saved, setSaved] = useState<ContactRow[]>([]);
  const [dupCheck, setDupCheck] = useState<"checking" | "done" | "failed">("checking");
  const suggestions = useSuggestions();
  // "" = save as a new contact; otherwise the id of the contact to update.
  const [mergeInto, setMergeInto] = useState("");

  useEffect(() => {
    // Saved contacts, to warn about duplicates. If this fails, review still works, but say so.
    fetchContacts().then(
      (rows) => {
        setSaved(rows);
        setDupCheck("done");
      },
      () => setDupCheck("failed"),
    );
  }, []);

  const duplicates = useMemo(() => (draft ? findDuplicates(draft, saved).slice(0, 3) : []), [draft, saved]);
  const mergeTarget = duplicates.find((d) => d.id === mergeInto);

  useEffect(() => {
    getCard(id).then((c) => {
      setCard(c ?? null);
      if (c) setDraft(c.draft ?? initialDraft(c, defaultOwner));
    });
  }, [id, defaultOwner]);

  function setField(name: keyof ContactInput, value: string) {
    setDraft((d) => {
      const next = { ...d!, [name]: value } as ContactInput;
      // Keep edits on the phone so nothing is lost if the app is closed.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(
        () => updateCard(id, (current) => (current.status === "review" ? { draft: next } : null)),
        400,
      );
      return next;
    });
  }

  async function goToNext() {
    const next = (await listCardInfo()).find((c) => c.status === "review" && c.id !== id);
    router.replace(next ? `/review/${next.id}` : "/");
  }

  async function approve() {
    if (!card || !draft) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaving(true);
    setError(null);
    await updateCard(id, { draft, status: "saving" });
    const form = new FormData();
    form.append("id", id);
    form.append("contact", JSON.stringify(draft));
    if (mergeTarget) form.append("mergeInto", mergeTarget.id);
    form.append("front", card.front, "front.jpg");
    if (card.back) form.append("back", card.back, "back.jpg");
    try {
      const res = await fetchWithTimeout("/api/contacts", { method: "POST", body: form }, 58_000);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
      invalidateContacts();
      await updateCard(id, { status: "saved", error: undefined });
      await goToNext();
    } catch (err) {
      // Tapping Approve again is safe: the server recognises a card it already saved.
      const message =
        err instanceof RequestTimeout
          ? "Saving took too long (slow connection). Tap Approve again."
          : err instanceof TypeError
            ? "No connection. Try again."
            : (err as Error).message;
      await updateCard(id, { status: "review", error: message });
      setError(message);
      setSaving(false);
    }
  }

  async function discard() {
    if (!confirm("Discard this card? Nothing will be saved.")) return;
    await removeCard(id);
    await goToNext();
  }

  if (card === undefined) return <p className="text-stone-500">Loading…</p>;
  if (card === null || !draft)
    return (
      <p>
        This card is no longer in the queue.{" "}
        <Link href="/" className="text-brand underline">
          Back to scanning
        </Link>
      </p>
    );

  const lowConfidence = new Set<string>(card.extraction?.low_confidence ?? []);
  const isSaved = card.status === "saved";

  return (
    <div className="flex flex-col gap-4">
      {/* Photo stays in view while scrolling through the fields. */}
      <div className="sticky top-[57px] z-[5] -mx-4 bg-stone-50 px-4 pt-1 pb-2 shadow-sm">
        <div
          className={`overflow-auto rounded-xl bg-stone-200 ${zoom ? "h-[45vh]" : "h-[28vh]"}`}
          onClick={() => setZoom((z) => !z)}
        >
          <BlobImage
            blob={side === "front" ? card.front : card.back}
            alt={`${side} of card`}
            className={zoom ? "max-w-none w-[220%]" : "h-full w-full object-contain"}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-sm">
          <div className="flex gap-1">
            {(["front", "back"] as const).map((s) => (
              <button
                key={s}
                disabled={s === "back" && !card.back}
                onClick={() => setSide(s)}
                className={`rounded-lg px-3 py-1 capitalize disabled:opacity-30 ${side === s ? "bg-brand-dark text-on-accent" : "bg-white text-stone-700 border border-stone-300"}`}
              >
                {s}
              </button>
            ))}
          </div>
          <span className="text-stone-500">Tap photo to zoom</span>
        </div>
      </div>

      {isSaved && <p className="rounded-lg bg-emerald-50 p-3 text-emerald-800">This card has been saved to the Sheet.</p>}
      {lowConfidence.size > 0 && !isSaved && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Fields marked <strong>Check</strong> were hard to read. Compare them with the photo.
        </p>
      )}

      {!isSaved && dupCheck !== "done" && (
        <p className="text-sm text-stone-500">
          {dupCheck === "checking"
            ? "Checking the Sheet for duplicates…"
            : "Could not check the Sheet for duplicates (no connection). You can still save."}
        </p>
      )}
      {duplicates.length > 0 && !isSaved && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-900">Possible duplicate already in the Sheet:</p>
          <label className="mt-1 flex items-center gap-2">
            <input type="radio" checked={!mergeTarget} onChange={() => setMergeInto("")} />
            Save as a new contact
          </label>
          {duplicates.map((d) => (
            <label key={d.id} className="mt-1 flex items-start gap-2">
              <input type="radio" className="mt-1" checked={mergeInto === d.id} onChange={() => setMergeInto(d.id)} />
              <span>
                Update <strong>{displayName(d) || d.email}</strong>
                {d.company && ` · ${d.company}`}
                <span className="block text-sm text-stone-600">
                  {[d.event, d.scanned_at.slice(0, 10), d.status].filter(Boolean).join(" · ")}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      <fieldset disabled={isSaved || saving} className="flex flex-col gap-3">
        <h2 className="font-semibold text-brand">Contact</h2>
        {EXTRACTED_FIELDS.map((f) => (
          <Field
            key={f}
            name={f}
            value={draft[f]}
            onChange={setField}
            flagged={lowConfidence.has(f) && draft[f] === (card.extraction?.[f as ExtractedField] ?? "")}
          />
        ))}

        <h2 className="mt-2 font-semibold text-brand">Where you met</h2>
        <Field name="event" value={draft.event} onChange={setField} list="cardscan-events" />
        <Field name="date_met" type="date" value={draft.date_met} onChange={setField} />
        <Field name="notes" value={draft.notes} onChange={setField} />

        <h2 className="mt-2 font-semibold text-brand">Follow-up</h2>
        <label className="flex flex-col gap-1 text-sm text-stone-600">
          {FIELD_LABELS.status}
          <select
            value={draft.status}
            onChange={(e) => setField("status", e.target.value)}
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-ink"
          >
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <Field name="owner" value={draft.owner} onChange={setField} list="cardscan-owners" />
        <label className="flex flex-col gap-1 text-sm text-stone-600">
          {FIELD_LABELS.next_action}
          <NextActionPicker value={draft.next_action} onChange={(v) => setField("next_action", v)} />
        </label>
        <Field name="next_action_date" type="date" value={draft.next_action_date} onChange={setField} />
      </fieldset>
      <SuggestionLists {...suggestions} />

      {!isSaved && <div aria-hidden style={{ height: Math.max(0, barHeight - 64) }} />}
      {!isSaved && (
        <div
          ref={barRef}
          className="fixed inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-white px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
          <div className="mx-auto flex max-w-xl flex-col gap-2">
            {error && <p className="text-sm text-red-700">Not saved: {error}</p>}
            <div className="flex gap-2">
              <button
                onClick={discard}
                disabled={saving}
                className="rounded-xl border border-stone-300 px-4 py-3 text-stone-700"
              >
                Discard
              </button>
              <button
                onClick={approve}
                disabled={saving}
                className="flex-1 rounded-xl bg-brand-dark px-4 py-3 text-lg font-semibold text-on-accent active:bg-brand-darker disabled:bg-mist"
              >
                {saving ? "Saving…" : mergeTarget ? "Approve & update" : "Approve & save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  name,
  value,
  onChange,
  flagged = false,
  type = "text",
  list,
}: {
  name: keyof ContactInput;
  value: string;
  onChange: (name: keyof ContactInput, value: string) => void;
  flagged?: boolean;
  type?: "text" | "date";
  list?: string;
}) {
  const cls = `rounded-lg border px-3 py-2 text-ink ${flagged ? "border-amber-400 bg-amber-50" : "border-stone-300 bg-white"}`;
  return (
    <label className="flex flex-col gap-1 text-sm text-stone-600">
      <span className="flex items-center gap-2">
        {FIELD_LABELS[name]}
        {flagged && <span className="rounded bg-amber-400 px-1.5 text-sm font-semibold text-warn-ink">Check</span>}
      </span>
      {MULTILINE.has(name) ? (
        <textarea value={value} rows={2} onChange={(e) => onChange(name, e.target.value)} className={cls} />
      ) : (
        <input
          type={type}
          list={list}
          value={value}
          inputMode={INPUT_MODES[name]}
          autoCapitalize={INPUT_MODES[name] ? "off" : undefined}
          onChange={(e) => onChange(name, e.target.value)}
          className={cls}
        />
      )}
    </label>
  );
}
