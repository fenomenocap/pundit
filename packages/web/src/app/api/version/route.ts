import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  // Prefer Vercel's immutable deployment metadata; BUILD_SHA remains a local
  // and explicitly managed fallback only.
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim()
    || process.env.BUILD_SHA?.trim()
    || "unknown";

  return NextResponse.json(
    { sha },
    { headers: { "Cache-Control": "no-store" } }
  );
}
