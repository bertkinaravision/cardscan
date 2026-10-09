// Preloaded into `next start` (NODE_OPTIONS=--import) for the adversarial tests: replaces Google
// Sheets, Drive, OAuth and Gemini with an in-memory fake, so nothing real is ever touched.
// Faults are switched on through a small control server on FAKE_CONTROL_PORT (default 3199):
//   POST /reset            empty Sheet, no faults
//   POST /set   {…}        merge into `faults` or `state` (see below)
//   GET  /state            current tabs, Drive files and request log
import http from "node:http";
import nock from "nock";

const port = Number(process.env.FAKE_CONTROL_PORT || 3199);
// `next start` loads next.config.ts in a forked helper (it has an IPC channel); only fake in the server itself.
const isServer = typeof process.send !== "function";

let state, faults, log;
function reset() {
  state = { tabs: [{ title: "Sheet1", sheetId: 0, rows: [] }], files: new Map(), devMeta: [], nextFile: 1 };
  faults = {
    sheetsDelayMs: 0, // every Sheets call waits this long
    appendDelayMs: 0, // only the append waits (widens the double-submit window)
    sheetsGetStatus: null, sheetsGetCount: 0, // values.get answers this status N times
    appendStatus: null, appendCount: 0, // append answers this status N times
    appendWriteThenFail: 0, // append writes the row, then answers 500 (reply lost)
    metaStatus: null, metaCount: 0, // spreadsheets.get answers this status
    uploadStatus: null, uploadCount: 0,
    driveDeleteStatus: null,
    refreshStatus: null, // user token refresh (grant_type=refresh_token)
    gemini: [], // queue of answers: {status, message} | {text} | {delayMs, text}; empty = a good card
    geminiDefault: null,
  };
  log = [];
}
reset();

