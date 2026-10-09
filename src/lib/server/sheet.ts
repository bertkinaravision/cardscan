import "server-only";
import { FIELD_LABELS, NEXT_ACTIONS, SHEET_COLUMNS, STATUSES, type ContactRow, type SheetColumn } from "@/lib/fields";
import { requireEnv } from "./env";
import { explainGoogleError, sheetsClient } from "./google";

const tabName = () => process.env.SHEET_TAB || "Contacts";
const quoted = (title: string) => `'${title.replace(/'/g, "''")}'`;

function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Header text -> our column. Matches the technical name ("first_name") or a readable one
// ("First name", "Event / place met"), so headers can be renamed to look nicer in the Sheet.
const squash = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, "");
const HEADER_NAMES = new Map<string, SheetColumn>();
for (const c of SHEET_COLUMNS) {
  HEADER_NAMES.set(squash(c), c);
  if (FIELD_LABELS[c]) HEADER_NAMES.set(squash(FIELD_LABELS[c]), c);
}
export const headerKey = (h: string): SheetColumn | null => HEADER_NAMES.get(squash(h)) ?? null;

// headers: the header row as written; keys: which of our columns each one is (null = a column of your own).
// headerRow: the header row's number (1 unless someone added rows above it, such as a title).
// lastRow: the last row with anything in it (known once the rows have been read).
export type SheetInfo = {
  sheetId: number;
  title: string;
  headerRow: number;
  headers: string[];
  keys: (SheetColumn | null)[];
  lastRow?: number;
};

// Bump when the formatting applied to the tab changes, so existing Sheets get it once too.
const SETUP_VERSION = "2";
const SETUP_KEY = "cardscan_setup";
// Hidden markers (Google Sheets "developer metadata") that stay with the tab when it is renamed, with
// the header row when rows are inserted above it, and with each column when it is moved or its
// header renamed, so the app keeps finding all three however the Sheet is formatted.
const TAB_KEY = "cardscan_tab";
const HEADER_KEY = "cardscan_header";
const COLUMN_KEY = "cardscan_column";
const isColumn = (v: unknown): v is SheetColumn => (SHEET_COLUMNS as readonly unknown[]).includes(v);

type Meta = {
  metadataId?: number | null;
  metadataKey?: string | null;
  metadataValue?: string | null;
  location?: { sheetId?: number | null; dimensionRange?: { sheetId?: number | null; dimension?: string | null; startIndex?: number | null } | null } | null;
};

