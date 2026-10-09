import type { VisionExtractor } from "./types";

// LLM_PROVIDER=mock: returns a fixed card so the app can be tried without an API key.
export const mockExtractor: VisionExtractor = {
  async extract() {
    await new Promise((r) => setTimeout(r, 1200));
    return JSON.stringify({
      first_name: "David",
      last_name: "Tan",
      salutation: "Dr.",
      job_title: "Director, Business Development",
      company: "Example Pte Ltd",
      email: "david.tan@example.com.sg",
      mobile: "+65 9123 4567",
      website: "example.com.sg",
      address: "1 Example Road, #10-01, Singapore 123456",
      linkedin: "",
      other: "Office: +65 6123 4567; WeChat: davidtan",
      low_confidence: ["mobile"],
    });
  },
};
