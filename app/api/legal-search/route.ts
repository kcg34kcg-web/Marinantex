import { NextResponse } from "next/server";
import { LAW_DATA } from "@/lib/laws";

const MAX_QUERY_LENGTH = 160;
const MAX_RESULTS = 12;

function normalizeQuery(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", results: [] },
      { status: 400 },
    );
  }

  const query = normalizeQuery((payload as { query?: unknown } | null)?.query);
  if (!query) {
    return NextResponse.json({ results: [] });
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { error: `query too long (max ${MAX_QUERY_LENGTH})`, results: [] },
      { status: 400 },
    );
  }

  const needle = query.toLocaleLowerCase("tr");
  const results = LAW_DATA.filter((item) =>
    `${item.label} ${item.text} ${item.id}`.toLocaleLowerCase("tr").includes(needle),
  )
    .slice(0, MAX_RESULTS)
    .map((item) => ({
      id: item.id,
      title: item.label,
      content: item.text,
    }));

  return NextResponse.json({ results });
}
