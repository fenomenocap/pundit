# Vercel access (Hobby / owner-only)

Ops note for agents and contributors. **Do not invent billing or upgrade paths.** Prefer this free/docs reality over any paid Hobby→Pro change unless an Owner explicitly decides otherwise.

## Facts (verified)

| Item | Value |
|------|-------|
| GitHub repo | `fenomenocap/pundit` (public) |
| Vercel team | `fenomenocap` |
| Vercel plan | **Hobby** (`billing.plan: hobby`) |
| Vercel project | `sports-prediction-markets-web` |
| Production web | https://thepundit.vercel.app |
| Team members | **Owner only** (`fenomenocap` / GitHub `il-fenomeno`) — members list is otherwise empty |

## EauDoon × TEAM_ACCESS

- **GitHub:** `EauDoon` has **write** on `fenomenocap/pundit`.
- **Vercel:** Not a team member. Hobby does **not** allow adding collaborators.

Verified invite attempt (Vercel API `POST /v1/teams/{teamId}/members` as Owner):

```text
code: invites_not_allowed
message: Team members are not permitted on the Hobby Plan.
         To collaborate with others, please upgrade to a Pro Team
         or enable the v0 entitlement.
```

**Stop here on invite.** Do not retry invites, do not start a Pro trial/upgrade, and do not invent a free seat. Document and escalate to Owner only if product needs multi-committer Vercel deploys.

## Owner-only deploy reality (Hobby)

Per [Vercel: Troubleshoot project collaboration](https://vercel.com/docs/deployments/troubleshoot-project-collaboration):

- Hobby does not support collaboration for **private** repos; team seats are a **Pro/Enterprise** feature.
- On Hobby, the **commit author must be the Hobby team Owner** (Login Connection match) for Git-triggered deploys under that team.
- Official docs also note that collaboration is free for **public** repositories in some deployment-attribution flows — but **member invites remain blocked on Hobby** (API above). Treat dashboard “Add member” / CLI invites as upgrade-gated.

Practical consequence for this project:

1. Contributors (including `EauDoon`) can push/PR on GitHub.
2. Production/preview deploys owned by the `fenomenocap` Hobby team are reliably attributable to the **Owner**. Prefer Owner merge (or Owner-authored commits) for Vercel Git deploys.
3. Fork PRs / non-owner commit authors may hit fork-protection or “not a member of this team” deploy blocks; do not “fix” that by upgrading without an explicit Owner billing decision.

## Allowed free paths

- Keep using GitHub write + Owner-merged PRs (current default).
- Owner runs `vercel` CLI / dashboard redeploys when a non-owner commit must ship.
- Share preview URLs via Vercel Share / public preview links when view-only access is enough (not full contributing membership).
- If multi-person Vercel contributing access is required later: Owner decides Pro (or docs-stated entitlement) — out of scope for agents unless explicitly authorized.

## Related

- Production monitor / incident playbook: [`docs/ops/cloud-monitor.md`](./cloud-monitor.md)
- Agent standing notes: [`AGENTS.md`](../../AGENTS.md)
