export type CardImage = { mimeType: string; base64: string };

export interface VisionExtractor {
  // Returns the model's raw JSON text; the caller validates it.
  extract(images: CardImage[]): Promise<string>;
}

// The model is busy or briefly failing (rate limit, overload, server error): worth retrying.
export class LlmBusyError extends Error {}
