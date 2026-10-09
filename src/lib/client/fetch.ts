export class RequestTimeout extends Error {}

// fetch that gives up after `ms`, so a stalled connection can't leave a card "Processing" or
// "Saving…" forever. Throws RequestTimeout on timeout; network errors stay TypeErrors.
export async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) throw new RequestTimeout("The request took too long.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