// Makes sure the tab and header row exist. Adds any of our columns that are missing
// (to the right of what is there), so a hand-made Sheet keeps working.
async function ensureSheet(): Promise<SheetInfo> {
  const sheets = sheetsClient();
  const spreadsheetId = requireEnv("SHEET_ID");

  const [meta, search] = await Promise.all([
    sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title)" }),
    sheets.spreadsheets.developerMetadata.search({
      spreadsheetId,
      requestBody: { dataFilters: [SETUP_KEY, TAB_KEY, HEADER_KEY, COLUMN_KEY].map((metadataKey) => ({ developerMetadataLookup: { metadataKey } })) },
    }),
  ]).catch((err) => {
    throw explainGoogleError(err, "sheet");
  });
  const found: Meta[] = (search.data.matchedDeveloperMetadata ?? []).map((m) => m.developerMetadata ?? {});
  const setupMeta = found.find((m) => m.metadataKey === SETUP_KEY);

  // The tab: the one the marker is on (so it may be renamed), else the one named SHEET_TAB / "Contacts".
  // When SHEET_TAB is set, that name decides.
  const tabs = (meta.data.sheets ?? []).map((s) => ({ sheetId: s.properties!.sheetId!, title: s.properties!.title! }));
  const marked = found.filter((m) => m.metadataKey === TAB_KEY).map((m) => m.location?.sheetId);
  const byMarker = process.env.SHEET_TAB ? [] : tabs.filter((t) => marked.includes(t.sheetId));
  let tab = byMarker.find((t) => t.title === tabName()) ?? byMarker[0] ?? tabs.find((t) => t.title === tabName());
  if (!tab) {
    // Set up before, so the tab was deleted: say so rather than quietly starting an empty one.
    if (setupMeta)
      throw new Error(
        `The "${tabName()}" tab is missing from the Sheet. If it was deleted by mistake, restore it (Edit → Undo, or File → Version history). To start fresh, add an empty tab named "${tabName()}".`,
      );
    const res = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tabName(), gridProperties: { frozenRowCount: 1 } } } }] },
    });
    tab = { sheetId: res.data.replies![0].addSheet!.properties!.sheetId!, title: tabName() };
  }
  const { sheetId, title } = tab;

  // The header row: where the marker says, else the first of the top rows with an "id" header
  // (a Sheet set up before the marker existed, possibly with a title added above), else row 1.
  const headerMeta = found.find(
    (m) => m.metadataKey === HEADER_KEY && m.location?.dimensionRange?.sheetId === sheetId && m.location.dimensionRange.dimension === "ROWS",
  );
  const markedRow = headerMeta ? (headerMeta.location!.dimensionRange!.startIndex ?? 0) + 1 : null;
  const top = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoted(title)}!${markedRow ? `${markedRow}:${markedRow}` : "1:10"}`,
  });
  const topRows = (top.data.values ?? []).map((r) => r.map((h) => String(h).trim()));
  const idRow = topRows.findIndex((r) => r.some((h) => headerKey(h) === "id"));
  const headerRow = markedRow ?? (idRow >= 0 ? idRow + 1 : 1);
  const existing = markedRow ? (topRows[0] ?? []) : (topRows[headerRow - 1] ?? []);
  // Which of our columns each column is: its marker first, else its header text. If two columns
  // claim the same one (say headers "Email" and "email"), only the first is used.
  const marks = new Map<number, SheetColumn>();
  for (const m of found) {
    const d = m.location?.dimensionRange;
    if (m.metadataKey !== COLUMN_KEY || d?.sheetId !== sheetId || d.dimension !== "COLUMNS" || !isColumn(m.metadataValue)) continue;
    if (!marks.has(d.startIndex ?? 0) && ![...marks.values()].includes(m.metadataValue)) marks.set(d.startIndex ?? 0, m.metadataValue);
  }
  const width = Math.max(existing.length, ...[...marks.keys()].map((i) => i + 1));
  const existingKeys: (SheetColumn | null)[] = Array.from({ length: width }, (_, i) => marks.get(i) ?? null);
  existingKeys.forEach((k, i) => {
    const byName = headerKey(existing[i] ?? "");
    if (!k && byName && !existingKeys.includes(byName)) existingKeys[i] = byName;
  });
  const missing = SHEET_COLUMNS.filter((c) => !existingKeys.includes(c));
  const headers = [...Array.from({ length: width }, (_, i) => existing[i] ?? ""), ...missing];
  const keys: (SheetColumn | null)[] = [...existingKeys, ...missing];

  if (missing.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quoted(title)}!${columnLetter(width)}${headerRow}`,
      valueInputOption: "RAW",
      requestBody: { values: [missing] },
    });
  }
  // Formatting and markers go to Google in one request.
  const requests: object[] = [];
  if (!marked.includes(sheetId)) {
    requests.push({
      createDeveloperMetadata: {
        developerMetadata: { metadataKey: TAB_KEY, metadataValue: "1", location: { sheetId }, visibility: "DOCUMENT" },
      },
    });
  }
  keys.forEach((k, i) => {
    if (k && marks.get(i) !== k) {
      requests.push({
        createDeveloperMetadata: {
          developerMetadata: {
            metadataKey: COLUMN_KEY,
            metadataValue: k,
            location: { dimensionRange: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 } },
            visibility: "DOCUMENT",
          },
        },
      });
    }
  });
  if (!headerMeta) {
    requests.push({
      createDeveloperMetadata: {
        developerMetadata: {
          metadataKey: HEADER_KEY,
          metadataValue: "1",
          location: { dimensionRange: { sheetId, dimension: "ROWS", startIndex: headerRow - 1, endIndex: headerRow } },
          visibility: "DOCUMENT",
        },
      },
    });
  }
  // Formatting is applied when columns are added, and once to Sheets set up by an older version
  // (marked in the Sheet's hidden developer metadata), so formatting you change later is left alone.
  const format = missing.length > 0 || setupMeta?.metadataValue !== SETUP_VERSION;
  if (format) {
    // Dropdown for the status column; dates shown (and read back) as yyyy-mm-dd even when typed
    // by hand in Sheets, so the app's date fields and sorting keep working; bold header.
    const statusCol = keys.indexOf("status");
    const nextActionCol = keys.indexOf("next_action");
    const dateFormats = (["date_met", "next_action_date"] as const).map((c) => {
      const col = keys.indexOf(c);
      return {
        repeatCell: {
          range: { sheetId, startRowIndex: headerRow, startColumnIndex: col, endColumnIndex: col + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" } } },
          fields: "userEnteredFormat.numberFormat",
        },
      };
    });
    requests.push(
      ...dateFormats,
      {
        repeatCell: {
          range: { sheetId, startRowIndex: headerRow - 1, endRowIndex: headerRow },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: "userEnteredFormat.textFormat.bold",
        },
      },
      {
        setDataValidation: {
          range: { sheetId, startRowIndex: headerRow, startColumnIndex: statusCol, endColumnIndex: statusCol + 1 },
          rule: {
            condition: { type: "ONE_OF_LIST", values: STATUSES.map((v) => ({ userEnteredValue: v })) },
            strict: false,
            showCustomUi: true,
          },
        },
      },
      setupMeta?.metadataId != null
        ? {
            updateDeveloperMetadata: {
              dataFilters: [{ developerMetadataLookup: { metadataId: setupMeta.metadataId } }],
              developerMetadata: { metadataValue: SETUP_VERSION },
              fields: "metadataValue",
            },
          }
        : {
            createDeveloperMetadata: {
              developerMetadata: {
                metadataKey: SETUP_KEY,
                metadataValue: SETUP_VERSION,
                location: { spreadsheet: true },
                visibility: "DOCUMENT",
              },
            },
          },
      // Next action: same choices as the app; anything else may still be typed.
      {
        setDataValidation: {
          range: {
            sheetId,
            startRowIndex: headerRow,
            startColumnIndex: nextActionCol,
            endColumnIndex: nextActionCol + 1,
          },
          rule: {
            condition: { type: "ONE_OF_LIST", values: NEXT_ACTIONS.map((v) => ({ userEnteredValue: v })) },
            strict: false,
            showCustomUi: true,
          },
        },
      },
    );
  }
  if (requests.length > 0) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  return { sheetId, title, headerRow, headers, keys };
}

