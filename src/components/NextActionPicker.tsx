"use client";

import { useState } from "react";
import { NEXT_ACTIONS } from "@/lib/fields";

const OTHER = "__other";

// Dropdown of common follow-ups; "Other…" opens a text box for anything else.
export function NextActionPicker({
  value,
  onChange,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const isPreset = (NEXT_ACTIONS as readonly string[]).includes(value);
  const [custom, setCustom] = useState(!!value && !isPreset);

  return (
    <div className="flex flex-col gap-2">
      <select
        aria-label="Next action"
        value={custom ? OTHER : value}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setCustom(true);
            if (isPreset) onChange("");
          } else {
            setCustom(false);
            onChange(e.target.value);
          }
        }}
        className={`rounded-lg border border-stone-300 bg-white px-3 py-2 text-ink ${className}`}
      >
        <option value="">None</option>
        {NEXT_ACTIONS.map((a) => (
          <option key={a}>{a}</option>
        ))}
        <option value={OTHER}>Other…</option>
      </select>
      {custom && (
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Describe the next action"
          aria-label="Other next action"
          className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-ink"
        />
      )}
    </div>
  );
}
