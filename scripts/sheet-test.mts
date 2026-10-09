// Tests the Google Sheets/Drive code against an in-memory fake of Google's APIs (no Google account needed).
// Run: npx tsx --conditions=react-server --tsconfig tsconfig.json scripts/sheet-test.mts
// Needs `nock` installed (npm i -D nock).
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import nock from "nock";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: "test@test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
});
process.env.SHEET_ID = "sheet1";
process.env.DRIVE_FOLDER_ID = "folder1";
process.env.DRIVE_UPLOAD_MODE = "user";
delete process.env.HTTPS_PROXY;
delete process.env.https_proxy;

// ---- fake Google APIs ----
type Tab = { title: string; sheetId: number; rows: string[][] };
const tabs: Tab[] = [{ title: "Sheet1", sheetId: 0, rows: [] }];
const driveFiles = new Map<string, string>();
let validations = 0;
const devMeta: { metadataId: number; metadataKey: string; metadataValue: string }[] = [];
let busy = 0; // how many upcoming reads/appends answer 429 (Google's "too many requests")

function parseRange(range: string) {
  const m = decodeURIComponent(range).match(/^'?(.*?)'?!([A-Z]*)(\d*)(?::([A-Z]*)(\d*))?$/)!;
  const tab = tabs.find((t) => t.title === m[1].replace(/''/g, "'"));
  return { tab, startRow: m[3] ? Number(m[3]) : 1 };
}

nock.disableNetConnect();
nock("https://oauth2.googleapis.com").persist().post("/token").reply(200, { access_token: "sa-token", expires_in: 3600 });
nock("https://www.googleapis.com")
  .persist()
  .post(/\/upload\/drive\/v3\/files/)
  .reply(200, () => {
    const id = `file${driveFiles.size + 1}`;
    driveFiles.set(id, "jpeg");
    return { id, webViewLink: `https://drive.google.com/file/d/${id}/view` };
  })
  .delete(/\/drive\/v3\/files\/.*/)
  .reply((uri) => {
    const id = uri.split("/").pop()!.split("?")[0];
    return driveFiles.delete(id) ? [204, ""] : [404, { error: { code: 404 } }];
  });
