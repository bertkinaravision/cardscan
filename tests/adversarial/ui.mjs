// Adversarial browser tests (Playwright) against the app on the fake backend.
// Run: node tests/adversarial/ui.mjs [filter]      Writes results to tests/adversarial/results-ui.json
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { BASE, contacts as listContacts, cookie, emptyContact, fake, record, results, save } from "./lib.mjs";

const { chromium } = createRequire("/opt/node22/lib/node_modules/")("playwright");
const FIX = new URL("./fixtures/", import.meta.url).pathname;
const only = process.argv[2];
const browser = await chromium.launch();
const tests = [];
const test = (id, name, fn) => tests.push({ id, name, fn });
const rows = async () => ((await fake.state()).tabs.find((t) => t.title === "Contacts")?.rows ?? []).slice(1).filter((r) => r.some(Boolean));

async function open(width = 390, init) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  const [name, value] = (await cookie()).split("=");
  await ctx.addCookies([{ name, value, url: BASE }]);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  page.on("dialog", (d) => { page.dialogs = [...(page.dialogs ?? []), d.message()]; d.accept(); });
  return { ctx, page };
}
// Adds one card from a file and waits until it is ready to review.
async function addCard(page, file = "card.jpg") {
  await page.goto(`${BASE}/`);
  await page.locator("input[type=file]").nth(2).setInputFiles(FIX + file);
  await page.getByRole("button", { name: "Add card to queue" }).click();
}
async function openReview(page) {
  await page.getByText(/^Review 1 card/).click({ timeout: 20000 });
  await page.getByRole("button", { name: /Approve & save/ }).waitFor();
}

test("UI-1", "Double tap on Approve", async () => {
  const { ctx, page } = await open();
  let posts = 0;
  page.on("request", (r) => r.method() === "POST" && r.url().endsWith("/api/contacts") && posts++);
  await addCard(page);
  await openReview(page);
  await page.getByRole("button", { name: /Approve & save/ }).dblclick();
  await page.waitForURL(`${BASE}/`, { timeout: 15000 });
  record("UI-1", "Double tap on Approve", "1 save request, 1 row", `${posts} requests, ${(await rows()).length} rows`, posts === 1 && (await rows()).length === 1);
  await ctx.close();
});

test("UI-2", "Connection drops after the save reached the server, person taps Approve again", async () => {
  const { ctx, page } = await open();
  await fake.set({ faults: { appendDelayMs: 4000 } });
  let first = true;
  await page.route("**/api/contacts", async (route) => {
    const req = route.request();
    if (req.method() !== "POST" || !first) return route.continue();
    first = false;
    // The request reaches the server…
    fetch(req.url(), { method: "POST", headers: { ...(await req.allHeaders()) }, body: req.postDataBuffer() }).catch(() => {});
    // …but the phone loses the answer.
    await new Promise((r) => setTimeout(r, 500));
    await route.abort("connectionreset");
  });
  await addCard(page);
  await openReview(page);
  await page.getByRole("button", { name: /Approve & save/ }).click();
  const msg = await page.getByText(/No connection|try again/i).first().textContent({ timeout: 10000 });
  await page.getByRole("button", { name: /Approve & save/ }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 4500));
  await fake.set({ faults: { appendDelayMs: 0 } });
  const n = (await rows()).length;
  record("UI-2", "Answer lost on bad Wi-Fi, Approve tapped again", "1 row", `message "${msg}"; rows in Sheet: ${n}`, n === 1);
  await ctx.close();
});

test("UI-3", "Approve while offline", async () => {
  const { ctx, page } = await open();
  await addCard(page);
  await openReview(page);
  await ctx.setOffline(true);
  await page.getByRole("button", { name: /Approve & save/ }).click();
  const msg = await page.getByText(/No connection/).first().textContent({ timeout: 10000 }).catch(() => "(none)");
  await ctx.setOffline(false);
  await page.getByRole("button", { name: /Approve & save/ }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 15000 });
  record("UI-3", "Approve with no signal, then again online", "clear message, then 1 row", `"${msg}", rows ${(await rows()).length}`, /No connection/.test(msg) && (await rows()).length === 1);
  await ctx.close();
});

