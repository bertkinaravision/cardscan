// In-memory fake of the Google APIs the app uses (Sheets, Drive, OAuth, Gemini), built on nock.
// Used by `npm test` (scripts/sheet-test.mts) and by the adversarial tests (tests/adversarial/).
// It models what matters for correctness: A1 ranges, append finding the end of the table,
// developer metadata that moves with its tab/row/column, and injectable faults.
import nock from "nock";

/** @type {{ state: any; faults: any; log: string[] }} */
export const fake = { state: null, faults: null, log: [] };

export function reset() {
  fake.state = { tabs: [{ title: "Sheet1", sheetId: 0, rows: [] }], files: new Map(), meta: [], nextFile: 1, nextMeta: 1, nextSheet: 100, validations: 0 };
  fake.faults = {
    sheetsDelayMs: 0, // every Sheets call waits this long
    appendDelayMs: 0, // only the append waits (widens the double-submit window)
    sheetsGetStatus: null, sheetsGetCount: 0, // values.get answers this status N times
    appendStatus: null, appendCount: 0, // append answers this status N times
    appendWriteThenFail: 0, // append writes the row, then answers 500 (reply lost)
    metaStatus: null, metaCount: 0, // spreadsheets.get answers this status
    uploadStatus: null, uploadCount: 0,
    driveDeleteStatus: null,
    refreshStatus: null, // user token refresh (grant_type=refresh_token)
    gemini: [], // queue of answers: {status, message} | {text} | {raw} | {delayMs, text}; empty = a good card
    geminiDefault: null,
  };
  fake.log = [];
}
reset();

export const GOOD_CARD = {
  salutation: "", first_name: "Alex", last_name: "Lee", job_title: "CTO", company: "Fake Co",
  email: "alex@fake.example", mobile: "+65 9000 0000", website: "fake.example", address: "", linkedin: "",
  other: "", low_confidence: [],
};

// ---- A1 notation ----
const colIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const colLetter = (i) => {
  let n = i + 1, s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};
// "'Tab'!A2:C" -> { tab, r1, c1, r2, c2 } (0-based, inclusive; open ends are Infinity)
function parseA1(range) {
  const m = decodeURIComponent(range).match(/^'?(.*?)'?!([A-Z]*)(\d*)(?::([A-Z]*)(\d*))?$/);
  if (!m) throw new Error(`bad range ${range}`);
  const tab = fake.state.tabs.find((t) => t.title === m[1].replace(/''/g, "'"));
  const single = m[4] === undefined && m[5] === undefined;
  const r1 = m[3] ? Number(m[3]) - 1 : 0;
  const c1 = m[2] ? colIndex(m[2]) : 0;
  const r2 = single ? (m[3] ? r1 : Infinity) : m[5] ? Number(m[5]) - 1 : Infinity;
  const c2 = single ? (m[2] ? c1 : Infinity) : m[4] ? colIndex(m[4]) : Infinity;
  return { tab, r1, c1, r2, c2 };
}
const nonEmpty = (row) => !!row && row.some((v) => v !== "" && v != null);
function setCell(tab, r, c, v) {
  while (tab.rows.length <= r) tab.rows.push([]);
  const row = tab.rows[r];
  while (row.length <= c) row.push("");
  row[c] = v;
}

// ---- developer metadata that follows rows/columns ----
const metaOn = (m, sheetId, dim) => m.location.dimensionRange?.sheetId === sheetId && m.location.dimensionRange.dimension === dim;
function shiftMeta(sheetId, dim, index, delta) {
  // delta > 0: `delta` rows/columns inserted at index. delta < 0: removed from index.
  fake.state.meta = fake.state.meta.filter((m) => {
    if (!metaOn(m, sheetId, dim)) return true;
    const d = m.location.dimensionRange;
    if (delta < 0 && d.startIndex >= index && d.startIndex < index - delta) return false;
    if (d.startIndex >= index) { d.startIndex += delta; d.endIndex += delta; }
    return true;
  });
}
function insertRow(tab, index, row) {
  tab.rows.splice(index, 0, row);
  shiftMeta(tab.sheetId, "ROWS", index, 1);
}

