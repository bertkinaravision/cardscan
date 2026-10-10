import "server-only";
import { EXTRACTED_FIELDS, extractionSchema, type ExtractedField, type Extraction } from "@/lib/fields";
import { anthropicExtractor } from "./anthropic";
import { geminiExtractor } from "./gemini";
import { mockExtractor } from "./mock";
import type { CardImage, VisionExtractor } from "./types";

export { LlmBusyError } from "./types";

const DEFAULT_MODELS: Record<string, string> = {
  gemini: "gemini-3.5-flash-lite",
  anthropic: "claude-haiku-5-5",
};

function extractor(): VisionExtractor {
  const provider = (process.env.LLM_PROVIDER ?? "gemini").toLowerCase();
  const model = process.env.LLM_MODEL || DEFAULT_MODELS[provider];
  switch (provider) {
    case "gemini": {
      const fallbacks = (process.env.LLM_FALLBACK_MODELS ?? "gemini-3.1-flash-lite,gemini-3.5-flash")
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
      return geminiExtractor([...new Set([model, ...fallbacks])]);
    }
    case "anthropic":
      return anthropicExtractor(model);
    case "mock":
      return mockExtractor;
    default:
      throw new Error(`Unknown LLM_PROVIDER "${provider}". Use gemini, anthropic or mock.`);
  }
}

// Chinese, Japanese or Korean characters.
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/;

async function extractOnce(images: CardImage[]): Promise<Extraction> {
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

export async function extractCard(images: CardImage[]): Promise<Extraction> {
  const started = Date.now();
  let data = await extractOnce(images);
  // Names must be in Latin letters. The model now and then copies a Chinese/Japanese name
  // as-is; asking once more usually fixes it. If not, keep it but flag it for review.
  // (Only when there is time left: the request may run at most 60 seconds.)
  if (CJK.test(data.first_name + data.last_name) && Date.now() - started < 20_000) {
    const again = await extractOnce(images).catch((err) => {
      console.warn("[extract] second attempt failed:", err instanceof Error ? err.message : err);
      return null;
    });
    if (again && !CJK.test(again.first_name + again.last_name)) data = again;
    else data.low_confidence = [...new Set([...data.low_confidence, "first_name" as const, "last_name" as const])];
  } else if (CJK.test(data.first_name + data.last_name)) {
    data.low_confidence = [...new Set([...data.low_confidence, "first_name" as const, "last_name" as const])];
  }
  return data;
}

// Turns any value into text: nested objects and lists become "a; b; c" instead of "[object Object]".
function flatten(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(flatten).filter(Boolean).join("; ");
  if (typeof v === "object") return Object.values(v).map(flatten).filter(Boolean).join(", ");
  return String(v).trim();
}

// Titles that belong in "salutation", never in the first name.
const SALUTATION =
  /^((?:assoc(?:iate)?\.?\s*prof(?:essor)?|a\/prof|asst\.?\s*prof|prof(?:essor)?|dr|mr|mrs|ms|mdm|miss|mx|ir|sir|dame|rev|hon|dato'?|datuk|datin|tan sri|puan sri|tun|toh puan)\.?)\s+/i;

function splitSalutation(out: Record<string, unknown>) {
  let first = String(out.first_name ?? "");
  const found: string[] = [];
  for (let m = first.match(SALUTATION); m; m = first.match(SALUTATION)) {
    found.push(m[1]);
    first = first.slice(m[0].length);
  }
  if (found.length === 0) return;
  out.first_name = first.trim();
  out.salutation = [String(out.salutation ?? ""), ...found].filter(Boolean).join(" ").trim();
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
  splitSalutation(out);
  const lc = Array.isArray(src.low_confidence) ? src.low_confidence : [];
  out.low_confidence = [...new Set(lc.filter((f): f is ExtractedField => (EXTRACTED_FIELDS as readonly unknown[]).includes(f)))];
  return out;
}
