import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const sha = process.env.BUILD_SHA?.trim()
    || process.env.VERCEL_GIT_COMMIT_SHA?.trim()
    || "unknown";

  return NextResponse.json(
    { sha },
    { headers: { "Cache-Control": "no-store" } }
  );
}
