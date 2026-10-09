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
        if (err instanceof ApiError && err.status === 429) throw new LlmRateLimitError(err.message);
        throw err;
      }
    },
  };
}
