import "server-only";
import { extractionSchema, type Extraction } from "@/lib/fields";
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
  const parsed = extractionSchema.safeParse(json);
  if (!parsed.success) throw new Error("The model's answer did not match the expected fields.");
  const data = parsed.data;
  for (const key of Object.keys(data) as (keyof Extraction)[]) {
    if (typeof data[key] === "string") (data as Record<string, unknown>)[key] = (data[key] as string).trim();
  }
  return data;
}