// Things a person does in the Sheet (metadata moves with them, as in Google Sheets).
export const ops = {
  insertRows(title, index, count, values = []) {
    const tab = fake.state.tabs.find((t) => t.title === title);
    for (let i = 0; i < count; i++) insertRow(tab, index + i, values[i] ?? []);
  },
  deleteRows(title, index, count) {
    const tab = fake.state.tabs.find((t) => t.title === title);
    tab.rows.splice(index, count);
    shiftMeta(tab.sheetId, "ROWS", index, -count);
  },
  renameTab(from, to) {
    fake.state.tabs.find((t) => t.title === from).title = to;
  },
  deleteTab(title) {
    const tab = fake.state.tabs.find((t) => t.title === title);
    fake.state.tabs = fake.state.tabs.filter((t) => t !== tab);
    fake.state.meta = fake.state.meta.filter((m) => m.location.sheetId !== tab.sheetId && m.location.dimensionRange?.sheetId !== tab.sheetId);
  },
  setCell(title, r, c, v) {
    setCell(fake.state.tabs.find((t) => t.title === title), r, c, v);
  },
  // Moves column `from` to position `to` (like dragging a column), metadata included.
  moveColumn(title, from, to) {
    const tab = fake.state.tabs.find((t) => t.title === title);
    const width = Math.max(...tab.rows.map((r) => r.length), from + 1, to + 1);
    for (const r of tab.rows) {
      while (r.length < width) r.push("");
      const [v] = r.splice(from, 1);
      r.splice(to, 0, v);
    }
    const order = [...Array(width).keys()];
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    for (const m of fake.state.meta) {
      if (!metaOn(m, tab.sheetId, "COLUMNS")) continue;
      const d = m.location.dimensionRange;
      d.startIndex = order.indexOf(d.startIndex);
      d.endIndex = d.startIndex + 1;
    }
  },
  setupMarker() {
    return fake.state.meta.find((m) => m.metadataKey === "cardscan_setup")?.metadataValue;
  },
  clearSpreadsheetMeta() {
    fake.state.meta = fake.state.meta.filter((m) => m.location.locationType !== "SPREADSHEET");
  },
  tab: (title) => fake.state.tabs.find((t) => t.title === title),
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const take = (key) => {
  if (fake.faults[key + "Count"] > 0) {
    fake.faults[key + "Count"]--;
    return fake.faults[key + "Status"];
  }
  return null;
};
const gErr = (code, message) => [code, { error: { code, message, status: "ERR" } }];
const ok = (text) => ({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] });

function applyRequest(r) {
  const s = fake.state;
  if (r.addSheet) {
    const title = r.addSheet.properties.title;
    const tab = { title, sheetId: s.nextSheet++, rows: [] };
    s.tabs.push(tab);
    return { addSheet: { properties: { title, sheetId: tab.sheetId } } };
  }
  if (r.setDataValidation) s.validations++;
  if (r.createDeveloperMetadata) {
    const m = structuredClone(r.createDeveloperMetadata.developerMetadata);
    const loc = m.location;
    loc.locationType = loc.spreadsheet ? "SPREADSHEET" : loc.dimensionRange ? (loc.dimensionRange.dimension === "ROWS" ? "ROW" : "COLUMN") : "SHEET";
    m.metadataId = s.nextMeta++;
    s.meta.push(m);
    return { createDeveloperMetadata: { developerMetadata: m } };
  }
  if (r.updateDeveloperMetadata) {
    const id = r.updateDeveloperMetadata.dataFilters[0].developerMetadataLookup.metadataId;
    const m = s.meta.find((d) => d.metadataId === id);
    m.metadataValue = r.updateDeveloperMetadata.developerMetadata.metadataValue;
  }
  if (r.deleteDimension) {
    const { range } = r.deleteDimension;
    const tab = s.tabs.find((t) => t.sheetId === range.sheetId);
    tab.rows.splice(range.startIndex, range.endIndex - range.startIndex);
    shiftMeta(tab.sheetId, "ROWS", range.startIndex, -(range.endIndex - range.startIndex));
  }
  return {};
}

