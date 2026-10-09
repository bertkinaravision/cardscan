import "server-only";
import { SHEET_COLUMNS, STATUSES, type ContactRow, type SheetColumn } from "@/lib/fields";
import { requireEnv } from "./env";
import { sheetsClient } from "./google";

const tabName = () => process.env.SHEET_TAB || "Contacts";
const quotedTab = () => `'${tabName().replace(/'/g, "''")}'`;

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

type SheetInfo = { sheetId: number; headers: string[] };

// Makes sure the tab and header row exist. Adds any of our columns that are missing
// (to the right of what is there), so a hand-made Sheet keeps working.
async function ensureSheet(): Promise<SheetInfo> {
  const sheets = sheetsClient();
  const spreadsheetId = requireEnv("SHEET_ID");

  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  let sheetId = meta.data.sheets?.find((s) => s.properties?.title === tabName())?.properties?.sheetId;
  if (sheetId == null) {
    const res = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tabName(), gridProperties: { frozenRowCount: 1 } } } }] },
    });
    sheetId = res.data.replies![0].addSheet!.properties!.sheetId!;
  }

  const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${quotedTab()}!1:1` });
  const existing = (headerRes.data.values?.[0] ?? []).map((h) => String(h).trim());
  const missing = SHEET_COLUMNS.filter((c) => !existing.includes(c));
  const headers = [...existing, ...missing];

  if (missing.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quotedTab()}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
    // Dropdown for the status column.
    const statusCol = headers.indexOf("status");
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            setDataValidation: {
              range: { sheetId, startRowIndex: 1, startColumnIndex: statusCol, endColumnIndex: statusCol + 1 },
              rule: {
                condition: { type: "ONE_OF_LIST", values: STATUSES.map((v) => ({ userEnteredValue: v })) },
                strict: false,
                showCustomUi: true,
              },
            },
          },
        ],
      },
    });
  }
  return { sheetId, headers };
}

function toRow(headers: string[], values: string[]): ContactRow {
  const row = Object.fromEntries(SHEET_COLUMNS.map((c) => [c, ""])) as ContactRow;
  headers.forEach((h, i) => {
    if ((SHEET_COLUMNS as readonly string[]).includes(h)) row[h as SheetColumn] = values[i] ?? "";
  });
  return row;
}

function toValues(headers: string[], row: Partial<ContactRow>, base: string[] = []): string[] {
  return headers.map((h, i) => (h in row ? (row[h as SheetColumn] ?? "") : (base[i] ?? "")));
}

async function readAll(): Promise<{ info: SheetInfo; rows: { rowNumber: number; values: string[] }[] }> {
  const info = await ensureSheet();
  const res = await sheetsClient().spreadsheets.values.get({
    spreadsheetId: requireEnv("SHEET_ID"),
    range: `${quotedTab()}!A2:${columnLetter(info.headers.length - 1)}`,
  });
  const rows = (res.data.values ?? []).map((v, i) => ({ rowNumber: i + 2, values: v.map(String) }));
  return { info, rows };
}

export async function listContacts(): Promise<ContactRow[]> {
  const { info, rows } = await readAll();
  return rows.map((r) => toRow(info.headers, r.values)).filter((r) => r.id);
}

export async function getContact(id: string): Promise<ContactRow | null> {
  const { info, rows } = await readAll();
  const idCol = info.headers.indexOf("id");
  const found = rows.find((r) => r.values[idCol] === id);
  return found ? toRow(info.headers, found.values) : null;
}

export async function appendContact(row: ContactRow): Promise<void> {
  const info = await ensureSheet();
  await sheetsClient().spreadsheets.values.append({
    spreadsheetId: requireEnv("SHEET_ID"),
    range: `${quotedTab()}!A1`,
    // RAW so text from a card can never be run as a Sheets formula.
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [toValues(info.headers, row)] },
  });
}

export async function updateContact(id: string, patch: Partial<ContactRow>): Promise<ContactRow | null> {
  const { info, rows } = await readAll();
  const idCol = info.headers.indexOf("id");
  const found = rows.find((r) => r.values[idCol] === id);
  if (!found) return null;
  const values = toValues(info.headers, { ...patch, id, last_updated: new Date().toISOString() }, found.values);
  await sheetsClient().spreadsheets.values.update({
    spreadsheetId: requireEnv("SHEET_ID"),
    range: `${quotedTab()}!A${found.rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [values] },
  });
  return toRow(info.headers, values);
}

export async function deleteContactRow(id: string): Promise<ContactRow | null> {
  const { info, rows } = await readAll();
  const idCol = info.headers.indexOf("id");
  const found = rows.find((r) => r.values[idCol] === id);
  if (!found) return null;
  await sheetsClient().spreadsheets.batchUpdate({
    spreadsheetId: requireEnv("SHEET_ID"),
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId: info.sheetId, dimension: "ROWS", startIndex: found.rowNumber - 1, endIndex: found.rowNumber },
          },
        },
      ],
    },
  });
  return toRow(info.headers, found.values);
}
