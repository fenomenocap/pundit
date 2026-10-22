import { NextResponse } from "next/server";
import { FPL_BOOTSTRAP_URL, mapBootstrap } from "@/desk/lib/fpl-data";
import { FPL_BUILDER_ENABLED } from "@/lib/features";

// Server-side proxy: the FPL API does not allow browser (CORS) reads.
// The raw payload is over Next's 2 MB data-cache limit, so the small mapped
// response is cached at the CDN for an hour instead (s-maxage). Errors are
// never cached. Nothing is fetched at build time.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  if (!FPL_BUILDER_ENABLED) {
    return NextResponse.json({ error: "Not found." }, { status: 404, headers: NO_STORE });
  }
  try {
    const res = await fetch(FPL_BOOTSTRAP_URL, {
      cache: "no-store",
      headers: { accept: "application/json", "user-agent": "pundit-web/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Player data source returned ${res.status}.` }, { status: 502, headers: NO_STORE });
    }
    const payload = mapBootstrap(await res.json(), new Date().toISOString());
    if (payload.players.length === 0) {
      return NextResponse.json({ error: "Player data source returned no players." }, { status: 502, headers: NO_STORE });
    }
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600" },
    });
  } catch {
    return NextResponse.json({ error: "Player data source is unavailable." }, { status: 502, headers: NO_STORE });
  }
}
