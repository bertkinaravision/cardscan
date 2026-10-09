"use client";

import { useEffect, useState } from "react";
import { fetchContacts } from "./contacts";

// Most-used spelling first; case and spacing variants ("Bert", "bert ") count as one.
function ranked(values: string[]): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const v of values) {
    const label = v.trim();
    if (!label) continue;
    const key = label.toLowerCase().replace(/\s+/g, " ");
    const hit = counts.get(key);
    if (hit) hit.n++;
    else counts.set(key, { label, n: 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).map((x) => x.label);
}

// Earlier events and owners from the Sheet, offered as suggestions so spellings stay consistent
// (which keeps the Contacts filters tidy). Falls back to no suggestions when offline.
export function useSuggestions(): { events: string[]; owners: string[] } {
  const [s, setS] = useState<{ events: string[]; owners: string[] }>({ events: [], owners: [] });
  useEffect(() => {
    fetchContacts().then(
      (cs) => setS({ events: ranked(cs.map((c) => c.event)), owners: ranked(cs.map((c) => c.owner)) }),
      () => {},
    );
  }, []);
  return s;
}

export function SuggestionLists({ events, owners }: { events: string[]; owners: string[] }) {
  return (
    <>
      <datalist id="cardscan-events">
        {events.map((e) => (
          <option key={e} value={e} />
        ))}
      </datalist>
      <datalist id="cardscan-owners">
        {owners.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}
