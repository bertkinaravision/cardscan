// Adversarial API tests against the app running on the fake backend (tests/adversarial/start-server.sh).
// Run: node tests/adversarial/api.mjs [filter]      Writes results to tests/adversarial/results-api.json
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { BASE, JPEG, contacts, cookie, emptyContact, extract, fake, record, results, save } from "./lib.mjs";

const only = process.argv[2];
const tests = [];
const test = (id, name, fn) => tests.push({ id, name, fn });
const jpeg = (bytes = JPEG, type = "image/jpeg") => new Blob([bytes], { type });
const rows = async () => (await fake.state()).tabs.find((t) => t.title === "Contacts")?.rows ?? [];
const dataRows = async () => (await rows()).slice(1).filter((r) => r.some(Boolean));
const short = (v) => JSON.stringify(v)?.slice(0, 220);
const patch = async (c, id, body, raw) => {
  const res = await fetch(`${BASE}/api/contacts/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { cookie: c, "content-type": "application/json" }, body: raw ?? JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const del = async (c, id) => {
  const res = await fetch(`${BASE}/api/contacts/${encodeURIComponent(id)}`, { method: "DELETE", headers: { cookie: c } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
// Saves contacts named A, B, C… and returns their ids.
async function seed(c, names) {
  const ids = [];
  for (const n of names) ids.push((await save(c, { contact: emptyContact({ first_name: n }) })).id);
  return ids;
}
const looksRaw = (msg) => /\{|\[object|status|code|ECONN|TypeError|SyntaxError|Unexpected|gaxios|request to/i.test(msg ?? "");

// ---------- Authentication ----------
test("AUTH-1", "Extract without a session cookie", async () => {
  const r = await extract("", { front: jpeg() });
  record("AUTH-1", "Extract without a session cookie", "401", `${r.status} ${short(r.body)}`, r.status === 401);
});
test("AUTH-2", "Signed-in Google account not on the allowlist", async () => {
  const r = await extract(await cookie("stranger@example.com"), { front: jpeg() });
  record("AUTH-2", "Account not on the allowlist", "403", `${r.status} ${short(r.body)}`, r.status === 403);
});
test("AUTH-3", "Tampered session cookie", async () => {
  const c = (await cookie()).slice(0, -6) + "AAAAAA";
  const r = await contacts(c);
  record("AUTH-3", "Tampered session cookie", "401", `${r.status} ${short(r.body)}`, r.status === 401);
});

// ---------- Extract: inputs ----------
test("EX-1", "Extract with no front photo", async () => {
  const r = await extract(await cookie(), {});
  record("EX-1", "Extract with no front photo", "400 with a clear message", `${r.status} ${short(r.body)}`, r.status === 400);
});
test("EX-2", "Zero-byte front photo", async () => {
  const r = await extract(await cookie(), { front: jpeg(Buffer.alloc(0)) });
  const calls = (await fake.state()).log.filter((l) => l.startsWith("gemini"));
  record("EX-2", "Zero-byte front photo", "400 before calling the model", `${r.status} ${short(r.body)}; model calls: ${short(calls)}`, r.status === 400 && calls.length === 0);
});
test("EX-3", "PNG declared as image/png", async () => {
  const r = await extract(await cookie(), { front: jpeg(Buffer.from("89504e470d0a1a0a", "hex"), "image/png") });
  record("EX-3", "PNG photo declared as PNG", "400", `${r.status} ${short(r.body)}`, r.status === 400);
});
test("EX-4", "Text file declared as image/jpeg", async () => {
  const r = await extract(await cookie(), { front: jpeg(Buffer.from("<script>alert(1)</script> not an image")) });
  const calls = (await fake.state()).log.filter((l) => l.startsWith("gemini"));
  record("EX-4", "Non-image bytes declared as JPEG", "400 before calling the model", `${r.status}; model calls: ${short(calls)}`, r.status === 400 && calls.length === 0);
});
test("EX-5", "5 MB front photo", async () => {
  const r = await extract(await cookie(), { front: jpeg(Buffer.alloc(5 * 1024 * 1024, 0xff)) });
  record("EX-5", "5 MB front photo", "413 with a clear message", `${r.status} ${short(r.body)}`, r.status === 413);
});
test("EX-6", "Front sent as a text field", async () => {
  const r = await extract(await cookie(), { front: "hello" });
  record("EX-6", "Front sent as text, not a file", "400", `${r.status} ${short(r.body)}`, r.status === 400);
});
test("EX-7", "JSON body instead of a form", async () => {
  const res = await fetch(`${BASE}/api/extract`, { method: "POST", headers: { cookie: await cookie(), "content-type": "application/json" }, body: "{}" });
  const body = await res.json().catch(() => null);
  record("EX-7", "JSON body instead of multipart form", "400 with a clear message", `${res.status} ${short(body)}`, res.status === 400 && !looksRaw(body?.error));
});

// ---------- Extract: model failures ----------
test("LLM-1", "Gemini 429 rate limit", async () => {
  await fake.set({ faults: { gemini: [{ status: 429, message: "Resource has been exhausted (e.g. check quota)." }] } });
  const r = await extract(await cookie(), { front: jpeg() });
  record("LLM-1", "Model rate limit (429)", "429 'busy, retrying'", `${r.status} ${short(r.body)}`, r.status === 429);
});
test("LLM-2", "Daily quota used up on every model", async () => {
  const q = { status: 429, message: "Quota exceeded for metric: generate_content_free_tier_requests, limit: GenerateRequestsPerDayPerProjectPerModel" };
  await fake.set({ faults: { gemini: [q, q] } });
  const r = await extract(await cookie(), { front: jpeg() });
  const r2 = await extract(await cookie(), { front: jpeg() }); // models are now skipped for an hour
  await fake.set({ faults: { gemini: [] } });
  record("LLM-2", "Daily quota exhausted on all models", "clear 'daily limit' error, card marked failed",
    `${r.status} ${short(r.body)} / next call: ${r2.status}`, r.status >= 400 && /daily/i.test(r.body?.error ?? ""));
});
test("LLM-3", "Gemini 500 internal error", async () => {
  await fake.set({ faults: { gemini: [{ status: 500, message: "An internal error has occurred" }] } });
  const r = await extract(await cookie(), { front: jpeg() });
  record("LLM-3", "Model answers 500", "treated as temporary: 'busy, retrying', no raw error text", `${r.status} ${short(r.body)}`, r.status === 429 && !looksRaw(r.body?.error));
});
test("LLM-3b", "Gemini 400 (not a key problem)", async () => {
  await fake.set({ faults: { gemini: [{ status: 400, message: "Request contains an invalid argument." }] } });
  const r = await extract(await cookie(), { front: jpeg() });
  record("LLM-3b", "Model answers 400", "clear error, no raw error text", `${r.status} ${short(r.body)}`, r.status >= 400 && !looksRaw(r.body?.error) && /Retry/.test(r.body?.error ?? ""));
});
test("LLM-4", "Model returns text that is not JSON", async () => {
  await fake.set({ faults: { gemini: [{ text: "Sure! Here is the card: Alex Lee" }] } });
  const r = await extract(await cookie(), { front: jpeg() });
  record("LLM-4", "Model returns non-JSON text", "clear error", `${r.status} ${short(r.body)}`, r.status >= 400 && /valid JSON/.test(r.body?.error ?? ""));
});
test("LLM-5", "Model returns empty text", async () => {
  await fake.set({ faults: { gemini: [{ text: "" }] } });
  const r = await extract(await cookie(), { front: jpeg() });
  record("LLM-5", "Model returns empty answer", "clear error", `${r.status} ${short(r.body)}`, r.status >= 400 && !looksRaw(r.body?.error));
});
test("LLM-6", "Model returns a JSON array", async () => {
  await fake.set({ faults: { gemini: [{ text: "[1,2]" }] } });
  const r = await extract(await cookie(), { front: jpeg() });
  record("LLM-6", "Model returns JSON of the wrong shape", "clear error", `${r.status} ${short(r.body)}`, r.status >= 400 && !looksRaw(r.body?.error));
});
test("LLM-7", "Model answer has no candidates (safety block)", async () => {
  await fake.set({ faults: { gemini: [{ raw: { promptFeedback: { blockReason: "SAFETY" } } }] } });
  const r = await extract(await cookie(), { front: jpeg() });
  record("LLM-7", "Model blocks the answer (no candidates)", "clear error", `${r.status} ${short(r.body)}`, r.status >= 400 && !looksRaw(r.body?.error));
});
test("LLM-8", "Chinese name returned twice", async () => {
  const card = JSON.stringify({ ...JSON.parse('{"salutation":"","first_name":"小明","last_name":"王","job_title":"","company":"","email":"","mobile":"","website":"","address":"","linkedin":"","other":"","low_confidence":[]}') });
  await fake.set({ faults: { gemini: [{ text: card }, { text: card }] } });
  const r = await extract(await cookie(), { front: jpeg() });
  const flagged = r.body?.extraction?.low_confidence?.includes("first_name");
  record("LLM-8", "Name stays in Chinese characters after re-ask", "name flagged 'Check'", `${r.status} flagged=${flagged}`, r.status === 200 && flagged);
});
test("LLM-9", "Model answers 404 for the main model (retired)", async () => {
  await fake.set({ faults: { gemini: [{ status: 404, message: "models/x is not found" }] } });
  const r = await extract(await cookie(), { front: jpeg() });
  const calls = (await fake.state()).log.filter((l) => l.startsWith("gemini"));
  record("LLM-9", "Main model retired (404)", "falls back to the next model", `${r.status}; calls: ${short(calls)}`, r.status === 200);
});

// ---------- Save: inputs ----------
test("IN-1", "Malformed contact JSON", async () => {
  const r = await save(await cookie(), { raw: "{not json" });
  record("IN-1", "Save with malformed contact JSON", "400", `${r.status} ${short(r.body)}`, r.status === 400);
});
test("IN-2", "Contact without the salutation field (draft from an older version)", async () => {
  const c = emptyContact({ first_name: "Old" });
  delete c.salutation;
  const r = await save(await cookie(), { contact: c });
  record("IN-2", "Draft saved before 'salutation' existed", "saved (missing field = empty)", `${r.status} ${short(r.body)}`, r.status === 200);
});
test("IN-3", "1 MB of notes", async () => {
  const r = await save(await cookie(), { contact: emptyContact({ first_name: "Long", notes: "x".repeat(1024 * 1024) }) });
  record("IN-3", "1 MB in notes", "400 naming the field that is too long", `${r.status} ${short(r.body)}`, r.status === 400 && /notes/i.test(r.body?.error ?? ""));
});
test("IN-4", "Unicode, emoji, RTL, zero-width round-trip", async () => {
  const c = await cookie();
  const values = { first_name: "Zoë 👩‍💻", last_name: "محمد", company: "株式会社さくら", notes: "a​b ‮evil‬ ok", job_title: "Ведущий инженер" };
  const r = await save(c, { contact: emptyContact(values) });
  const got = (await contacts(c)).body.contacts.find((x) => x.id === r.id);
  const same = Object.entries(values).every(([k, v]) => got?.[k] === v);
  record("IN-4", "Unicode / emoji / RTL / zero-width text", "stored and read back unchanged", same ? "identical" : short(got), same);
});
test("IN-5", "Formula and script strings", async () => {
  const c = await cookie();
  const values = { first_name: "=HYPERLINK(\"http://evil\",\"x\")", company: "<img src=x onerror=alert(1)>", notes: "'; DROP TABLE contacts; --", email: "@SUM(A1)" };
  const r = await save(c, { contact: emptyContact(values) });
  const got = (await contacts(c)).body.contacts.find((x) => x.id === r.id);
  const same = Object.entries(values).every(([k, v]) => got?.[k] === v);
  record("IN-5", "Formula / HTML / SQL strings in fields", "stored as plain text", same ? "identical, RAW" : short(got), same);
});
test("IN-6", "Whitespace-only / empty contact", async () => {
  const r = await save(await cookie(), { contact: emptyContact({ first_name: "   ", company: "\t" }) });
  record("IN-6", "Approve a card with every field empty", "rejected or at least warned", `${r.status} ${short(r.body)} (row saved: ${(await dataRows()).length})`, r.status === 400);
});
test("IN-7", "Invalid ids", async () => {
  const c = await cookie();
  const a = await save(c, { id: "../../etc" });
  const b = await save(c, { id: "x".repeat(65) });
  record("IN-7", "Invalid card id (path, too long)", "400", `${a.status}, ${b.status}`, a.status === 400 && b.status === 400);
});
test("IN-8", "PATCH with a body that is not JSON", async () => {
  const c = await cookie();
  const [id] = await seed(c, ["A"]);
  const r = await patch(c, id, null, "status=Closed");
  record("IN-8", "PATCH with a non-JSON body", "400", `${r.status} ${short(r.body)}`, r.status === 400);
});
test("IN-9", "PATCH with an unknown status", async () => {
  const c = await cookie();
  const [id] = await seed(c, ["A"]);
  const r = await patch(c, id, { status: "Done" });
  record("IN-9", "PATCH status 'Done' (not in list)", "400", `${r.status} ${short(r.body)}`, r.status === 400);
});
test("IN-10", "PATCH an id that does not exist", async () => {
  const r = await patch(await cookie(), "nope-1234", { notes: "x" });
  record("IN-10", "PATCH unknown id", "404", `${r.status} ${short(r.body)}`, r.status === 404);
});

// ---------- Timing ----------
test("TM-1", "Two identical saves at the same time", async () => {
  const c = await cookie();
  await seed(c, ["warm-up"]);
  await fake.set({ faults: { appendDelayMs: 1500 } });
  const id = crypto.randomUUID();
  const [a, b] = await Promise.all([save(c, { id }), save(c, { id })]);
  await fake.set({ faults: { appendDelayMs: 0 } });
  const n = (await dataRows()).filter((r) => r[0] === id).length;
  record("TM-1", "Double submit: same card saved twice at once", "1 row", `${a.status}/${b.status}, rows with that id: ${n}`, n === 1);
});
test("TM-2", "Retry after a successful save", async () => {
  const c = await cookie();
  const id = crypto.randomUUID();
  await save(c, { id });
  const again = await save(c, { id });
  const n = (await dataRows()).filter((r) => r[0] === id).length;
  record("TM-2", "Save retried after success", "alreadySaved, 1 row", `${short(again.body)}, rows: ${n}`, n === 1 && again.body?.alreadySaved);
});
test("TM-3", "Two different cards merged into one contact at once", async () => {
  const c = await cookie();
  const [target] = await seed(c, ["Target"]);
  await fake.set({ faults: { sheetsDelayMs: 300 } });
  const [a, b] = await Promise.all([
    save(c, { mergeInto: target, contact: emptyContact({ first_name: "Target", notes: "note from card A" }) }),
    save(c, { mergeInto: target, contact: emptyContact({ first_name: "Target", notes: "note from card B" }) }),
  ]);
  await fake.set({ faults: { sheetsDelayMs: 0 } });
  const got = (await contacts(c)).body.contacts.find((x) => x.id === target);
  const both = got.notes.includes("card A") && got.notes.includes("card B") && got.image_file_ids.split(",").length === 3;
  record("TM-3", "Two merges into the same contact at once", "both notes and all 3 photos kept",
    `${a.status}/${b.status}; notes="${got.notes}"; photo ids=${got.image_file_ids}`, both);
});
test("TM-4", "Concurrent PATCH of different fields", async () => {
  const c = await cookie();
  const [id] = await seed(c, ["A"]);
  await Promise.all([patch(c, id, { status: "Contacted" }), patch(c, id, { notes: "met at booth" })]);
  const got = (await contacts(c)).body.contacts.find((x) => x.id === id);
  record("TM-4", "Two edits of different fields at once", "both kept", `${got.status} / ${got.notes}`, got.status === "Contacted" && got.notes === "met at booth");
});
test("TM-5", "Delete one contact while another is being edited", async () => {
  const c = await cookie();
  const [a, b, cc] = await seed(c, ["A", "B", "C"]);
  await fake.set({ faults: { sheetsDelayMs: 250 } });
  await Promise.all([patch(c, b, { notes: "edit for B" }), new Promise((r) => setTimeout(r, 700)).then(() => del(c, a))]);
  await fake.set({ faults: { sheetsDelayMs: 0 } });
  const list = (await contacts(c)).body.contacts;
  const B = list.find((x) => x.id === b), C = list.find((x) => x.id === cc);
  record("TM-5", "Edit B while A (above it) is deleted", "B edited, C untouched", `B.notes="${B?.notes}" C.notes="${C?.notes}"`, B?.notes === "edit for B" && C?.notes === "");
});
test("TM-7", "Delete lands between an edit's check and its write", async () => {
  const c = await cookie();
  const [a, b, cc] = await seed(c, ["A", "B", "C"]);
  await fake.set({ faults: { sheetsDelayMs: 250 } });
  // Both requests make the same Sheets calls; starting the delete 100ms earlier makes its row
  // removal land after the edit has checked its row number but before the edit is written.
  await Promise.all([del(c, a), new Promise((r) => setTimeout(r, 100)).then(() => patch(c, b, { notes: "edit for B" }))]);
  await fake.set({ faults: { sheetsDelayMs: 0 } });
  const list = (await contacts(c)).body.contacts;
  const B = list.find((x) => x.id === b), C = list.find((x) => x.id === cc);
  record("TM-7", "Edit B while A (above it) is deleted, tight timing", "B edited, C untouched", `B.notes="${B?.notes}" C.notes="${C?.notes}"`, B?.notes === "edit for B" && C?.notes === "");
});
test("TM-6", "Same contact deleted twice at once", async () => {
  const c = await cookie();
  const [a] = await seed(c, ["A", "B", "C"]);
  await fake.set({ faults: { sheetsDelayMs: 200 } });
  const [r1, r2] = await Promise.all([del(c, a), del(c, a)]);
  await fake.set({ faults: { sheetsDelayMs: 0 } });
  const left = (await contacts(c)).body.contacts.map((x) => x.first_name);
  record("TM-6", "Double delete of the same contact", "A gone, B and C kept", `${r1.status}/${r2.status}; left: ${left.join(",")}`, left.includes("B") && left.includes("C"));
});

// ---------- Google services ----------
test("NET-1", "Drive upload refused (403)", async () => {
  await fake.set({ faults: { uploadStatus: 403, uploadCount: 1 } });
  const r = await save(await cookie());
  record("NET-1", "Drive upload 403", "clear message, no row", `${r.status} ${short(r.body)}; rows: ${(await dataRows()).length}`, r.status >= 400 && (await dataRows()).length === 0);
});
test("NET-2", "Drive upload 500", async () => {
  await fake.set({ faults: { uploadStatus: 500, uploadCount: 1 } });
  const r = await save(await cookie());
  record("NET-2", "Drive upload 500", "clear message, no row", `${r.status} ${short(r.body)}`, r.status >= 400 && !looksRaw(r.body?.error) && (await dataRows()).length === 0);
});
test("NET-3", "Sheet append fails (500)", async () => {
  const c = await cookie();
  await seed(c, ["warm-up"]);
  await fake.set({ faults: { appendStatus: 500, appendCount: 1 } });
  const r = await save(c);
  const st = await fake.state();
  record("NET-3", "Sheet append 500", "error, no row, uploaded photo removed", `${r.status} ${short(r.body)}; drive files: ${st.files.length}`,
    r.status >= 400 && st.files.length === 1 /* only the warm-up photo */ && !looksRaw(r.body?.error));
});
test("NET-4", "Append written but reply lost", async () => {
  const c = await cookie();
  await seed(c, ["warm-up"]);
  await fake.set({ faults: { appendWriteThenFail: 1 } });
  const r = await save(c);
  const n = (await dataRows()).filter((x) => x[0] === r.id).length;
  record("NET-4", "Row written but Google's reply lost", "reported saved, 1 row, photo kept", `${r.status}; rows: ${n}; files: ${(await fake.state()).files.length}`, r.status === 200 && n === 1);
});
test("NET-5", "Sheets 429 twice during save", async () => {
  const c = await cookie();
  await seed(c, ["warm-up"]);
  await fake.set({ faults: { appendStatus: 429, appendCount: 2 } });
  const t = Date.now();
  const r = await save(c);
  record("NET-5", "Sheets rate limit (429 x2) while saving", "saved after waiting", `${r.status} after ${Math.round((Date.now() - t) / 1000)}s`, r.status === 200);
});
test("NET-6", "Sheets down for a long time on list", async () => {
  const c = await cookie();
  await seed(c, ["warm-up"]);
  await fake.set({ faults: { sheetsGetStatus: 503, sheetsGetCount: 20 } });
  const t = Date.now();
  const r = await contacts(c);
  await fake.set({ faults: { sheetsGetCount: 0 } });
  const s = Math.round((Date.now() - t) / 1000);
  record("NET-6", "Sheets 503 on every call (list contacts)", "clear error before the phone's 30s timeout",
    `${r.status} ${short(r.body)} after ${s}s`, r.status >= 500 && s < 30 && /isn't responding/.test(r.body?.error ?? ""));
});
test("NET-7", "Sheet not shared with the service account", async () => {
  await fake.set({ faults: { metaStatus: 403, metaCount: 1 } });
  const r = await contacts(await cookie());
  record("NET-7", "Sheet not shared (403)", "message telling who to share with", `${r.status} ${short(r.body)}`, /Share the Sheet/.test(r.body?.error ?? ""));
});
test("NET-8", "Google token expired and refresh revoked", async () => {
  const c = await cookie(undefined, { googleExpiresAt: 1, googleRefreshToken: `revoked-${Date.now()}` });
  await fake.set({ faults: { refreshStatus: 400 } });
  const r = await save(c);
  const list = await contacts(c);
  await fake.set({ faults: { refreshStatus: null } });
  record("NET-8", "Token expired, refresh revoked: save", "clear 'sign in again', no row; list still works",
    `save ${r.status} ${short(r.body)}; list ${list.status}; rows ${(await dataRows()).length}`, r.status >= 400 && /sign in again/i.test(r.body?.error ?? "") && list.status === 200);
});
test("NET-9", "Google token expired, refresh works", async () => {
  const r = await save(await cookie(undefined, { googleExpiresAt: 1 }));
  record("NET-9", "Token expired, refresh OK", "saved", `${r.status}`, r.status === 200);
});
test("NET-10", "Drive delete fails during contact delete", async () => {
  const c = await cookie();
  const [id] = await seed(c, ["A"]);
  await fake.set({ faults: { driveDeleteStatus: 500 } });
  const r = await del(c, id);
  await fake.set({ faults: { driveDeleteStatus: null } });
  record("NET-10", "Drive delete 500 while deleting a contact", "row deleted, photos reported as not deleted", `${r.status} ${short(r.body)}`, r.status === 200 && r.body.imagesNotDeleted.length === 1);
});
test("NET-11", "Delete with expired, unrefreshable token", async () => {
  const c = await cookie();
  const [id] = await seed(c, ["A"]);
  await fake.set({ faults: { refreshStatus: 400 } });
  // A refresh token the server has not cached a fresh access token for.
  const r = await del(await cookie(undefined, { googleExpiresAt: 1, googleRefreshToken: `revoked-${Date.now()}` }), id);
  await fake.set({ faults: { refreshStatus: null } });
  const still = (await contacts(c)).body.contacts.some((x) => x.id === id);
  record("NET-11", "Delete when Drive access expired", "nothing deleted, 'sign in again'", `${r.status} ${short(r.body)}; row still there: ${still}`, r.status === 401 && still);
});

// ---------- Sheet state (things people do to the Sheet; done through the fake so metadata moves as in Google) ----------
const names = async (c) => (await contacts(c)).body?.contacts?.map((x) => x.first_name).sort().join(",");
test("ST-1", "Empty spreadsheet (no Contacts tab)", async () => {
  const r = await save(await cookie());
  const st = await fake.state();
  record("ST-1", "Brand-new spreadsheet without the tab", "tab created, saved", `${r.status}; tabs: ${st.tabs.map((t) => t.title)}`, r.status === 200 && st.tabs.some((t) => t.title === "Contacts"));
});
test("ST-2", "Tab renamed by a person", async () => {
  const c = await cookie();
  await seed(c, ["A", "B"]);
  await fake.op("renameTab", "Contacts", "CRM 2026");
  const shown = await names(c);
  const s = await save(c, { contact: emptyContact({ first_name: "C" }) });
  const st = await fake.state();
  const crm = st.tabs.find((t) => t.title === "CRM 2026").rows.slice(1).filter((r) => r.some(Boolean)).length;
  record("ST-2", "Someone renames the 'Contacts' tab", "contacts still shown, new saves go to the renamed tab",
    `shown before save: ${shown}; save ${s.status}; tabs: ${st.tabs.map((t) => t.title).join(", ")}; rows in 'CRM 2026': ${crm}`,
    shown === "A,B" && s.status === 200 && crm === 3 && !st.tabs.some((t) => t.title === "Contacts"));
});
test("ST-2b", "Tab deleted after the app set it up", async () => {
  const c = await cookie();
  await seed(c, ["A"]);
  await fake.op("deleteTab", "Contacts");
  const r = await contacts(c);
  const st = await fake.state();
  record("ST-2b", "Someone deletes the 'Contacts' tab", "clear error, no silent new tab",
    `${r.status} ${short(r.body)}; tabs: ${st.tabs.map((t) => t.title).join(", ")}`, r.status >= 400 && /tab/i.test(r.body?.error ?? "") && !st.tabs.some((t) => t.title === "Contacts"));
});
test("ST-3", "Title row inserted above the headers", async () => {
  const c = await cookie();
  await seed(c, ["Alice", "Bob"]);
  await fake.op("insertRows", "Contacts", 0, 2, [["Kinara contacts 2026"], []]);
  const shown = await names(c);
  const s = await save(c, { contact: emptyContact({ first_name: "Cara" }) });
  const after = await names(c);
  const r = (await fake.state()).tabs.find((t) => t.title === "Contacts").rows;
  record("ST-3", "Someone adds a title row (and a blank row) above the header row", "contacts still shown, title kept, new row under the headers",
    `shown: ${shown}; after a save: ${after}; row 1: ${short(r[0])}; row 3 starts: ${short(r[2].slice(0, 2))}`,
    shown === "Alice,Bob" && s.status === 200 && after === "Alice,Bob,Cara" && r[0].join() === "Kinara contacts 2026" && r[2][0] === "id");
});
test("ST-4", "Header renamed to an unknown name", async () => {
  const c = await cookie();
  await save(c, { contact: emptyContact({ first_name: "A", company: "Acme" }) });
  const h = (await rows())[0];
  await fake.op("setCell", "Contacts", 0, h.indexOf("company"), "Organisation");
  await fake.op("setCell", "Contacts", 0, h.indexOf("first_name"), "Given name");
  const got = (await contacts(c)).body?.contacts?.[0];
  await save(c, { contact: emptyContact({ first_name: "B", company: "Beta" }) });
  const after = (await rows())[0];
  const companies = (await contacts(c)).body.contacts.map((x) => x.company).sort().join(",");
  record("ST-4", "Headers renamed to 'Organisation' / 'Given name'", "data still shown, no extra columns",
    `shown: ${got?.first_name} / ${got?.company}; companies after a save: ${companies}; header columns ${h.length} -> ${after.length}`,
    got?.company === "Acme" && got?.first_name === "A" && companies === "Acme,Beta" && after.length === h.length);
});
test("ST-5", "Columns moved", async () => {
  const c = await cookie();
  await seed(c, ["Alice"]);
  const h = (await rows())[0];
  await fake.op("moveColumn", "Contacts", h.indexOf("first_name"), 0);
  await fake.op("moveColumn", "Contacts", h.indexOf("status"), 25);
  const id = (await contacts(c)).body.contacts[0].id;
  await patch(c, id, { status: "Closed" });
  const got = (await contacts(c)).body.contacts[0];
  record("ST-5", "Columns moved by hand", "same data, edits land in the right column", `${got.first_name} / ${got.status}`, got.first_name === "Alice" && got.status === "Closed");
});
test("ST-6", "Row copied (duplicate id)", async () => {
  const c = await cookie();
  const [id] = await seed(c, ["Alice"]);
  const r = await rows();
  await fake.op("insertRows", "Contacts", 2, 1, [[...(await fake.state()).tabs.find((t) => t.title === "Contacts").rows[1]]]);
  const shown = await contacts(c);
  const d = await del(c, id);
  const left = (await contacts(c)).body.contacts.filter((x) => x.id === id).length;
  record("ST-6", "A row copied in the Sheet (same id twice)", "app copes (shows both, delete removes one)",
    `${shown.body.contacts.length} shown (${r.length} rows before); delete ${d.status}; rows left with id: ${left}`, shown.status === 200 && d.status === 200);
});
test("ST-7", "Blank rows between contacts", async () => {
  const c = await cookie();
  const [, b] = await seed(c, ["A", "B"]);
  await fake.op("insertRows", "Contacts", 2, 2);
  const p = await patch(c, b, { notes: "after blank rows" });
  const s = await save(c, { contact: emptyContact({ first_name: "C" }) });
  const r = (await fake.state()).tabs.find((t) => t.title === "Contacts").rows;
  const got = (await contacts(c)).body.contacts.find((x) => x.id === b);
  record("ST-7", "Blank rows inserted between contacts", "edit lands on the right row, new contact added at the bottom",
    `${p.status}; B.notes="${got.notes}"; save ${s.status}; last row is C: ${r[r.length - 1][r[0].indexOf("first_name")] === "C"}`,
    got.notes === "after blank rows" && r[r.length - 1][r[0].indexOf("first_name")] === "C");
});
test("ST-8", "Contact deleted in the Sheet, then edited in the app", async () => {
  const c = await cookie();
  const [a] = await seed(c, ["A"]);
  await fake.op("deleteRows", "Contacts", 1, 1);
  const p = await patch(c, a, { status: "Closed" });
  record("ST-8", "Edit a contact someone just deleted in the Sheet", "404 'not found'", `${p.status} ${short(p.body)}`, p.status === 404);
});
test("ST-9", "1000 contacts", async () => {
  const c = await cookie();
  await seed(c, ["warm-up"]);
  const h = (await rows())[0];
  const bulk = [...Array(1000).keys()].map((i) => h.map((k) => (k === "id" ? `bulk-${i}` : k === "first_name" ? `Person ${i}` : k === "status" ? "To contact" : "")));
  await fake.op("insertRows", "Contacts", 2, 1000, bulk);
  let t = Date.now();
  const r = await contacts(c);
  const listMs = Date.now() - t;
  t = Date.now();
  await patch(c, "bulk-999", { status: "Closed" });
  const patchMs = Date.now() - t;
  record("ST-9", "1000 contacts in the Sheet", "list and edit stay fast", `${r.body.contacts.length} listed in ${listMs}ms, edit ${patchMs}ms`, r.body.contacts.length === 1001);
});

// ---------- Configuration ----------
test("ENV-1", "SHEET_ID missing", async () => {
  const env = { ...process.env, PORT: "3102", FAKE_CONTROL_PORT: "3198", AUTH_TRUST_HOST: "true", AUTH_SECRET: "localtestsecret", AUTH_GOOGLE_ID: "x", AUTH_GOOGLE_SECRET: "y", ALLOWED_EMAILS: "tester@example.com", GEMINI_API_KEY: "fake", DRIVE_FOLDER_ID: "f", GOOGLE_SERVICE_ACCOUNT_JSON: "{}", NODE_OPTIONS: "--import ./tests/adversarial/fake-google.mjs" };
  delete env.SHEET_ID;
  const p = spawn("node", ["node_modules/next/dist/bin/next", "start"], { env, stdio: "ignore", cwd: new URL("../..", import.meta.url).pathname });
  try {
    for (let i = 0; i < 30; i++) { if (await fetch("http://localhost:3102/signin").then(() => true, () => false)) break; await new Promise((r) => setTimeout(r, 500)); }
    const res = await fetch("http://localhost:3102/api/contacts", { headers: { cookie: await cookie() } });
    const body = await res.json().catch(() => null);
    const health = await fetch("http://localhost:3102/api/health").then((x) => x.json());
    record("ENV-1", "SHEET_ID not set", "clear message naming the variable", `${res.status} ${short(body)}; /api/health ok=${health.ok}`, /SHEET_ID/.test(body?.error ?? ""));
  } finally {
    p.kill();
  }
});

// LLM-2 marks every model as used up for an hour (as in production), so it runs last.
tests.push(...tests.splice(tests.findIndex((t) => t.id === "LLM-2"), 1));
for (const t of tests) {
  if (only && t.id !== only) continue;
  await fake.reset();
  try {
    await t.fn();
  } catch (err) {
    record(t.id, t.name, "test ran", `TEST ERROR: ${err.stack?.split("\n").slice(0, 2).join(" ")}`, false);
  }
}
writeFileSync(new URL(`./results-api${only ? "-" + only : ""}.json`, import.meta.url), JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
