<!-- ae-control-plane v1 (2026-07-16). Machine operating contract; product docs follow below. -->
# Operating contract — Automated Empires control plane

- **Canonical clone (the ONLY writable copy):** WSL `Ubuntu-24.04-Recovered` → `/home/jackson/automatedempires/ventures/oran`.
  Never clone this repository anywhere else on the machine. Parallel work uses controlled
  worktrees: `ae start oran -t <task> -a <agent> --worktree`.
- **Sessions:** acquire the single-writer lease first (`ae start oran -t <task> -a <agent>`);
  end with `ae finish oran`. Work counts as done ONLY when pushed and remote-SHA-verified.
- **Deploys:** merging `main` auto-deploys production via Vercel.
- **Validate before merge:** `pnpm typecheck && pnpm lint` (CI must be green; squash merges).
- **Providers (fixed — never swap or cross-wire):** db=supabase, auth=clerk, ai=azure-ai (LEGACY — phase-2 replacement pending).
- **LOCKED:** Platform direction: Vercel + Supabase + Clerk, matching the rest of the portfolio (founder, 2026-07-15)
- **Warn before:** running migrations
- **Warn before:** re-enabling any Azure service
- Full policy: `github.com/AutomatedEmpires/ae-control` → `POLICY.md`. Briefing: `ae info oran`.

---

# oran

ORAN — civic Open Resource Access Network. Off-Azure migration to Vercel/Supabase/Clerk landed 2026-07-15 (main 5dd52a5 line).
