// Helpers for the adversarial tests: a forged session cookie, the fake backend's controls, results.
import { createRequire } from "node:module";
const req = createRequire(new URL("../../package.json", import.meta.url));
const { encode } = await import(req.resolve("next-auth/jwt"));

export const BASE = "http://localhost:3100";
export const CONTROL = "http://127.0.0.1:3199";

export async function cookie(email = "tester@example.com", extra = {}) {
  const token = await encode({
    secret: "localtestsecret",
    salt: "authjs.session-token",
    token: {
      name: "Tester", email, sub: "1",
      googleAccessToken: "user-token", googleRefreshToken: "refresh-1",
      googleExpiresAt: Math.floor(Date.now() / 1000) + 3600, ...extra,
    },
  });
  return `authjs.session-token=${token}`;
}

export const fake = {
  reset: () => fetch(`${CONTROL}/reset`, { method: "POST" }),
  set: (v) => fetch(`${CONTROL}/set`, { method: "POST", body: JSON.stringify(v) }),
  state: () => fetch(`${CONTROL}/state`).then((r) => r.json()),
};

// A small valid JPEG (1x1 px).
export const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

export const results = [];
export function record(id, scenario, expected, actual, pass, severity = "") {
  results.push({ id, scenario, expected, actual, pass, severity });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} ${scenario}\n      expected: ${expected}\n      actual:   ${actual}`);
}

export const emptyContact = (o = {}) => ({
  salutation: "", first_name: "", last_name: "", job_title: "", company: "", email: "", mobile: "", website: "",
  address: "", linkedin: "", other: "", event: "", date_met: "", notes: "", status: "To contact", owner: "",
  next_action: "", next_action_date: "", ...o,
});

export async function save(c, { id = crypto.randomUUID(), contact = emptyContact({ first_name: "Test" }), front = JPEG, mergeInto, raw } = {}) {
  const form = new FormData();
  form.append("id", id);
  form.append("contact", raw ?? JSON.stringify(contact));
  if (mergeInto) form.append("mergeInto", mergeInto);
  if (front) form.append("front", new Blob([front], { type: "image/jpeg" }), "front.jpg");
  const res = await fetch(`${BASE}/api/contacts`, { method: "POST", body: form, headers: { cookie: c } });
  return { status: res.status, body: await res.json().catch(() => null), id };
}

export async function extract(c, parts) {
  const form = new FormData();
  for (const [k, v] of Object.entries(parts)) form.append(k, v);
  const res = await fetch(`${BASE}/api/extract`, { method: "POST", body: form, headers: { cookie: c } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export const contacts = async (c) => {
  const res = await fetch(`${BASE}/api/contacts`, { headers: { cookie: c } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
