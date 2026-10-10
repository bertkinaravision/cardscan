export type CardImage = { mimeType: string; base64: string };

export interface VisionExtractor {
  // Returns the model's raw JSON text; the caller validates it.
  extract(images: CardImage[]): Promise<string>;
}

export class LlmRateLimitError extends Error {}
