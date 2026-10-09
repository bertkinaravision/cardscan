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
  .reply(200, () => ({ sheets: tabs.map((t) => ({ properties: { title: t.title, sheetId: t.sheetId } })) }))
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
      if (r.deleteDimension) {
        const { range } = r.deleteDimension as { range: { sheetId: number; startIndex: number; endIndex: number } };
        const tab = tabs.find((t) => t.sheetId === range.sheetId)!;
        tab.rows.splice(range.startIndex, range.endIndex - range.startIndex);
      }
      return {};
    }),
  }))
  .get(/\/v4\/spreadsheets\/sheet1\/values\/[^:]+$/)
  .reply(200, (uri) => {
    const { tab, startRow } = parseRange(uri.split("/values/")[1].split("?")[0]);
    const rows = tab!.rows.slice(startRow - 1).map((r) => {
      const copy = [...r];
      while (copy.length && copy[copy.length - 1] === "") copy.pop(); // Google trims trailing empty cells
      return copy;
    });
    while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
    return { values: rows.length ? rows : undefined };
  })
  .put(/\/v4\/spreadsheets\/sheet1\/values\/.+/)
  .reply(200, (uri, body: { values: string[][] }) => {
    assert.match(uri, /valueInputOption=RAW/);
    const { tab, startRow } = parseRange(uri.split("/values/")[1].split("?")[0]);
    while (tab!.rows.length < startRow) tab!.rows.push([]);
    tab!.rows[startRow - 1] = body.values[0];
    return {};
  })
  .post(/\/v4\/spreadsheets\/sheet1\/values\/.+:append/)
  .reply(200, (uri, body: { values: string[][] }) => {
    assert.match(uri, /valueInputOption=RAW/);
    const { tab } = parseRange(uri.split("/values/")[1].split(":append")[0]);
    tab!.rows.push(body.values[0]);
    return {};
  });

// ---- tests ----
const { appendContact, listContacts, getContact, updateContact, deleteContactRow } = await import("../src/lib/server/sheet");
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
assert.equal(validations, 1, "status dropdown added");
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
assert.equal(validations, 1, "no second dropdown when header is complete");

// 3. Update keeps unrelated cells, including the person's own column.
const updated = await updateContact("a1", { status: "In conversation", next_action: "Call" });
assert.equal(updated?.status, "In conversation");
assert.equal(contacts.rows[1][header.indexOf("My column")], "keep me");
assert.equal(contacts.rows[1][header.indexOf("first_name")], "Rachel");
assert.ok(contacts.rows[1][header.indexOf("last_updated")], "last_updated set");
assert.equal((await getContact("a1"))?.next_action, "Call");
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