function toRow(keys: (SheetColumn | null)[], values: string[]): ContactRow {
  const row = Object.fromEntries(SHEET_COLUMNS.map((c) => [c, ""])) as ContactRow;
  keys.forEach((k, i) => {
    if (k && !row[k]) row[k] = values[i] ?? "";
  });
  return row;
}

function toValues(keys: (SheetColumn | null)[], row: Partial<ContactRow>): string[] {
  return keys.map((k) => (k ? (row[k] ?? "") : ""));
}

async function readAll(): Promise<{ info: SheetInfo; rows: { rowNumber: number; values: string[] }[] }> {
  const info = await ensureSheet();
  const res = await sheetsClient().spreadsheets.values.get({
    spreadsheetId: requireEnv("SHEET_ID"),
    range: `${quoted(info.title)}!A${info.headerRow + 1}:${columnLetter(info.headers.length - 1)}`,
  });
  const rows = (res.data.values ?? []).map((v, i) => ({ rowNumber: i + info.headerRow + 1, values: v.map(String) }));
  const filled = rows.filter((r) => r.values.some(Boolean));
  return { info: { ...info, lastRow: filled.at(-1)?.rowNumber ?? info.headerRow }, rows };
}

export async function listContacts(): Promise<ContactRow[]> {
  return (await listContactsWithLayout()).contacts;
}

// The contacts plus the tab layout they were read with, so a save in the same request can reuse it.
export async function listContactsWithLayout(): Promise<{ contacts: ContactRow[]; layout: SheetInfo }> {
  const { info, rows } = await readAll();
  return { contacts: rows.map((r) => toRow(info.keys, r.values)).filter((r) => r.id), layout: info };
}

