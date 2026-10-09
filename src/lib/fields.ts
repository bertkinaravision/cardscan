import { z } from "zod";

// Fields the vision model extracts from a card. Order is the order shown on the review screen.
export const EXTRACTED_FIELDS = [
  "salutation",
  "first_name",
  "last_name",
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
  owner: "Owner",
  next_action: "Next action",
  next_action_date: "Next action date",
};

export const STATUSES = [
  "To contact",
  "Contacted",
  "In conversation",
  "Closed",
  "Not relevant",
] as const;
export type Status = (typeof STATUSES)[number];

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
export const CRM_FIELDS = ["status", "owner", "next_action", "next_action_date"] as const;

// Sheet columns, left to right. The app maps by header name, so adding extra
// columns to the right in the Sheet is safe.
export const SHEET_COLUMNS = [
  "id",
  ...EXTRACTED_FIELDS,
  ...CONTEXT_FIELDS,
  ...CRM_FIELDS,
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
  job_title: z.string(),
  company: z.string(),
  email: z.string(),
  mobile: z.string(),
  website: z.string(),
  address: z.string(),
  linkedin: z.string(),
  other: z.string(),
} satisfies Record<ExtractedField, z.ZodString>;

// What the model must return. Every field is a string ("" when absent).
export const extractionSchema = z.object({
  ...extractedShape,
  low_confidence: z.array(z.enum(EXTRACTED_FIELDS)),
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
  owner: text,
  next_action: text,
  next_action_date: text,
});
export type ContactInput = z.infer<typeof contactInputSchema>;

export function emptyExtraction(): Extraction {
  return {
    ...(Object.fromEntries(EXTRACTED_FIELDS.map((f) => [f, ""])) as Record<ExtractedField, string>),
    low_confidence: [],
  };
}