const ok = (text) => ({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] });
export const GOOD_CARD = {
  salutation: "", first_name: "Alex", last_name: "Lee", job_title: "CTO", company: "Fake Co",
  email: "alex@fake.example", mobile: "+65 9000 0000", website: "fake.example", address: "", linkedin: "",
  other: "", low_confidence: [],
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tabOf = (range) => {
  const m = decodeURIComponent(range).match(/^'?(.*?)'?!([A-Z]*)(\d*)(?::([A-Z]*)(\d*))?$/);
  return { tab: state.tabs.find((t) => t.title === m[1].replace(/''/g, "'")), startRow: m[3] ? Number(m[3]) : 1 };
};
const take = (key) => {
  if (faults[key + "Count"] > 0) {
    faults[key + "Count"]--;
    return faults[key + "Status"];
  }
  return null;
};
const gErr = (code, message) => [code, { error: { code, message, status: "ERR" } }];

if (!isServer) nock.restore();
nock.disableNetConnect();
nock.enableNetConnect(/localhost|127\.0\.0\.1/);

nock("https://oauth2.googleapis.com")
  .persist()
  .post("/token")
  .reply((_uri, body) => {
    const b = String(typeof body === "string" ? body : new URLSearchParams(body).toString());
    if (b.includes("grant_type=refresh_token")) {
      log.push("oauth:refresh");
      if (faults.refreshStatus) return [faults.refreshStatus, { error: "invalid_grant" }];
      return [200, { access_token: "user-token-2", expires_in: 3600 }];
    }
    return [200, { access_token: "sa-token", expires_in: 3600 }];
  });

nock("https://www.googleapis.com")
  .persist()
  .post(/\/upload\/drive\/v3\/files/)
  .reply(async () => {
    log.push("drive:upload");
    const s = take("upload");
    if (s) return gErr(s, "Upload failed");
    const id = `file${state.nextFile++}`;
    state.files.set(id, true);
    return [200, { id, webViewLink: `https://drive.google.com/file/d/${id}/view` }];
  })
  .delete(/\/drive\/v3\/files\/.*/)
  .reply((uri) => {
    log.push("drive:delete");
    if (faults.driveDeleteStatus) return gErr(faults.driveDeleteStatus, "Delete failed");
    const id = uri.split("/").pop().split("?")[0];
    return state.files.delete(id) ? [204, ""] : gErr(404, "not found");
  });

nock("https://sheets.googleapis.com")
  .persist()
  .get(/\/v4\/spreadsheets\/[^/]+\?/)
  .reply(async () => {
    log.push("sheets:meta");
    await wait(faults.sheetsDelayMs);
    const s = take("meta");
    if (s) return gErr(s, s === 403 ? "The caller does not have permission" : "Backend error");
    return [200, { sheets: state.tabs.map((t) => ({ properties: { title: t.title, sheetId: t.sheetId } })), developerMetadata: state.devMeta }];
  })
  .post(/\/v4\/spreadsheets\/[^/]+:batchUpdate/)
  .reply(async (_uri, body) => {
    log.push("sheets:batchUpdate");
    await wait(faults.sheetsDelayMs);
    const dup = body.requests.find((r) => r.addSheet && state.tabs.some((t) => t.title === r.addSheet.properties.title));
    if (dup) return gErr(400, `Invalid requests[0].addSheet: A sheet with the name "${dup.addSheet.properties.title}" already exists.`);
    const replies = body.requests.map((r) => {
      if (r.addSheet) {
        const title = r.addSheet.properties.title;
        const tab = { title, sheetId: state.tabs.length + 100, rows: [] };
        state.tabs.push(tab);
        return { addSheet: { properties: { title, sheetId: tab.sheetId } } };
      }
      if (r.createDeveloperMetadata) {
        const m = r.createDeveloperMetadata.developerMetadata;
        state.devMeta.push({ metadataId: state.devMeta.length + 1, metadataKey: m.metadataKey, metadataValue: m.metadataValue });
      }
      if (r.updateDeveloperMetadata) {
        const m = state.devMeta.find((d) => d.metadataId === r.updateDeveloperMetadata.dataFilters[0].developerMetadataLookup.metadataId);
        m.metadataValue = r.updateDeveloperMetadata.developerMetadata.metadataValue;
      }
      if (r.deleteDimension) {
        const { range } = r.deleteDimension;
        const tab = state.tabs.find((t) => t.sheetId === range.sheetId);
        tab.rows.splice(range.startIndex, range.endIndex - range.startIndex);
      }
      return {};
    });
    return [200, { replies }];
  })
  .get(/\/v4\/spreadsheets\/[^/]+\/values\/[^:]+$/)
  .reply(async (uri) => {
    log.push("sheets:get");
    await wait(faults.sheetsDelayMs);
    const s = take("sheetsGet");
    if (s) return gErr(s, "Backend error");
    const { tab, startRow } = tabOf(uri.split("/values/")[1].split("?")[0]);
    if (!tab) return gErr(400, "Unable to parse range");
    const rows = tab.rows.slice(startRow - 1).map((r) => {
      const copy = [...r];
      while (copy.length && copy[copy.length - 1] === "") copy.pop();
      return copy;
    });
    while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
    return [200, { values: rows.length ? rows : undefined }];
  })
  .put(/\/v4\/spreadsheets\/[^/]+\/values\/.+/)
  .reply(async (uri, body) => {
    log.push("sheets:put");
    await wait(faults.sheetsDelayMs);
    const { tab, startRow } = tabOf(uri.split("/values/")[1].split("?")[0]);
    while (tab.rows.length < startRow) tab.rows.push([]);
    tab.rows[startRow - 1] = body.values[0];
    return [200, {}];
  })
  .post(/\/v4\/spreadsheets\/[^/]+\/values:batchUpdate/)
  .reply(async (_uri, body) => {
    log.push("sheets:batchValues");
    await wait(faults.sheetsDelayMs);
    for (const d of body.data) {
      const m = decodeURIComponent(d.range).match(/^'?(.*?)'?!([A-Z]+)(\d+)$/);
      const tab = state.tabs.find((t) => t.title === m[1]);
      const col = [...m[2]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const row = tab.rows[Number(m[3]) - 1] ?? (tab.rows[Number(m[3]) - 1] = []);
      while (row.length <= col) row.push("");
      row[col] = d.values[0][0];
    }
    return [200, {}];
  })
  .post(/\/v4\/spreadsheets\/[^/]+\/values\/.+:append/)
  .reply(async (uri, body) => {
    log.push("sheets:append");
    await wait(faults.sheetsDelayMs + faults.appendDelayMs);
    const s = take("append");
    if (s) return gErr(s, s === 429 ? "Quota exceeded" : "Backend error");
    const { tab } = tabOf(uri.split("/values/")[1].split(":append")[0]);
    tab.rows.push(body.values[0]);
    if (faults.appendWriteThenFail > 0) {
      faults.appendWriteThenFail--;
      return gErr(500, "Backend error");
    }
    return [200, {}];
  });

nock("https://generativelanguage.googleapis.com")
  .persist()
  .post(/models\/[^:]+:generateContent/)
  .reply(async (uri, body) => {
    const model = uri.match(/models\/([^:]+):/)[1];
    const images = body.contents[0].parts.filter((p) => p.inlineData);
    log.push(`gemini:${model}:${images.map((i) => i.inlineData.data.length).join("+")}`);
    const a = faults.gemini.length ? faults.gemini.shift() : (faults.geminiDefault ?? { text: JSON.stringify(GOOD_CARD) });
    if (a.delayMs) await wait(a.delayMs);
    if (a.status) return gErr(a.status, a.message ?? "error");
    if (a.raw !== undefined) return [200, a.raw];
    return [200, ok(a.text)];
  })
  .get(/models\/[^:?]+/)
  .reply(200, { name: "models/x" });

// Control server.
if (isServer) http
  .createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const send = (v) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(v));
    };
    if (req.url === "/reset") {
      reset();
      return send({ ok: true });
    }
    if (req.url === "/set") {
      const v = JSON.parse(body || "{}");
      if (v.faults) Object.assign(faults, v.faults);
      if (v.tabs) state.tabs = v.tabs;
      return send({ ok: true });
    }
    if (req.url === "/state") return send({ tabs: state.tabs, files: [...state.files.keys()], log, faults });
    res.statusCode = 404;
    res.end();
  })
  .on("error", (e) => console.log(`[fake-google] control server not started in pid ${process.pid}: ${e.code}`))
  .listen(port, "127.0.0.1", () => console.log(`[fake-google] control server on ${port} (pid ${process.pid})`));
