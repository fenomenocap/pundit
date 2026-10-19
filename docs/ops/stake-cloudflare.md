# Stake market source (Cloudflare block)

Stake’s public GraphQL endpoint (`https://stake.bet/_api/graphql`) returns HTTP **403** with a Cloudflare “Just a moment…” interstitial from this environment and from production collectors. That is bot protection, not a bad tournament slug.

**Current behaviour:** `DISABLED_SOURCES.stake` in `fixture-market-sources.ts` skips Stake entirely. Coverage reports the skip reason instead of a false “matching bug”. Kalshi and Polymarket remain the live comparison spine.

**Re-enable:** Remove the `stake` entry from `DISABLED_SOURCES` only after a supported integration path exists (official API, allowlisted egress, or another contract Stake documents). Do not commit cookies, CAPTCHA tokens, or paid scraping credentials to the repo.
