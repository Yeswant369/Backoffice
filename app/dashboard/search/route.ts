import { NextResponse, type NextRequest } from "next/server";
import { universalSearch } from "./search";

// Type-ahead search is a GET route handler, NOT a server action: this Next
// version dispatches server actions one-at-a-time (see docs
// 02-guides/backend-for-frontend.md — "Server Actions are queued"), which
// would serialize every keystroke's fetch. A route handler dispatches in
// parallel and supports AbortController cancellation from the palette.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const result = await universalSearch(q);
  return NextResponse.json(result);
}
