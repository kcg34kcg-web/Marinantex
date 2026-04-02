import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/legal-search/route";

describe("POST /api/legal-search", () => {
  it("returns matches for valid query", async () => {
    const request = new Request("http://localhost/api/legal-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "TBK 117" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      results: Array<{ id: string; title: string; content: string }>;
    };
    expect(Array.isArray(payload.results)).toBe(true);
    expect(payload.results.length).toBeGreaterThan(0);
    expect(payload.results[0]?.id).toBe("tbk-117");
  });

  it("returns 400 when query is too long", async () => {
    const request = new Request("http://localhost/api/legal-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "a".repeat(161) }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns empty list for blank query", async () => {
    const request = new Request("http://localhost/api/legal-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "   " }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const payload = (await response.json()) as { results: unknown[] };
    expect(payload.results).toEqual([]);
  });
});
