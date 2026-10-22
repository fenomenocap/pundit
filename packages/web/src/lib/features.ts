// Build-time feature switches. Read once at build: NEXT_PUBLIC_* values are inlined.
//
// FPL team builder (/draft + /api/fpl): OFF unless the build sets
// NEXT_PUBLIC_FPL_BUILDER=on. It shows public Fantasy Premier League player data
// (prices, positions, availability), which needs the owner's sign-off before it
// ships. While off, /draft is a holding page, /api/fpl returns 404 and the nav
// hides the FPL link. The Playwright web server turns it on so the builder stays tested.
export const FPL_BUILDER_ENABLED = process.env.NEXT_PUBLIC_FPL_BUILDER === "on";