nock("https://sheets.googleapis.com")
  .persist()
  .get(/\/v4\/spreadsheets\/sheet1\?/)
  .reply(200, () => ({
    sheets: tabs.map((t) => ({ properties: { title: t.title, sheetId: t.sheetId } })),
    developerMetadata: devMeta,
  }))
  .post("/v4/spreadsheets/sheet1:batchUpdate")
  .reply(200, (_uri, body: { requests: Record<string, unknown>[] }) => ({
    replies: body.requests.map((r) => {
      if (r.addSheet) {
        const title = (r.addSheet as { properties: { title: string } }).properties.title;
        const tab = { title, sheetId: tabs.length + 100, rows: [] };
        tabs.push(tab);
        return { addSheet: { properties: { title, sheetId: tab.sheetId } } };
      }
      if (r.setDataValidation) validations++;
      if (r.createDeveloperMetadata) {
        const m = (r.createDeveloperMetadata as { developerMetadata: { metadataKey: string; metadataValue: string } }).developerMetadata;
        devMeta.push({ metadataId: devMeta.length + 1, metadataKey: m.metadataKey, metadataValue: m.metadataValue });
      }
      if (r.updateDeveloperMetadata) {
        const u = r.updateDeveloperMetadata as { dataFilters: { developerMetadataLookup: { metadataId: number } }[]; developerMetadata: { metadataValue: string } };
        const m = devMeta.find((d) => d.metadataId === u.dataFilters[0].developerMetadataLookup.metadataId)!;
        m.metadataValue = u.developerMetadata.metadataValue;
      }
      if (r.deleteDimension) {
        const { range } = r.deleteDimension as { range: { sheetId: number; startIndex: number; endIndex: number } };
        const tab = tabs.find((t) => t.sheetId === range.sheetId)!;
        tab.rows.splice(range.startIndex, range.endIndex - range.startIndex);
      }
      return {};
    }),
  }))
  .get(/\/v4\/spreadsheets\/sheet1\/values\/[^:]+$/)
  .reply((uri) => {
    if (busy > 0) {
      busy--;
      return [429, { error: { code: 429, message: "Quota exceeded" } }];
    }
    const { tab, startRow } = parseRange(uri.split("/values/")[1].split("?")[0]);
    const rows = tab!.rows.slice(startRow - 1).map((r) => {
      const copy = [...r];
      while (copy.length && copy[copy.length - 1] === "") copy.pop(); // Google trims trailing empty cells
      return copy;
    });
    while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
    return [200, { values: rows.length ? rows : undefined }];
  })
  .put(/\/v4\/spreadsheets\/sheet1\/values\/.+/)
  .reply(200, (uri, body: { values: string[][] }) => {
    assert.match(uri, /valueInputOption=RAW/);
    const { tab, startRow } = parseRange(uri.split("/values/")[1].split("?")[0]);
    while (tab!.rows.length < startRow) tab!.rows.push([]);
    tab!.rows[startRow - 1] = body.values[0];
    return {};
  })
  .post("/v4/spreadsheets/sheet1/values:batchUpdate")
  .reply(200, (_uri, body: { valueInputOption: string; data: { range: string; values: string[][] }[] }) => {
    assert.equal(body.valueInputOption, "RAW");
    for (const d of body.data) {
      const m = decodeURIComponent(d.range).match(/^'?(.*?)'?!([A-Z]+)(\d+)$/)!;
      const tab = tabs.find((t) => t.title === m[1])!;
      const col = [...m[2]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const row = tab.rows[Number(m[3]) - 1];
      while (row.length <= col) row.push("");
      row[col] = d.values[0][0];
    }
    return {};
  })
  .post(/\/v4\/spreadsheets\/sheet1\/values\/.+:append/)
  .reply((uri, rawBody) => {
    const body = rawBody as { values: string[][] };
    if (busy > 0) {
      busy--;
      return [429, { error: { code: 429, message: "Quota exceeded" } }];
    }
    assert.match(uri, /valueInputOption=RAW/);
    const { tab } = parseRange(uri.split("/values/")[1].split(":append")[0]);
    tab!.rows.push(body.values[0]);
    return [200, {}];
  });

// ---- tests ----
const { appendContact, listContacts, updateContact, deleteContactRow } = await import("../src/lib/server/sheet");
const getContact = async (id: string) => (await listContacts()).find((c) => c.id === id) ?? null;
const { uploadImage, deleteImages } = await import("../src/lib/server/google");
const { SHEET_COLUMNS } = await import("../src/lib/fields");
type Row = Parameters<typeof appendContact>[0];

const row = (id: string, extra: Partial<Row> = {}): Row =>
  ({ ...Object.fromEntries(SHEET_COLUMNS.map((c) => [c, ""])), id, status: "To contact", ...extra }) as Row;

// 1. Missing tab and header are created.
await appendContact(row("a1", { first_name: "Rachel", last_name: "Lim", notes: '=HYPERLINK("x")' }));
const contacts = tabs.find((t) => t.title === "Contacts")!;
assert.ok(contacts, "Contacts tab created");
assert.deepEqual(contacts.rows[0], [...SHEET_COLUMNS], "header row written");
assert.equal(validations, 2, "status and next action dropdowns added");
assert.equal(contacts.rows[1][SHEET_COLUMNS.indexOf("notes")], '=HYPERLINK("x")', "text kept as-is (RAW)");

// 2. A person adds a column and reorders; the app still maps by header name.
const header: string[] = contacts.rows[0];
const swap = (r: string[]) => {
  [r[1], r[2]] = [r[2], r[1]];
  r.push(r === header ? "My column" : "keep me");
};
contacts.rows.forEach(swap);
await appendContact(row("a2", { first_name: "Kenji", last_name: "Sato", status: "Contacted" }));
const list = await listContacts();
assert.equal(list.length, 2);
assert.equal(list[0].first_name, "Rachel");
assert.equal(list[0].last_name, "Lim");
assert.equal(list[1].first_name, "Kenji");
assert.equal(contacts.rows[2][header.indexOf("first_name")], "Kenji", "written into the reordered column");
assert.equal(validations, 2, "no extra dropdowns when header is complete");

// 3. Update keeps unrelated cells, including the person's own column and hand edits made meanwhile.
contacts.rows[1][header.indexOf("notes")] = "typed in the Sheet";
const updated = await updateContact("a1", { status: "In conversation", next_action: "Call" });
assert.equal(updated?.status, "In conversation");
assert.equal(contacts.rows[1][header.indexOf("My column")], "keep me");
assert.equal(contacts.rows[1][header.indexOf("first_name")], "Rachel");
assert.ok(contacts.rows[1][header.indexOf("last_updated")], "last_updated set");
assert.equal((await getContact("a1"))?.next_action, "Call");
assert.equal(contacts.rows[1][header.indexOf("notes")], "typed in the Sheet", "hand edit in the Sheet kept");
assert.equal(await updateContact("nope", { status: "Closed" }), null);

// 4. Delete removes exactly that row.
const removed = await deleteContactRow("a1");
assert.equal(removed?.first_name, "Rachel");
const after = await listContacts();
assert.deepEqual(after.map((c) => c.id), ["a2"]);
assert.equal(await getContact("a1"), null);

// 5. Drive upload/delete (user mode uses the person's token).
const up = await uploadImage("user-token", "card.jpg", Buffer.from("jpeg"));
assert.equal(up.id, "file1");
assert.match(up.link, /file1/);
assert.deepEqual(await deleteImages("user-token", ["file1", "gone"]), [], "missing files count as deleted");
await assert.rejects(uploadImage(null, "x.jpg", Buffer.from("x")), /sign in again/);

console.log("All Sheet/Drive tests passed.");

// 6. Merging a rescanned card into an existing contact.
const { mergeContact } = await import("../src/lib/server/merge");
const old = row("m1", {
  first_name: "David", last_name: "Tan", company: "Example Pte Ltd", job_title: "Manager", email: "d@x.example",
  event: "SuperAI", date_met: "2026-06-01", notes: "Likes golf", status: "In conversation", owner: "Preeti",
  next_action: "Send deck", image_file_ids: "old1,old2",
});
const card = {
  ...Object.fromEntries(SHEET_COLUMNS.map((c) => [c, ""])),
  first_name: "David", last_name: "Tan", company: "Example Pte Ltd", job_title: "Director", email: "",
  event: "MedTech Asia", date_met: "2026-10-01", notes: "Now runs APAC", status: "To contact", owner: "Bert",
} as Parameters<typeof mergeContact>[1];
const m = mergeContact(old, card, { front: { id: "new1", link: "L1" }, back: null }, "2026-10-09T00:00:00Z");
assert.equal(m.job_title, "Director", "newer card value wins");
assert.equal(m.email, "d@x.example", "empty card value keeps the old one");
assert.equal(m.event, "SuperAI; MedTech Asia");
assert.equal(m.date_met, "2026-06-01", "first meeting date kept");
assert.equal(m.notes, "Likes golf\nNow runs APAC (met again at MedTech Asia, 2026-10-01)");
assert.equal(m.owner, "Preeti");
assert.equal(m.next_action, "Send deck");
assert.equal("status" in m, false, "status untouched");
assert.equal(m.image_front_link, "L1");
assert.equal("image_back_link" in m, false, "old back photo link kept");
assert.equal(m.image_file_ids, "old1,old2,new1", "all photos tracked for deletion");
assert.equal(mergeContact({ ...old, event: "SuperAI; MedTech Asia" }, card, { front: null, back: null }, "").event, "SuperAI; MedTech Asia", "event not added twice");

console.log("Merge tests passed.");
assert.equal(mergeContact({ ...old, event: "SuperAI" }, { ...card, event: "Super" }, { front: null, back: null }, "").event, "SuperAI; Super", "events matched exactly");
console.log("Event merge test passed.");

// 7. Setup mistakes give actionable messages.
const { explainGoogleError } = await import("../src/lib/server/google");
assert.match(explainGoogleError({ code: 403, message: "The caller does not have permission" }, "sheet").message, /Share the Sheet with test@test/);
assert.match(explainGoogleError({ code: 404, message: "Requested entity was not found." }, "sheet").message, /SHEET_ID/);
assert.match(explainGoogleError({ code: 403, message: "Request had insufficient authentication scopes." }, "drive").message, /tick the Google Drive box/);
assert.match(explainGoogleError({ code: 404, message: "File not found: folder1." }, "drive").message, /DRIVE_FOLDER_ID/);
assert.match(explainGoogleError({ code: 403, message: "Google Sheets API has not been used in project 1 before or it is disabled." }, "sheet").message, /not enabled/);
console.log("Error message tests passed.");

// 8. Lenient reading of the model's answer.
const { normalize } = await import("../src/lib/llm/index");
const { extractionSchema } = await import("../src/lib/fields");
const n = extractionSchema.parse(normalize({ first_name: " Ann ", last_name: null, mobile: 6512345678, other: ["a", "b"], low_confidence: ["email", "bogus", "email"] }));
assert.equal(n.first_name, "Ann");
assert.equal(n.last_name, "");
assert.equal(n.mobile, "6512345678");
assert.equal(n.other, "a; b");
assert.equal(n.company, "", "missing field filled");
assert.deepEqual(n.low_confidence, ["email"]);
const nested = extractionSchema.parse(normalize({ address: { street: "1 Road", city: "Singapore" }, mobile: [{ type: "work", number: "+65 1" }] }));
assert.equal(nested.address, "1 Road, Singapore");
assert.equal(nested.mobile, "work, +65 1");
console.log("Model answer normalisation tests passed.");

// 9. Titles move out of the first name.
const t = (first: string, salutation = "") => extractionSchema.parse(normalize({ first_name: first, salutation }));
assert.deepEqual([t("Dr. Bert").salutation, t("Dr. Bert").first_name], ["Dr.", "Bert"]);
assert.deepEqual([t("Prof Dr Wei Ming").salutation, t("Prof Dr Wei Ming").first_name], ["Prof Dr", "Wei Ming"]);
assert.deepEqual([t("Assoc. Prof. Siti").salutation, t("Assoc. Prof. Siti").first_name], ["Assoc. Prof.", "Siti"]);
assert.deepEqual([t("Dato' Ahmad").salutation, t("Dato' Ahmad").first_name], ["Dato'", "Ahmad"]);
assert.deepEqual([t("Drew").salutation, t("Drew").first_name], ["", "Drew"], "names starting like a title are untouched");
assert.deepEqual([t("Mr. Tan", "Dr.").salutation, t("Mr. Tan", "Dr.").first_name], ["Dr. Mr.", "Tan"]);
console.log("Salutation tests passed.");

// 10. Google says "too many requests": the save waits and succeeds.
const t0 = Date.now();
busy = 2;
await appendContact(row("q1", { first_name: "Busy", last_name: "Day" }));
assert.ok((await listContacts()).some((c) => c.id === "q1"), "saved after 429 retries");
console.log(`Retry-on-429 test passed (${((Date.now() - t0) / 1000).toFixed(1)}s).`);

// 11. Readable, renamed and reordered headers still map to the right columns.
const { headerKey } = await import("../src/lib/server/sheet");
assert.equal(headerKey("First name"), "first_name");
assert.equal(headerKey("Event / place met"), "event");
assert.equal(headerKey(" LinkedIn "), "linkedin");
assert.equal(headerKey("Next action date"), "next_action_date");
assert.equal(headerKey("My notes column"), null);
const h: string[] = contacts.rows[0];
const rename: Record<string, string> = { first_name: "First name", last_name: "Last name", event: "Event / place met", status: "Status" };
h.forEach((v, i) => (h[i] = rename[v] ?? v));
await appendContact(row("r1", { first_name: "Pretty", last_name: "Headers", event: "Expo", status: "Contacted" }));
const pretty = (await listContacts()).find((c) => c.id === "r1")!;
assert.deepEqual([pretty.first_name, pretty.last_name, pretty.event, pretty.status], ["Pretty", "Headers", "Expo", "Contacted"]);
assert.equal(contacts.rows[0].filter((x) => x === "first_name").length, 0, "no duplicate first_name column added");
await updateContact("r1", { status: "Closed" });
assert.equal(contacts.rows.find((r) => r[0] === "r1")![h.indexOf("Status")], "Closed");
console.log("Readable header tests passed.");

// 12. A Sheet made by an older version (all columns there, no setup marker) gets the dropdowns once.
devMeta.length = 0;
const before = validations;
await listContacts();
assert.equal(validations, before + 2, "dropdowns applied to an older Sheet");
await listContacts();
assert.equal(validations, before + 2, "and only once");
assert.equal(devMeta[0]?.metadataValue, "2");

// 13. Two headers for the same column: the first one is used for reading and writing.
const hdr: string[] = contacts.rows[0];
hdr.push("email");
const emailCols = hdr.map((v, i) => [v, i] as const).filter(([v]) => headerKey(v) === "email").map(([, i]) => i);
assert.equal(emailCols.length, 2);
await updateContact("r1", { email: "new@x.example" });
const r1 = contacts.rows.find((r) => r[0] === "r1")!;
assert.equal(r1[emailCols[0]], "new@x.example");
assert.equal((await listContacts()).find((c) => c.id === "r1")!.email, "new@x.example");
console.log("Setup marker and duplicate header tests passed.");
