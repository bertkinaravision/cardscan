import "server-only";
import { SHEET_COLUMNS, STATUSES, type ContactRow, type SheetColumn } from "@/lib/fields";
import { requireEnv } from "./env";
import { explainGoogleError, sheetsClient } from "./google";

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

  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" }).catch((err) => {
    throw explainGoogleError(err, "sheet");
  });
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
    // Dropdown for the status column; dates shown (and read back) as yyyy-mm-dd even when typed
    // by hand in Sheets, so the app's date fields and sorting keep working; bold header.
    const statusCol = headers.indexOf("status");
    const dateFormats = ["date_met", "next_action_date"].map((c) => {
      const col = headers.indexOf(c);
      return {
        repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" } } },
          fields: "userEnteredFormat.numberFormat",
        },
      };
    });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          ...dateFormats,
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: "userEnteredFormat.textFormat.bold",
            },
          },
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

function toValues(headers: string[], row: Partial<ContactRow>): string[] {
  return headers.map((h) => row[h as SheetColumn] ?? "");
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

// Finds a contact's row, then re-reads its id cell right before a write: if someone deleted a row
// meanwhile, the rows have shifted and we look again instead of touching the wrong contact.
async function locate(id: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { info, rows } = await readAll();
    const idCol = info.headers.indexOf("id");
    const found = rows.find((r) => r.values[idCol] === id);
    if (!found) return null;
    const check = await sheetsClient().spreadsheets.values.get({
      spreadsheetId: requireEnv("SHEET_ID"),
      range: `${quotedTab()}!${columnLetter(idCol)}${found.rowNumber}`,
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
    .filter(([col]) => info.headers.includes(col))
    .map(([col, value]) => ({
      range: `${quotedTab()}!${columnLetter(info.headers.indexOf(col))}${found.rowNumber}`,
      values: [[value ?? ""]],
    }));
  await sheetsClient().spreadsheets.values.batchUpdate({
    spreadsheetId: requireEnv("SHEET_ID"),
    // RAW so text can never be run as a Sheets formula.
    requestBody: { valueInputOption: "RAW", data },
  });
  return { ...toRow(info.headers, found.values), ...changes, id } as ContactRow;
}

export async function deleteContactRow(id: string): Promise<ContactRow | null> {
  const loc = await locate(id);
  if (!loc) return null;
  const { info, found } = loc;
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