test("UI-4", "Wi-Fi login page answers the extract call", async () => {
  const { ctx, page } = await open();
  await page.route("**/api/extract", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<html><body>Please log in to Venue WiFi</body></html>" }));
  await addCard(page);
  const msg = await page.getByText(/Could not read the result/).textContent({ timeout: 15000 }).catch(() => "(no message)");
  const review = await page.getByText(/^Review 1 card/).count();
  record("UI-4", "Captive portal page instead of the extract answer", "card marked failed with a message", `"${msg}"; offered for review: ${review > 0}`, /Could not read/.test(msg) && review === 0);
  await ctx.close();
});

test("UI-5", "Scanning with no signal", async () => {
  const { ctx, page } = await open();
  await page.goto(`${BASE}/`);
  await ctx.setOffline(true);
  await page.locator("input[type=file]").nth(2).setInputFiles(FIX + "card.jpg");
  await page.getByRole("button", { name: "Add card to queue" }).click();
  const msg = await page.getByText(/No connection. Will retry/).textContent({ timeout: 10000 }).catch(() => "(none)");
  await ctx.setOffline(false);
  const ok = await page.getByText(/^Review 1 card/).waitFor({ timeout: 25000 }).then(() => true, () => false);
  record("UI-5", "Card added offline, signal comes back", "queued, then read automatically", `"${msg}"; ready to review after reconnect: ${ok}`, ok);
  await ctx.close();
});

test("UI-6", "File that is not an image", async () => {
  const { ctx, page } = await open();
  await page.goto(`${BASE}/`);
  await page.locator("input[type=file]").nth(2).setInputFiles(FIX + "not-an-image.jpg");
  const msg = await page.getByText(/Could not read that photo/).textContent({ timeout: 10000 }).catch(() => "(none)");
  record("UI-6", "Pick a file that is not an image", "clear message", `"${msg}"`, /Could not read/.test(msg));
  await ctx.close();
});

test("UI-7", "Import many with one broken file", async () => {
  const { ctx, page } = await open();
  await page.goto(`${BASE}/`);
  await page.locator("input[type=file][multiple]").setInputFiles([FIX + "card.jpg", FIX + "not-an-image.jpg", FIX + "card.jpg"]);
  await page.getByText("Import many photos (one card each)").waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);
  const text = await page.locator("main, body").innerText();
  const added = (text.match(/Queued|Processing|Ready to review/g) ?? []).length;
  const msg = (text.match(/[^\n]*(could not|couldn't|skipped)[^\n]*/i) ?? ["(no message)"])[0];
  record("UI-7", "Import 3 photos, one is broken", "2 cards added, 1 reported", `cards in queue: ${added}; message: "${msg}"`, added === 2 && msg !== "(no message)");
  await ctx.close();
});

test("UI-8", "Small screen (320px)", async () => {
  const { ctx, page } = await open(320);
  await save(await cookie(), { contact: emptyContact({ first_name: "Maximilian-Alexander", last_name: "Wolfeschlegelsteinhausen", company: "Internationale Medizintechnik Vertriebsgesellschaft mbH", email: "maximilian.alexander.wolfeschlegelsteinhausen@internationale-medizintechnik.example" }) });
  const widths = {};
  await addCard(page);
  widths.scan = await page.evaluate(() => document.documentElement.scrollWidth);
  await openReview(page);
  widths.review = await page.evaluate(() => document.documentElement.scrollWidth);
  await page.goto(`${BASE}/contacts`);
  await page.getByText("Maximilian-Alexander", { exact: false }).first().click();
  await page.waitForTimeout(300);
  widths.contacts = await page.evaluate(() => document.documentElement.scrollWidth);
  const ok = Object.values(widths).every((w) => w <= 320);
  record("UI-8", "320px wide phone, very long name/email", "no sideways scrolling", JSON.stringify(widths), ok);
  await ctx.close();
});

test("UI-9", "Browser storage blocked (localStorage throws)", async () => {
  const { ctx, page } = await open(390, () => {
    const boom = () => { throw new DOMException("The operation is insecure.", "SecurityError"); };
    Object.defineProperty(window, "localStorage", { get: boom });
  });
  await addCard(page);
  const ok = await page.getByText(/^Review 1 card/).waitFor({ timeout: 20000 }).then(() => true, () => false);
  record("UI-9", "localStorage blocked", "app still works", `card read: ${ok}; page errors: ${page.errors.join(" | ") || "none"}`, ok && page.errors.length === 0);
  await ctx.close();
});

test("UI-10", "IndexedDB unavailable", async () => {
  const { ctx, page } = await open(390, () => {
    IDBFactory.prototype.open = function () { throw new DOMException("A mutation operation was attempted on a database that did not allow mutations.", "InvalidStateError"); };
  });
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(1000);
  const loaded = await page.getByRole("button", { name: "Add card to queue" }).count();
  let msg = "(none)";
  if (loaded) {
    await page.locator("input[type=file]").nth(2).setInputFiles(FIX + "card.jpg");
    await page.getByRole("button", { name: "Add card to queue" }).click();
    msg = await page.getByText(/Could not store/).textContent({ timeout: 5000 }).catch(() => "(none)");
  }
  record("UI-10", "IndexedDB blocked (private mode / storage disabled)", "clear message that cards can't be stored",
    `scan screen shown: ${loaded > 0}; message: "${msg}"; page errors: ${page.errors.slice(0, 2).join(" | ").slice(0, 200) || "none"}`, loaded > 0 && msg !== "(none)");
  await ctx.close();
});

test("UI-11", "Script and javascript: links in contact data", async () => {
  await save(await cookie(), { contact: emptyContact({ first_name: "<img src=x onerror=alert(1)>", website: "javascript:alert(2)", linkedin: "javascript:alert(3)", email: "x@y.example\"><script>alert(4)</script>" }) });
  const { ctx, page } = await open();
  await page.goto(`${BASE}/contacts`);
  await page.getByText("<img src=x", { exact: false }).first().click();
  await page.waitForTimeout(500);
  const hrefs = await page.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")).filter((h) => /alert/.test(h ?? "")));
  const ok = !(page.dialogs?.length) && hrefs.every((h) => !/^javascript:/i.test(h));
  record("UI-11", "HTML / javascript: links in a contact", "shown as text, links not runnable", `dialogs: ${page.dialogs?.length ?? 0}; hrefs: ${JSON.stringify(hrefs)}`, ok);
  await ctx.close();
});

test("UI-12", "Follow-up edited on stale data", async () => {
  const c = await cookie();
  const { id } = await save(c, { contact: emptyContact({ first_name: "Stale", notes: "original note" }) });
  const { ctx, page } = await open();
  await page.goto(`${BASE}/contacts`);
  await page.getByText("Stale").first().click();
  await page.getByText("Save follow-up").waitFor({ state: "detached" }).catch(() => {});
  // A colleague updates the notes meanwhile; this phone refreshes the list.
  await fetch(`${BASE}/api/contacts/${id}`, { method: "PATCH", headers: { cookie: c, "content-type": "application/json" }, body: JSON.stringify({ notes: "colleague: sent deck on Mon" }) });
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.waitForTimeout(800);
  const shownNotes = await page.getByRole("textbox", { name: "Notes" }).inputValue();
  await page.locator("li input[list=cardscan-owners]").fill("Tester");
  await page.getByRole("button", { name: "Save follow-up" }).click();
  await page.waitForTimeout(1500);
  const saved = (await listContacts(c)).body.contacts.find((x) => x.id === id);
  record("UI-12", "Refresh after a colleague's edit, then save follow-up", "colleague's note kept",
    `notes box showed "${shownNotes}"; Sheet notes now "${saved.notes}"`, saved.notes === "colleague: sent deck on Mon");
  await ctx.close();
});

test("UI-13", "Very long notes on review", async () => {
  const { ctx, page } = await open();
  await addCard(page);
  await openReview(page);
  await page.getByLabel("Notes").fill("long ".repeat(1200));
  await page.getByRole("button", { name: /Approve & save/ }).click();
  const msg = await page.getByText(/^Not saved:/).textContent({ timeout: 10000 }).catch(() => "(none)");
  record("UI-13", "6000 characters in notes", "message saying notes are too long", `"${msg}"`, /notes/i.test(msg) && /long/i.test(msg));
  await ctx.close();
});

test("UI-14", "Model slower than the phone's 50s limit", async () => {
  // Every model call takes 52s: the phone gives up at 50s, re-queues, waits 15s and tries again.
  await fake.set({ faults: { geminiDefault: { delayMs: 52000, text: '{"first_name":"Slow"}' } } });
  const { ctx, page } = await open();
  await addCard(page);
  await page.waitForTimeout(140000);
  const calls = (await fake.state()).log.filter((l) => l.startsWith("gemini")).length;
  const status = (await page.locator("li").first().innerText()).replace(/\s+/g, " ");
  await fake.set({ faults: { geminiDefault: null } });
  record("UI-14", "Model answers after 52s every time", "gives up after a few tries with a message", `after 140s: ${calls} model calls, card shows "${status}"`, /Failed/.test(status));
  await ctx.close();
});

for (const t of tests) {
  if (only && t.id !== only) continue;
  await fake.reset();
  try {
    await t.fn();
  } catch (err) {
    record(t.id, t.name, "test ran", `TEST ERROR: ${String(err.message).split("\n")[0]}`, false);
  }
}
await browser.close();
writeFileSync(new URL(`./results-ui${only ? "-" + only : ""}.json`, import.meta.url), JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
