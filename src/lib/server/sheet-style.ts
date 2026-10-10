import "server-only";
import type { sheets_v4 } from "@googleapis/sheets";
import { FIELD_LABELS, STATUSES, type SheetColumn, type Status } from "@/lib/fields";

// The look the app gives the contacts tab once (later changes you make are left alone):
// readable headers in a coloured, frozen header row, sensible column widths, alternating row
// colours, coloured statuses, a filter on every column, and the app-only columns hidden.

type Req = sheets_v4.Schema$Request;
const rgb = (hex: string) => ({
  red: parseInt(hex.slice(1, 3), 16) / 255,
  green: parseInt(hex.slice(3, 5), 16) / 255,
  blue: parseInt(hex.slice(5, 7), 16) / 255,
});

const BRAND = "#136f96"; // Azure (dark), white text reads well on it
const STATUS_COLOURS: Record<Status, [bg: string, text: string]> = {
  New: ["#e3f2fb", "#0e5878"],
  Contacted: ["#dff5f1", "#0f5e55"],
  "In discussion": ["#fff3d6", "#7a4b00"],
  Closed: ["#e3f6e8", "#1e6b3a"],
  "Not relevant": ["#eeeeee", "#666666"],
};
// Pixel widths; columns not listed keep Google's default (100).
const WIDTHS: Partial<Record<SheetColumn, number>> = {
  salutation: 70, first_name: 130, last_name: 110, name_original: 120, job_title: 190, company: 190,
  email: 220, mobile: 140, website: 160, address: 240, linkedin: 170, other: 220, event: 150,
  date_met: 95, notes: 280, status: 115, contact_type: 110, owner: 90, next_action: 160,
  next_action_date: 115, linkedin_search: 130, scanned_by: 160, scanned_at: 150, last_updated: 150,
  image_front_link: 110, image_back_link: 110,
};
const HIDDEN: SheetColumn[] = ["id", "image_file_ids", "source_card_ids"];
const WRAP: SheetColumn[] = ["address", "other", "notes"];

// Header cells still showing the app's technical name (e.g. "first_name") get the readable label
// ("First name"); headers someone has renamed are kept.
export function readableHeaders(keys: (SheetColumn | null)[], headers: string[]): { col: number; label: string }[] {
  return keys.flatMap((k, col) => (k && FIELD_LABELS[k] && (headers[col] ?? "").trim() === k ? [{ col, label: FIELD_LABELS[k] }] : []));
}

export function styleRequests(sheetId: number, headerRow: number, keys: (SheetColumn | null)[], hasBanding: boolean): Req[] {
  const width = keys.length;
  const dataRows = { sheetId, startRowIndex: headerRow, startColumnIndex: 0, endColumnIndex: width };
  const column = (k: SheetColumn) => keys.indexOf(k);
  const requests: Req[] = [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: headerRow - 1, endRowIndex: headerRow, startColumnIndex: 0, endColumnIndex: width },
        cell: {
          userEnteredFormat: {
            backgroundColor: rgb(BRAND),
            textFormat: { bold: true, foregroundColor: rgb("#ffffff") },
            verticalAlignment: "MIDDLE",
            wrapStrategy: "WRAP",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)",
      },
    },
    {
      repeatCell: {
        range: dataRows,
        cell: { userEnteredFormat: { verticalAlignment: "TOP", wrapStrategy: "CLIP" } },
        fields: "userEnteredFormat(verticalAlignment,wrapStrategy)",
      },
    },
    // Dates show (and read back) as yyyy-mm-dd even when typed by hand, so the app's date fields
    // and sorting keep working.
    ...(["date_met", "next_action_date"] as const).filter((k) => column(k) >= 0).map((k) => ({
      repeatCell: {
        range: { sheetId, startRowIndex: headerRow, startColumnIndex: column(k), endColumnIndex: column(k) + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    })),
    ...WRAP.filter((k) => column(k) >= 0).map((k) => ({
      repeatCell: {
        range: { sheetId, startRowIndex: headerRow, startColumnIndex: column(k), endColumnIndex: column(k) + 1 },
        cell: { userEnteredFormat: { wrapStrategy: "WRAP" } },
        fields: "userEnteredFormat.wrapStrategy",
      },
    })),
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "ROWS", startIndex: headerRow - 1, endIndex: headerRow },
        properties: { pixelSize: 36 },
        fields: "pixelSize",
      },
    },
    ...keys.flatMap((k, i): Req[] =>
      k && (WIDTHS[k] || HIDDEN.includes(k))
        ? [
            {
              updateDimensionProperties: {
                range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
                properties: HIDDEN.includes(k) ? { hiddenByUser: true } : { pixelSize: WIDTHS[k] },
                fields: HIDDEN.includes(k) ? "hiddenByUser" : "pixelSize",
              },
            },
          ]
        : [],
    ),
    // Names stay in view while scrolling sideways, when they are among the first columns.
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: { frozenRowCount: headerRow, frozenColumnCount: column("last_name") >= 0 && column("last_name") < 5 ? column("last_name") + 1 : 0 },
        },
        fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
      },
    },
    ...STATUSES.map((s): Req => ({
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [{ sheetId, startRowIndex: headerRow, startColumnIndex: column("status"), endColumnIndex: column("status") + 1 }],
          booleanRule: {
            condition: { type: "TEXT_EQ", values: [{ userEnteredValue: s }] },
            format: { backgroundColor: rgb(STATUS_COLOURS[s][0]), textFormat: { foregroundColor: rgb(STATUS_COLOURS[s][1]), bold: true } },
          },
        },
      },
    })),
    { setBasicFilter: { filter: { range: { sheetId, startRowIndex: headerRow - 1, startColumnIndex: 0, endColumnIndex: width } } } },
  ];
  if (!hasBanding) {
    requests.push({
      addBanding: {
        bandedRange: {
          range: { sheetId, startRowIndex: headerRow - 1, startColumnIndex: 0, endColumnIndex: width },
          rowProperties: { headerColor: rgb(BRAND), firstBandColor: rgb("#ffffff"), secondBandColor: rgb("#f3f7f9") },
        },
      },
    });
  }
  return requests;
}
