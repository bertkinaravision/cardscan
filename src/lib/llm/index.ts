import "server-only";
import { EXTRACTED_FIELDS, extractionSchema, type ExtractedField, type Extraction } from "@/lib/fields";
import { anthropicExtractor } from "./anthropic";
import { geminiExtractor } from "./gemini";
import { mockExtractor } from "./mock";
import type { CardImage, VisionExtractor } from "./types";

export { LlmRateLimitError } from "./types";

const DEFAULT_MODELS: Record<string, string> = {
  gemini: "gemini-3.5-flash-lite",
  anthropic: "claude-haiku-5-5",
};

function extractor(): VisionExtractor {
  const provider = (process.env.LLM_PROVIDER ?? "gemini").toLowerCase();
  const model = process.env.LLM_MODEL || DEFAULT_MODELS[provider];
  switch (provider) {
    case "gemini":
      return geminiExtractor(model);
    case "anthropic":
      return anthropicExtractor(model);
    case "mock":
      return mockExtractor;
    default:
      throw new Error(`Unknown LLM_PROVIDER "${provider}". Use gemini, anthropic or mock.`);
  }
}

export async function extractCard(images: CardImage[]): Promise<Extraction> {
  const raw = await extractor().extract(images);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("The model did not return valid JSON.");
  }
  const parsed = extractionSchema.safeParse(normalize(json));
  if (!parsed.success) throw new Error("The model's answer did not match the expected fields.");
  return parsed.data;
}

// Turns any value into text: nested objects and lists become "a; b; c" instead of "[object Object]".
function flatten(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(flatten).filter(Boolean).join("; ");
  if (typeof v === "object") return Object.values(v).map(flatten).filter(Boolean).join(", ");
  return String(v).trim();
}

// Small slips in the model's answer (a missing field, null instead of "", a number, an unknown
// field name in low_confidence) shouldn't fail the whole card; the person reviews it anyway.
export function normalize(json: unknown): unknown {
  if (!json || typeof json !== "object" || Array.isArray(json)) return json;
  const src = json as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of EXTRACTED_FIELDS) {
    const v = src[f];
    out[f] = flatten(v);
  }
  const lc = Array.isArray(src.low_confidence) ? src.low_confidence : [];
  out.low_confidence = [...new Set(lc.filter((f): f is ExtractedField => (EXTRACTED_FIELDS as readonly unknown[]).includes(f)))];
  return out;
}
