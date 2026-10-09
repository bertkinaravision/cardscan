import { extractCard, LlmRateLimitError } from "@/lib/llm";
import { readImage } from "@/lib/server/images";
import { errorResponse, HttpError, requireUser } from "@/lib/server/session";

export const maxDuration = 60;

// One card per request: front (required) and back (optional) photos in, checked JSON out.
export async function POST(req: Request) {
  try {
    await requireUser(req);
    const form = await req.formData();
    const front = await readImage(form, "front");
    if (!front) throw new HttpError(400, "The front photo is missing.");
    const back = await readImage(form, "back");
    const images = [front, back]
      .filter((b): b is Buffer => b !== null)
      .map((b) => ({ mimeType: "image/jpeg", base64: b.toString("base64") }));
    const extraction = await extractCard(images);
    return Response.json({ extraction });
  } catch (err) {
    if (err instanceof LlmRateLimitError) {
      return Response.json({ error: "The AI model is busy. Retrying shortly." }, { status: 429 });
    }
    return errorResponse(err);
  }
}