export function install() {
  nock.disableNetConnect();
  nock.enableNetConnect(/localhost|127\.0\.0\.1/);

  nock("https://oauth2.googleapis.com")
    .persist()
    .post("/token")
    .reply((_uri, body) => {
      const b = typeof body === "string" ? body : new URLSearchParams(body).toString();
      if (b.includes("grant_type=refresh_token")) {
        fake.log.push("oauth:refresh");
        if (fake.faults.refreshStatus) return [fake.faults.refreshStatus, { error: "invalid_grant" }];
        return [200, { access_token: "user-token-2", expires_in: 3600 }];
      }
      return [200, { access_token: "sa-token", expires_in: 3600 }];
    });

  nock("https://www.googleapis.com")
    .persist()
    .post(/\/upload\/drive\/v3\/files/)
    .reply(() => {
      fake.log.push("drive:upload");
      const st = take("upload");
      if (st) return gErr(st, "Upload failed");
      const id = `file${fake.state.nextFile++}`;
      fake.state.files.set(id, true);
      return [200, { id, webViewLink: `https://drive.google.com/file/d/${id}/view` }];
    })
    .delete(/\/drive\/v3\/files\/.*/)
    .reply((uri) => {
      fake.log.push("drive:delete");
      if (fake.faults.driveDeleteStatus) return gErr(fake.faults.driveDeleteStatus, "Delete failed");
      const id = uri.split("/").pop().split("?")[0];
      return fake.state.files.delete(id) ? [204, ""] : gErr(404, "not found");
    });

  nock("https://sheets.googleapis.com")
    .persist()
    .get(/\/v4\/spreadsheets\/[^/]+\?/)
    .reply(async () => {
      fake.log.push("sheets:meta");
      await wait(fake.faults.sheetsDelayMs);
      const st = take("meta");
      if (st) return gErr(st, st === 403 ? "The caller does not have permission" : "Backend error");
      return [200, {
        sheets: fake.state.tabs.map((t) => ({ properties: { title: t.title, sheetId: t.sheetId } })),
        developerMetadata: fake.state.meta.filter((m) => m.location.locationType === "SPREADSHEET"),
      }];
    })
    .post(/\/v4\/spreadsheets\/[^/]+\/developerMetadata:search/)
    .reply(async (_uri, body) => {
      fake.log.push("sheets:search");
      await wait(fake.faults.sheetsDelayMs);
      const keys = body.dataFilters.map((f) => f.developerMetadataLookup?.metadataKey);
      const found = fake.state.meta.filter((m) => keys.includes(m.metadataKey));
      return [200, found.length ? { matchedDeveloperMetadata: found.map((m) => ({ developerMetadata: structuredClone(m) })) } : {}];
    })
    .post(/\/v4\/spreadsheets\/[^/]+:batchUpdate/)
    .reply(async (_uri, body) => {
      fake.log.push("sheets:batchUpdate");
      await wait(fake.faults.sheetsDelayMs);
      const dup = body.requests.find((r) => r.addSheet && fake.state.tabs.some((t) => t.title === r.addSheet.properties.title));
      if (dup) return gErr(400, `Invalid requests[0].addSheet: A sheet with the name "${dup.addSheet.properties.title}" already exists.`);
      return [200, { replies: body.requests.map(applyRequest) }];
    })
    .get(/\/v4\/spreadsheets\/[^/]+\/values\/[^:?]+(\?.*)?$/)
    .reply(async (uri) => {
      fake.log.push("sheets:get");
      await wait(fake.faults.sheetsDelayMs);
      const st = take("sheetsGet");
      if (st) return gErr(st, st === 429 ? "Quota exceeded" : "Backend error");
      const { tab, r1, c1, r2, c2 } = parseA1(uri.split("/values/")[1].split("?")[0]);
      if (!tab) return gErr(400, "Unable to parse range");
      const rows = tab.rows.slice(r1, r2 === Infinity ? undefined : r2 + 1).map((r) => {
        const copy = r.slice(c1, c2 === Infinity ? undefined : c2 + 1);
        while (copy.length && copy[copy.length - 1] === "") copy.pop(); // Google trims trailing empty cells
        return copy;
      });
      while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
      return [200, { values: rows.length ? rows : undefined }];
    })
    .put(/\/v4\/spreadsheets\/[^/]+\/values\/.+/)
    .reply(async (uri, body) => {
      fake.log.push("sheets:put");
      await wait(fake.faults.sheetsDelayMs);
      if (!/valueInputOption=RAW/.test(uri)) return gErr(400, "test fake: only RAW writes expected");
      const { tab, r1, c1 } = parseA1(uri.split("/values/")[1].split("?")[0]);
      body.values.forEach((row, i) => row.forEach((v, j) => v != null && setCell(tab, r1 + i, c1 + j, v)));
      return [200, {}];
    })
    .post(/\/v4\/spreadsheets\/[^/]+\/values:batchUpdate/)
    .reply(async (_uri, body) => {
      fake.log.push("sheets:batchValues");
      await wait(fake.faults.sheetsDelayMs);
      if (body.valueInputOption !== "RAW") return gErr(400, "test fake: only RAW writes expected");
      for (const d of body.data) {
        const { tab, r1, c1 } = parseA1(d.range);
        d.values.forEach((row, i) => row.forEach((v, j) => v != null && setCell(tab, r1 + i, c1 + j, v)));
      }
      return [200, {}];
    })
    .post(/\/v4\/spreadsheets\/[^/]+\/values\/.+:clear/)
    .reply(async (uri) => {
      fake.log.push("sheets:clear");
      await wait(fake.faults.sheetsDelayMs);
      const { tab, r1, c1, r2, c2 } = parseA1(uri.split("/values/")[1].split(":clear")[0]);
      for (let r = r1; r <= Math.min(r2, tab.rows.length - 1); r++) {
        const row = tab.rows[r];
        for (let c = c1; c <= Math.min(c2, row.length - 1); c++) row[c] = "";
      }
      return [200, {}];
    })
    .post(/\/v4\/spreadsheets\/[^/]+\/values\/.+:append/)
    .reply(async (uri, body) => {
      fake.log.push("sheets:append");
      await wait(fake.faults.sheetsDelayMs + fake.faults.appendDelayMs);
      const st = take("append");
      if (st) return gErr(st, st === 429 ? "Quota exceeded" : "Backend error");
      if (!/valueInputOption=RAW/.test(uri)) return gErr(400, "test fake: only RAW writes expected");
      const { tab, r1 } = parseA1(uri.split("/values/")[1].split(":append")[0]);
      // Like Google: find the table at or below the range start, append after its last row.
      let start = r1;
      while (start < tab.rows.length && !nonEmpty(tab.rows[start])) start++;
      let end = start;
      while (end < tab.rows.length && nonEmpty(tab.rows[end])) end++;
      const at = Math.max(end, r1);
      insertRow(tab, at, [...body.values[0]]);
      if (fake.faults.appendWriteThenFail > 0) {
        fake.faults.appendWriteThenFail--;
        return gErr(500, "Backend error");
      }
      const q = `'${tab.title.replace(/'/g, "''")}'`;
      return [200, { updates: { updatedRange: `${q}!A${at + 1}:${colLetter(body.values[0].length - 1)}${at + 1}`, updatedRows: 1 } }];
    });

  nock("https://generativelanguage.googleapis.com")
    .persist()
    .post(/models\/[^:]+:generateContent/)
    .reply(async (uri, body) => {
      const model = uri.match(/models\/([^:]+):/)[1];
      const images = body.contents[0].parts.filter((p) => p.inlineData);
      fake.log.push(`gemini:${model}:${images.map((i) => i.inlineData.data.length).join("+")}`);
      const a = fake.faults.gemini.length ? fake.faults.gemini.shift() : (fake.faults.geminiDefault ?? { text: JSON.stringify(GOOD_CARD) });
      if (a.delayMs) await wait(a.delayMs);
      if (a.status) return gErr(a.status, a.message ?? "error");
      if (a.raw !== undefined) return [200, a.raw];
      return [200, ok(a.text)];
    })
    .get(/models\/[^:?]+/)
    .reply(200, { name: "models/x" });
}
