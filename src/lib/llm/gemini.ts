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

export function geminiExtractor(model: string): VisionExtractor {
  const ai = new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY") });
  return {
    async extract(images: CardImage[]) {
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
        // 429 = rate limit, 503 = model temporarily overloaded: both are worth retrying.
        if (err instanceof ApiError && (err.status === 429 || err.status === 503)) throw new LlmRateLimitError(err.message);
        if (err instanceof ApiError && err.status === 404)
          throw new Error(`Gemini model "${model}" is not available. Set LLM_MODEL to a current model from AI Studio.`);
        if (err instanceof ApiError && (err.status === 400 || err.status === 403) && /api key|API_KEY/i.test(err.message))
          throw new Error("GEMINI_API_KEY is missing or invalid. Create a key at aistudio.google.com.");
        throw err;
      }
    },
  };
}