// `layout` may be passed when it was read moments ago in the same request (saves Sheets requests).
// If the same card is saved twice at the same moment (Approve tapped again while the first save
// was still running on bad Wi-Fi), both rows land. The later one then clears its own row and
// reports `duplicate`, so exactly one row is kept.
export async function appendContact(row: ContactRow, layout?: SheetInfo): Promise<{ duplicate: boolean }> {
  const info = layout?.lastRow ? layout : (await readAll()).info;
  const sheets = sheetsClient();
  const spreadsheetId = requireEnv("SHEET_ID");
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    // Starting at the last filled row, Google adds the row at the very bottom, even when there are
    // empty rows higher up, so no existing row ever moves (edits elsewhere stay on the right row).
    range: `${quoted(info.title)}!A${info.lastRow}`,
    // RAW so text from a card can never be run as a Sheets formula.
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [toValues(info.keys, row)] },
  });
  const written = Number(res.data.updates?.updatedRange?.match(/!\D*(\d+)/)?.[1]);
  const idCol = columnLetter(info.keys.indexOf("id"));
  const ids = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoted(info.title)}!${idCol}${info.headerRow + 1}:${idCol}`,
  });
  const rowsWithId = (ids.data.values ?? [])
    .map((v, i) => (String(v[0] ?? "") === row.id ? i + info.headerRow + 1 : 0))
    .filter(Boolean);
  if (rowsWithId.length < 2 || rowsWithId[0] === written || !rowsWithId.includes(written)) return { duplicate: false };
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${quoted(info.title)}!A${written}:${columnLetter(info.keys.length - 1)}${written}`,
  });
  return { duplicate: true };
}

// Finds a contact's row, then re-reads its id cell right before a write: if someone deleted a row
// meanwhile, the rows have shifted and we look again instead of touching the wrong contact.
async function locate(id: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { info, rows } = await readAll();
    const idCol = info.keys.indexOf("id");
    const found = rows.find((r) => r.values[idCol] === id);
    if (!found) return null;
    const check = await sheetsClient().spreadsheets.values.get({
      spreadsheetId: requireEnv("SHEET_ID"),
      range: `${quoted(info.title)}!${columnLetter(idCol)}${found.rowNumber}`,
    });
    if (String(check.data.values?.[0]?.[0] ?? "") === id) return { info, found };
  }
  throw new Error("The Sheet is changing right now. Please try again.");
}

// Writes only the changed cells, so edits made directly in the Sheet meanwhile are kept.
export async function updateContact(id: string, patch: Partial<ContactRow>): Promise<ContactRow | null> {
  const loc = await locate(id);
  if (!loc) return null;
  const { info, found } = loc;
  const changes: Partial<ContactRow> = { ...patch, last_updated: new Date().toISOString() };
  delete changes.id;
  const data = Object.entries(changes)
    .filter(([col]) => info.keys.includes(col as SheetColumn))
    .map(([col, value]) => ({
      range: `${quoted(info.title)}!${columnLetter(info.keys.indexOf(col as SheetColumn))}${found.rowNumber}`,
      values: [[value ?? ""]],
    }));
  await sheetsClient().spreadsheets.values.batchUpdate({
    spreadsheetId: requireEnv("SHEET_ID"),
    // RAW so text can never be run as a Sheets formula.
    requestBody: { valueInputOption: "RAW", data },
  });
  return { ...toRow(info.keys, found.values), ...changes, id } as ContactRow;
}

// Empties the contact's row rather than removing it: removing a row moves every row below it up,
// and an edit or delete running at the same moment could then land on the wrong contact.
// The empty row is skipped when reading; it can be removed by hand in the Sheet any time.
export async function deleteContactRow(id: string): Promise<ContactRow | null> {
  const loc = await locate(id);
  if (!loc) return null;
  const { info, found } = loc;
  await sheetsClient().spreadsheets.values.clear({
    spreadsheetId: requireEnv("SHEET_ID"),
    range: `${quoted(info.title)}!A${found.rowNumber}:${columnLetter(info.keys.length - 1)}${found.rowNumber}`,
  });
  return toRow(info.keys, found.values);
}
