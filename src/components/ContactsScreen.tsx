"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EXTRACTED_FIELDS, FIELD_LABELS, STATUSES, type ContactInput, type ContactRow, type Status } from "@/lib/fields";
import { deleteContact, displayName, fetchContacts, patchContact } from "@/lib/client/contacts";
import { download, toCsv, toVCard } from "@/lib/client/export";
import { NextActionPicker } from "@/components/NextActionPicker";

const STATUS_STYLES: Record<string, string> = {
  "To contact": "bg-brand/10 text-brand border-brand/30",
  Contacted: "bg-accent/15 text-teal-800 border-accent/40",
  "In conversation": "bg-amber-50 text-amber-900 border-amber-300",
  Closed: "bg-emerald-50 text-emerald-800 border-emerald-300",
  "Not relevant": "bg-stone-100 text-stone-500 border-stone-300",
};

type SortKey = "newest" | "next_action";

const today = () => new Date().toLocaleDateString("en-CA");

function distinct(rows: ContactRow[], key: keyof ContactRow) {
  return [...new Set(rows.map((r) => r[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function ContactsScreen() {
  const [contacts, setContacts] = useState<ContactRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [owner, setOwner] = useState("");
  const [event, setEvent] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    setLoadError(null);
    try {
      setContacts(await fetchContacts(force));
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    // Data comes from the server; the effect only starts the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const replace = (row: ContactRow) => setContacts((cs) => cs?.map((c) => (c.id === row.id ? row : c)) ?? null);

  const shown = useMemo(() => {
    if (!contacts) return [];
    const q = query.trim().toLowerCase();
    const rows = contacts.filter(
      (c) =>
        (!status || c.status === status) &&
        (!owner || c.owner === owner) &&
        (!event || c.event === event) &&
        (!q ||
          [
            c.first_name,
            c.last_name,
            c.company,
            c.job_title,
            c.email,
            c.event,
            c.notes,
            c.next_action,
          ]
            .join(" ")
            .toLowerCase()
            .includes(q)),
    );
    return rows.sort((a, b) => {
      if (sort === "next_action") {
        // Contacts with a next action date first, soonest first.
        const ad = a.next_action_date || "9999";
        const bd = b.next_action_date || "9999";
        if (ad !== bd) return ad.localeCompare(bd);
      }
      return b.scanned_at.localeCompare(a.scanned_at);
    });
  }, [contacts, query, status, owner, event, sort]);

  if (loadError)
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-lg bg-red-50 p-3 text-red-800">Could not load contacts: {loadError}</p>
        <button onClick={() => load(true)} className="rounded-xl bg-brand px-4 py-3 text-white">
          Try again
        </button>
      </div>
    );
  if (!contacts) return <p className="text-stone-500">Loading contacts…</p>;

  const filtered = shown.length !== contacts.length;
  const stamp = today();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-brand">Contacts</h1>
        <button onClick={() => load(true)} className="text-sm text-stone-500 underline">
          Refresh
        </button>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search name, company, email, notes…"
        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2"
      />
      <div className="grid grid-cols-2 gap-2 text-sm">
        <Select label="Status" value={status} onChange={setStatus} options={[...STATUSES]} />
        <Select label="Owner" value={owner} onChange={setOwner} options={distinct(contacts, "owner")} />
        <Select label="Event" value={event} onChange={setEvent} options={distinct(contacts, "event")} />
        <label className="flex flex-col gap-1 text-stone-600">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-stone-300 bg-white px-2 py-2 text-ink"
          >
            <option value="newest">Newest first</option>
            <option value="next_action">Next action date</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-stone-500">
        <span>
          {shown.length} {filtered ? `of ${contacts.length} ` : ""}contact{contacts.length === 1 ? "" : "s"}
        </span>
        {shown.length > 0 && (
          <span className="flex gap-2">
            <button
              onClick={() => download(`cardscan-${stamp}.csv`, toCsv(shown), "text/csv;charset=utf-8")}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1 text-stone-700"
            >
              Export CSV
            </button>
            <button
              onClick={() => download(`cardscan-${stamp}.vcf`, toVCard(shown), "text/vcard;charset=utf-8")}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1 text-stone-700"
            >
              Export vCard
            </button>
          </span>
        )}
      </div>

      {contacts.length === 0 && <p className="text-stone-500">No contacts yet. Scan a card to get started.</p>}

      <ul className="flex flex-col gap-2">
        {shown.map((c) => (
          <ContactItem
            key={c.id}
            contact={c}
            open={openId === c.id}
            onToggle={() => setOpenId((id) => (id === c.id ? null : c.id))}
            onChange={replace}
            onDeleted={() => setContacts((cs) => cs?.filter((x) => x.id !== c.id) ?? null)}
          />
        ))}
      </ul>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="flex flex-col gap-1 text-stone-600">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 rounded-lg border border-stone-300 bg-white px-2 py-2 text-ink"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

function ContactItem({
  contact: c,
  open,
  onToggle,
  onChange,
  onDeleted,
}: {
  contact: ContactRow;
  open: boolean;
  onToggle: () => void;
  onChange: (row: ContactRow) => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: Partial<ContactInput>) {
    setBusy(true);
    setError(null);
    const before = c;
    onChange({ ...c, ...patch } as ContactRow); // show the change right away
    try {
      onChange(await patchContact(c.id, patch));
      return true;
    } catch (err) {
      onChange(before);
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete ${displayName(c) || "this contact"}? This removes the Sheet row and the card photos. It cannot be undone.`))
      return;
    setBusy(true);
    setError(null);
    try {
      const { imagesNotDeleted } = await deleteContact(c.id);
      if (imagesNotDeleted.length > 0)
        alert(
          "The contact was deleted, but some card photos could not be removed from Drive (probably uploaded by the other person). Ask them to delete the files, or remove them from the Drive folder.",
        );
      onDeleted();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const overdue = c.next_action_date && c.next_action_date < today() && !["Closed", "Not relevant"].includes(c.status);

  return (
    <li className="rounded-xl border border-stone-200 bg-white">
      <div className="flex items-start gap-2 p-3">
        <button onClick={onToggle} className="min-w-0 flex-1 text-left" aria-expanded={open}>
          <p className="truncate font-medium">
            {displayName(c) || c.company || "(no name)"}
          </p>
          <p className="truncate text-sm text-stone-600">{[c.job_title, c.company].filter(Boolean).join(" · ")}</p>
          <p className="truncate text-xs text-stone-500">
            {[c.event, c.date_met, c.owner && `Owner: ${c.owner}`].filter(Boolean).join(" · ")}
          </p>
          {c.next_action && (
            <p className={`mt-1 truncate text-xs ${overdue ? "font-semibold text-red-700" : "text-stone-700"}`}>
              Next: {c.next_action}
              {c.next_action_date && ` (${c.next_action_date})`}
            </p>
          )}
        </button>
        <select
          aria-label="Status"
          value={c.status}
          disabled={busy}
          onChange={(e) => save({ status: e.target.value as Status })}
          className={`max-w-[9.5rem] shrink-0 rounded-full border px-2 py-1 text-sm ${STATUS_STYLES[c.status] ?? STATUS_STYLES["To contact"]}`}
        >
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      {error && <p className="px-3 pb-2 text-sm text-red-700">Not saved: {error}</p>}
      {open && <ContactDetails contact={c} busy={busy} onSave={save} onDelete={remove} />}
    </li>
  );
}

function ContactDetails({
  contact: c,
  busy,
  onSave,
  onDelete,
}: {
  contact: ContactRow;
  busy: boolean;
  onSave: (patch: Partial<ContactInput>) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [followUp, setFollowUp] = useState({
    owner: c.owner,
    next_action: c.next_action,
    next_action_date: c.next_action_date,
    notes: c.notes,
  });
  const [form, setForm] = useState<Record<string, string>>({});
  const followUpChanged = (Object.keys(followUp) as (keyof typeof followUp)[]).some((k) => followUp[k] !== c[k]);

  const startEdit = () => {
    setForm(Object.fromEntries([...EXTRACTED_FIELDS, "event", "date_met"].map((f) => [f, c[f as keyof ContactRow]])));
    setEditing(true);
  };

  const tel = (n: string) => n.replace(/[^\d+]/g, "");
  // Anything that is not already an http(s) link becomes https://…, so a cell like "javascript:…" can never run.
  const href = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

  return (
    <div className="flex flex-col gap-3 border-t border-stone-100 p-3 text-sm">
      {!editing && (
        <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1">
          {c.email && <Row label="Email" value={<a className="text-brand underline" href={`mailto:${c.email}`}>{c.email}</a>} />}
          {c.mobile && <Row label="Mobile" value={<a className="text-brand underline" href={`tel:${tel(c.mobile)}`}>{c.mobile}</a>} />}
          {c.website && <Row label="Website" value={<a className="text-brand underline" href={href(c.website)} target="_blank" rel="noreferrer">{c.website}</a>} />}
          {c.linkedin && <Row label="LinkedIn" value={<a className="text-brand underline" href={href(c.linkedin)} target="_blank" rel="noreferrer">{c.linkedin}</a>} />}
          {c.address && <Row label="Address" value={c.address} />}
          {c.other && <Row label="Other" value={c.other} />}
          <Row label="Scanned" value={`${c.scanned_by} · ${c.scanned_at.slice(0, 10)}`} />
          {(c.image_front_link || c.image_back_link) && (
            <Row
              label="Card photos"
              value={
                <span className="flex gap-3">
                  {c.image_front_link && <a className="text-brand underline" href={href(c.image_front_link)} target="_blank" rel="noreferrer">Front</a>}
                  {c.image_back_link && <a className="text-brand underline" href={href(c.image_back_link)} target="_blank" rel="noreferrer">Back</a>}
                </span>
              }
            />
          )}
        </dl>
      )}

      {editing ? (
        <div className="flex flex-col gap-2">
          {[...EXTRACTED_FIELDS, "event", "date_met"].map((f) => (
            <label key={f} className="flex flex-col gap-1 text-stone-600">
              {FIELD_LABELS[f]}
              <input
                type={f === "date_met" ? "date" : "text"}
                value={form[f] ?? ""}
                onChange={(e) => setForm((v) => ({ ...v, [f]: e.target.value }))}
                className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-ink"
              />
            </label>
          ))}
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="rounded-lg border border-stone-300 px-3 py-2">
              Cancel
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                if (await onSave(form as Partial<ContactInput>)) setEditing(false);
              }}
              className="flex-1 rounded-lg bg-brand px-3 py-2 font-medium text-white disabled:bg-mist"
            >
              Save contact details
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 rounded-lg bg-stone-50 p-2">
            <label className="flex flex-col gap-1 text-stone-600">
              Next action
              <NextActionPicker
                value={followUp.next_action}
                onChange={(next_action) => setFollowUp((v) => ({ ...v, next_action }))}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-stone-600">
                Next action date
                <input
                  type="date"
                  value={followUp.next_action_date}
                  onChange={(e) => setFollowUp((v) => ({ ...v, next_action_date: e.target.value }))}
                  className="w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2 py-2 text-ink"
                />
              </label>
              <label className="flex flex-col gap-1 text-stone-600">
                Owner
                <input
                  value={followUp.owner}
                  onChange={(e) => setFollowUp((v) => ({ ...v, owner: e.target.value }))}
                  className="w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-2 text-ink"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-stone-600">
              Notes
              <textarea
                rows={3}
                value={followUp.notes}
                onChange={(e) => setFollowUp((v) => ({ ...v, notes: e.target.value }))}
                className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-ink"
              />
            </label>
            {followUpChanged && (
              <button
                disabled={busy}
                onClick={() => onSave(followUp)}
                className="rounded-lg bg-brand px-3 py-2 font-medium text-white disabled:bg-mist"
              >
                Save follow-up
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={startEdit} className="rounded-lg border border-stone-300 px-3 py-2 text-stone-700">
              Edit details
            </button>
            <button
              onClick={() => download(`${displayName(c) || "contact"}.vcf`, toVCard([c]), "text/vcard;charset=utf-8")}
              className="rounded-lg border border-stone-300 px-3 py-2 text-stone-700"
            >
              Save to phone contacts
            </button>
            <button
              onClick={onDelete}
              disabled={busy}
              className="ml-auto rounded-lg border border-red-300 px-3 py-2 text-red-700"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-stone-500">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </>
  );
}
