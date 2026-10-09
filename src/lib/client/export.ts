import { SHEET_COLUMNS, type ContactRow } from "@/lib/fields";

const EXPORT_COLUMNS = SHEET_COLUMNS.filter((c) => c !== "image_file_ids" && c !== "source_card_ids");

// Cells that start with these could run as formulas in Excel or Sheets.
// A plain phone number like "+65 6123 4567" is left alone.
const isPhone = (v: string) => /^\+[\d\s().-]+$/.test(v);
const csvCell = (v: string) => {
  const safe = /^[=+\-@\t\r]/.test(v) && !isPhone(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(rows: ContactRow[]): string {
  const lines = [EXPORT_COLUMNS.join(","), ...rows.map((r) => EXPORT_COLUMNS.map((c) => csvCell(r[c] ?? "")).join(","))];
  return "\uFEFF" + lines.join("\r\n"); // BOM so Excel opens Chinese/Japanese text correctly
}

const vEscape = (v: string) => v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");

export function toVCard(rows: ContactRow[]): string {
  return rows
    .map((r) => {
      const lines = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `N:${vEscape(r.last_name)};${vEscape(r.first_name)};;;`,
        `FN:${vEscape([r.first_name, r.last_name].filter(Boolean).join(" ") || r.name_original_script || r.company)}`,
      ];
      if (r.name_original_script) lines.push(`NICKNAME:${vEscape(r.name_original_script)}`);
      if (r.company) lines.push(`ORG:${vEscape(r.company)}`);
      if (r.job_title) lines.push(`TITLE:${vEscape(r.job_title)}`);
      if (r.email) lines.push(`EMAIL;TYPE=INTERNET,WORK:${vEscape(r.email)}`);
      if (r.phone) lines.push(`TEL;TYPE=WORK,VOICE:${vEscape(r.phone)}`);
      if (r.mobile) lines.push(`TEL;TYPE=CELL:${vEscape(r.mobile)}`);
      if (r.website) lines.push(`URL:${vEscape(r.website)}`);
      if (r.linkedin) lines.push(`X-SOCIALPROFILE;TYPE=linkedin:${vEscape(r.linkedin)}`);
      if (r.address) lines.push(`ADR;TYPE=WORK:;;${vEscape(r.address)};;;;`);
      const note = [r.event && `Met at ${r.event}${r.date_met ? ` on ${r.date_met}` : ""}`, r.notes, r.other]
        .filter(Boolean)
        .join("\n");
      if (note) lines.push(`NOTE:${vEscape(note)}`);
      lines.push("END:VCARD");
      return lines.join("\r\n");
    })
    .join("\r\n");
}

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
