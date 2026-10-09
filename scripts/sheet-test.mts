// Tests the Google Sheets/Drive code against an in-memory fake of Google's APIs (no Google account needed).
// Run: npm test
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

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

// ---- fake Google APIs (shared with the adversarial tests) ----
const { fake, install, ops } = await import("../tests/fake-google.mjs");
install();

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
const contacts = fake.state.tabs.find((t: { title: string }) => t.title === "Contacts") as { rows: string[][] };
assert.ok(contacts, "Contacts tab created");
assert.deepEqual(contacts.rows[0], [...SHEET_COLUMNS], "header row written");
assert.equal(fake.state.validations, 2, "status and next action dropdowns added");
assert.equal(contacts.rows[1][SHEET_COLUMNS.indexOf("notes")], '=HYPERLINK("x")', "text kept as-is (RAW)");

// 2. A person adds a column and reorders; the app still maps by header name.
const header: string[] = contacts.rows[0];
ops.moveColumn("Contacts", 1, 2);
const width = header.length;
contacts.rows.forEach((r, i) => ops.setCell("Contacts", i, width, i === 0 ? "My column" : "keep me"));
await appendContact(row("a2", { first_name: "Kenji", last_name: "Sato", status: "Contacted" }));
const list = await listContacts();
assert.equal(list.length, 2);
assert.equal(list[0].first_name, "Rachel");
assert.equal(list[0].last_name, "Lim");
assert.equal(list[1].first_name, "Kenji");
assert.equal(contacts.rows[2][header.indexOf("first_name")], "Kenji", "written into the reordered column");
assert.equal(fake.state.validations, 2, "no extra dropdowns when header is complete");

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
Object.assign(fake.faults, { appendStatus: 429, appendCount: 2 });
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
ops.clearSpreadsheetMeta();
const before = fake.state.validations;
await listContacts();
assert.equal(fake.state.validations, before + 2, "dropdowns applied to an older Sheet");
await listContacts();
assert.equal(fake.state.validations, before + 2, "and only once");
assert.ok(ops.setupMarker(), "setup marker written");

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

// 14. A title row added above the headers (also in a Sheet from before the header marker existed).
fake.state.meta = fake.state.meta.filter((m: { metadataKey: string }) => m.metadataKey !== "cardscan_header");
ops.insertRows("Contacts", 0, 1, [["Kinara contacts"]]);
const before14 = (await listContacts()).map((c) => c.id);
assert.ok(before14.includes("r1") && before14.includes("a2"), "contacts found under the moved header row");
await appendContact(row("t1", { first_name: "Title", last_name: "Row" }));
assert.equal(contacts.rows[0].join(), "Kinara contacts", "title row left alone");
assert.ok((await listContacts()).some((c) => c.id === "t1"), "new contact readable");
ops.insertRows("Contacts", 0, 2);
assert.ok((await listContacts()).some((c) => c.id === "t1"), "found again after more rows are added above (header marker moved)");
console.log("Title row tests passed.");
