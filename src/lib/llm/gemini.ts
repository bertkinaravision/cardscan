import "server-only";
import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { extractionSchema } from "@/lib/fields";
import { requireEnv } from "@/lib/server/env";
import { EXTRACTION_PROMPT } from "./prompt";
import { LlmRateLimitError, type CardImage, type VisionExtractor } from "./types";

// Gemini accepts a subset of JSON Schema; drop the "$schema" marker zod adds.
const responseSchema: Record<string, unknown> = z.toJSONSchema(extractionSchema);
delete responseSchema.$schema;

// Models whose free daily allowance ran out (or that were retired), skipped until the time stored.
const unavailableUntil = new Map<string, number>();
const SKIP_MS = 60 * 60 * 1000;

class ModelUnavailable extends Error {}

// Tries the models in order; when one's free daily limit is used up or it was retired, the next one
// takes over (each model has its own free allowance).
export function geminiExtractor(models: string[]): VisionExtractor {
  const ai = new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY") });

  async function callModel(model: string, images: CardImage[]): Promise<string> {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              ...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } })),
              { text: EXTRACTION_PROMPT },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: responseSchema,
          temperature: 0,
        },
      });
      return res.text ?? "";
    } catch (err) {
      if (err instanceof ApiError && err.status === 429 && /per ?day|PerDay|daily/i.test(err.message))
        throw new ModelUnavailable(`daily limit reached for ${model}`);
      if (err instanceof ApiError && err.status === 404)
        throw new ModelUnavailable(`${model} does not exist or was retired (check LLM_MODEL / LLM_FALLBACK_MODELS)`);
      // 429 = rate limit, 503 = model temporarily overloaded: both are worth retrying.
      if (err instanceof ApiError && (err.status === 429 || err.status === 503)) throw new LlmRateLimitError(err.message);
      if (err instanceof ApiError && (err.status === 400 || err.status === 403) && /api key|API_KEY/i.test(err.message))
        throw new Error("GEMINI_API_KEY is missing or invalid. Create a key at aistudio.google.com.");
      throw err;
    }
  }

  return {
    async extract(images: CardImage[]) {
      const now = Date.now();
      const usable = models.filter((m) => (unavailableUntil.get(m) ?? 0) <= now);
      for (const model of usable) {
        try {
          return await callModel(model, images);
        } catch (err) {
          if (!(err instanceof ModelUnavailable)) throw err;
          console.warn(`[gemini] ${err.message}; trying the next model`);
          unavailableUntil.set(model, Date.now() + SKIP_MS);
        }
      }
      throw new Error(
        "No Gemini model is available right now: the free daily limits are used up (tap Retry later), or the models were retired (update LLM_MODEL / LLM_FALLBACK_MODELS).",
      );
    },
  };
}
