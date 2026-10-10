import { z } from "zod";

// Fields the vision model extracts from a card. Order is the order shown on the review screen.
export const EXTRACTED_FIELDS = [
  "salutation",
  "first_name",
  "last_name",
  "name_original",
  "job_title",
  "company",
  "email",
  "mobile",
  "website",
  "address",
  "linkedin",
  "other",
] as const;
export type ExtractedField = (typeof EXTRACTED_FIELDS)[number];

export const FIELD_LABELS: Record<string, string> = {
  salutation: "Salutation",
  first_name: "First name",
  last_name: "Last name",
  name_original: "Name (original script)",
  job_title: "Job title",
  company: "Company",
  email: "Email",
  mobile: "Mobile",
  website: "Website",
  address: "Address",
  linkedin: "LinkedIn",
  other: "Other",
  event: "Event / place met",
  date_met: "Date met",
  notes: "Notes",
  status: "Status",
  contact_type: "Contact type",
  owner: "Owner",
  next_action: "Next action",
  next_action_date: "Next action date",
  linkedin_search: "LinkedIn search",
};

export const STATUSES = [
  "New",
  "Contacted",
  "In discussion",
  "Closed",
  "Not relevant",
] as const;
export type Status = (typeof STATUSES)[number];
// Labels used before October 2026; rows still holding them are rewritten when the Sheet is read.
export const RENAMED_STATUSES: Record<string, Status> = { "To contact": "New", "In conversation": "In discussion" };

// Kinds of contact; the model suggests one, the person confirms it on the review screen.
export const CONTACT_TYPES = [
  "Clinician",
  "Distributor",
  "Investor",
  "Regulator",
  "Partner",
  "Vendor",
  "Advisor",
  "Other",
] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

// Choices in the "Next action" dropdown. Anything else can be typed via "Other…".
export const NEXT_ACTIONS = [
  "Send email",
  "Send brochure / deck",
  "Call",
  "Schedule meeting",
  "Arrange demo",
  "Send proposal / quote",
  "Connect on LinkedIn",
  "Introduce to colleague",
  "Follow up later",
] as const;

// Fields a person fills in or edits (on top of the extracted ones).
export const CONTEXT_FIELDS = ["event", "date_met", "notes"] as const;
export const CRM_FIELDS = ["status", "contact_type", "owner", "next_action", "next_action_date"] as const;

// Sheet columns, left to right. The app maps by header name, so adding extra
// columns to the right in the Sheet is safe.
export const SHEET_COLUMNS = [
  "id",
  ...EXTRACTED_FIELDS,
  ...CONTEXT_FIELDS,
  ...CRM_FIELDS,
  // A LinkedIn people search for the name and company, when the card has no LinkedIn URL.
  "linkedin_search",
  "scanned_by",
  "scanned_at",
  "last_updated",
  "image_front_link",
  "image_back_link",
  "image_file_ids",
  // Ids of rescanned cards merged into this contact, so a retried merge is not applied twice.
  "source_card_ids",
] as const;
export type SheetColumn = (typeof SHEET_COLUMNS)[number];
export type ContactRow = Record<SheetColumn, string>;

const extractedShape = {
  salutation: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  name_original: z.string(),
  job_title: z.string(),
  company: z.string(),
  email: z.string(),
  mobile: z.string(),
  website: z.string(),
  address: z.string(),
  linkedin: z.string(),
  other: z.string(),
} satisfies Record<ExtractedField, z.ZodString>;

// What the model must return. Every field is a string ("" when absent); contact_type is the model's
// suggestion ("" when it can't tell).
export const extractionSchema = z.object({
  ...extractedShape,
  contact_type: z.enum(["", ...CONTACT_TYPES]),
  low_confidence: z.array(z.enum([...EXTRACTED_FIELDS, "contact_type"])),
});
export type Extraction = z.infer<typeof extractionSchema>;

// Fields a client may send when saving or editing a contact.
const text = z.string().trim().max(2000);
export const contactInputSchema = z.object({
  ...Object.fromEntries(EXTRACTED_FIELDS.map((f) => [f, text])) as Record<ExtractedField, typeof text>,
  event: text,
  date_met: text,
  notes: z.string().trim().max(5000),
  status: z.enum(STATUSES),
  contact_type: z.enum(["", ...CONTACT_TYPES]),
  owner: text,
  next_action: text,
  next_action_date: text,
});
export type ContactInput = z.infer<typeof contactInputSchema>;

// Every field empty (status "New"). A save starts from this, so a draft kept on the phone
// by an older version, without fields added since (such as salutation), can still be saved.
export function blankContactInput(): ContactInput {
  const keys = Object.keys(contactInputSchema.shape) as (keyof ContactInput)[];
  return { ...(Object.fromEntries(keys.map((k) => [k, ""])) as Omit<ContactInput, "status" | "contact_type">), status: "New", contact_type: "" };
}

// A short message naming the first field that failed validation (shown to the person).
export function invalidFieldMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  const field = String(issue?.path[0] ?? "");
  const label = FIELD_LABELS[field] ?? field;
  if (issue?.code === "too_big") return `${label} is too long (at most ${issue.maximum} characters).`;
  if (field === "status") return `Status must be one of: ${STATUSES.join(", ")}.`;
  return label ? `${label} is not valid.` : "Some fields are invalid.";
}

export function emptyExtraction(): Extraction {
  return {
    ...(Object.fromEntries(EXTRACTED_FIELDS.map((f) => [f, ""])) as Record<ExtractedField, string>),
    contact_type: "",
    low_confidence: [],
  };
}

// A LinkedIn people-search link for someone without a LinkedIn URL on their card ("" otherwise).
// Only a link: opening it searches LinkedIn as the person who clicks it.
export function linkedinSearchUrl(c: Pick<ContactRow, "first_name" | "last_name" | "company" | "linkedin">): string {
  const words = [c.first_name, c.last_name, c.company].map((w) => w.trim()).filter(Boolean).join(" ");
  if (c.linkedin.trim() || !(c.first_name.trim() || c.last_name.trim())) return "";
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(words)}`;
}
