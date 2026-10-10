"use client";

// The owner field: a dropdown of the OWNERS setting, or (when that isn't set) free text with
// suggestions from earlier rows. A value not in the list (typed in the Sheet) stays selectable.
export function OwnerPicker({
  value,
  onChange,
  owners,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  owners: string[];
  className: string;
  ariaLabel?: string;
}) {
  if (owners.length === 0) {
    return (
      <input value={value} list="cardscan-owners" aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)} className={className} />
    );
  }
  return (
    <select value={value} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">—</option>
      {owners.map((o) => (
        <option key={o}>{o}</option>
      ))}
      {value && !owners.includes(value) && <option>{value}</option>}
    </select>
  );
}
