import type { ContactInput, ContactRow } from "@/lib/fields";
import { fetchWithTimeout } from "./fetch";

// Contacts from the Sheet, cached briefly so moving between screens stays fast.
let cache: { at: number; promise: Promise<ContactRow[]> } | null = null;
const MAX_AGE = 60_000;

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return body.error ?? `Error ${res.status}`;
}

export function fetchContacts(force = false): Promise<ContactRow[]> {
  if (!force && cache && Date.now() - cache.at < MAX_AGE) return cache.promise;
  const promise = fetchWithTimeout("/api/contacts", {}, 30_000).then(async (res) => {
    if (!res.ok) throw new Error(await readError(res));
    return ((await res.json()) as { contacts: ContactRow[] }).contacts;
  });
  cache = { at: Date.now(), promise };
  promise.catch(() => (cache = null));
  return promise;
}

export function invalidateContacts() {
  cache = null;
}

export async function patchContact(id: string, patch: Partial<ContactInput>): Promise<ContactRow> {
  const res = await fetchWithTimeout(`/api/contacts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }, 30_000);
  if (!res.ok) throw new Error(await readError(res));
  invalidateContacts();
  return ((await res.json()) as { contact: ContactRow }).contact;
}

export async function deleteContact(id: string): Promise<{ imagesNotDeleted: string[] }> {
  const res = await fetchWithTimeout(`/api/contacts/${encodeURIComponent(id)}`, { method: "DELETE" }, 30_000);
  if (!res.ok) throw new Error(await readError(res));
  invalidateContacts();
  return res.json();
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(pte|ltd|limited|inc|llc|co|corp|corporation|sdn|bhd|gmbh|kk|plc)\b\.?/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");

// Same email, or same name (either order) at the same company.
export function findDuplicates(c: Pick<ContactInput, "email" | "first_name" | "last_name" | "company">, all: ContactRow[]) {
  const email = c.email.trim().toLowerCase();
  const name = norm(c.first_name + c.last_name);
  const nameReversed = norm(c.last_name + c.first_name);
  const company = norm(c.company);
  return all.filter((r) => {
    if (email && r.email.trim().toLowerCase() === email) return true;
    if (!name || !company) return false;
    const rName = norm(r.first_name + r.last_name);
    return (rName === name || rName === nameReversed) && norm(r.company) === company;
  });
}

export const displayName = (c: Pick<ContactRow, "first_name" | "last_name">) =>
  [c.first_name, c.last_name].filter(Boolean).join(" ");
