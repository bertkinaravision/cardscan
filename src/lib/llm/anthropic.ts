import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { extractionSchema } from "@/lib/fields";
import { requireEnv } from "@/lib/server/env";
import { EXTRACTION_PROMPT } from "./prompt";
import { LlmBusyError, type CardImage, type VisionExtractor } from "./types";

export function anthropicExtractor(model: string): VisionExtractor {
  const client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  return {
    async extract(images: CardImage[]) {
      try {
        const res = await client.messages.parse({
          model,
          max_tokens: 4000,
          output_config: { effort: "low", format: zodOutputFormat(extractionSchema) },
          messages: [
            {
              role: "user",
              content: [
                ...images.map((img) => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: img.mimeType as "image/jpeg",
                    data: img.base64,
                  },
                })),
                { type: "text" as const, text: EXTRACTION_PROMPT },
              ],
            },
          ],
        });
        if (res.stop_reason === "refusal") throw new Error("The model declined to read this card.");
        return res.parsed_output ? JSON.stringify(res.parsed_output) : "";
      } catch (err) {
        if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) throw new LlmBusyError(err.message);
        throw err;
      }
    },
  };
}
