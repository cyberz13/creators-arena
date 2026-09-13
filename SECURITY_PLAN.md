# SECURITY_PLAN — findings → fixes (2026-09-12)

Branch `security/production-hardening`. Source: external review `creators-arena-review-ar.md` + this repository's own audit. Every row was reproduced locally before it was fixed; the reproduction tests live in `tests/audit-confirmations.test.ts` with their expectations flipped to the safe behaviour.

| # | Finding (severity) | Proven by | Fix | Regression test |
|---|---|---|---|---|
| 1 | Reflected XSS in `/go/:code` (High, confirmed over HTTP) | A01, `http-proof.mjs` | strict code syntax → link existence → static `/go-challenge.js` + escaped JSON config; per-response CSP `default-src 'none'; script-src 'self'` | `tests/go-route.test.ts`, A01, `scripts/http-security-check.mjs` |
| 2 | Vulnerable deps: next 16.3.2 (2× critical), sharp 0.35.3, js-yaml 4.3.1 (Urgent) | `npm audit` | next 16.3.5 exact, eslint-config-next 16.3.5, sharp 0.35.4, js-yaml 4.3.2 via lockfile; CI fails on high/critical | `npm audit --omit=dev` = 0 |
| 3 | Known default secrets / default admin password (Critical on misconfig) | A02 | `src/lib/env.ts` fails closed in production (length, placeholders, distinct `CHALLENGE_SECRET`), validated at boot; bootstrap refuses defaults in production | `tests/env.test.ts`, A02 |
| 4 | Challenge token replayable, not one-time, not bound to visitor; client signals treated as proof (High) | A03 | persisted nonce consumed atomically, bound to code+IP+visitor cookie, 2-min TTL; signals are risk-only; fail-closed on missing network verdict with auto re-evaluation | `tests/challenge.test.ts`, `tests/go-route.test.ts`, A03 |
| 5 | Reviews after finalization desync ranks and prizes (High) | A04 | results lifecycle provisional → final; reviews re-derive ranks/winners/payouts; corrections explicit and logged; paid entitlements never move silently | `tests/results.test.ts`, A04 |
| 6 | Tie-break corrupted by late approvals / rejections (High) | A05, A06 | `last_qualified_at` re-derived from the click log inside the review transaction (time the current count was reached) | `tests/results.test.ts`, A05, A06 |
| 7 | Concurrency: unlocked read-then-write in review/finalize/payout (High) | code review | campaign advisory lock (shared for clicks, exclusive for review/finalize), conditional UPDATEs with affected-row checks, audit + notifications inside the transaction with dedupe keys, SQLite tx mutex | `tests/results.test.ts` (concurrent finalize), `scripts/pg-concurrency-test.mjs` (multi-process, CI) |
| 8 | No login/registration throttling, no MFA (High) | code review | DB-backed atomic limiter (per IP + per e-mail), generic errors, constant-time unknown-user path, mandatory admin TOTP with encrypted secrets and hashed recovery codes | `tests/accounts.test.ts` |
| 9 | Disabled creators keep scoring and winning (Medium) | A08 | eligibility (disabled / participation suspended / excluded) enforced when counting and in standings; admin controls for each | `tests/results.test.ts`, A08 |
| 10 | Finalization limited to 100 participants (Medium) | A07 | full eligible standings, no display limit | `tests/results.test.ts`, A07 |
| 11 | IP verdict may arrive after qualification; retention mismatch; setting not honoured (Medium) | code review | `ip_unverified` hold + auto-qualify, 7-day DELETE retention, setting checked before any lookup, cache freshness checked | `tests/tracking.test.ts`, `tests/go-route.test.ts` |
| 12 | No server-protecting request limit (Medium) | code review | in-memory per-IP limiter before any DB/external work (429), plus DB-backed limits for auth | `tests/go-route.test.ts`, HTTP check |
| 13 | 4 ESLint errors, stale docs | lint | time computed in data/utility helpers; README/ARCHITECTURE updated | `npm run lint` |
| 14 | Supabase tables exposed to `anon`/`authenticated` via Data API (Critical, from own audit) | schema | `migrations/0001_deny_by_default.sql` + `scripts/db-security-check.mjs`; migrations use `MIGRATION_DATABASE_URL` | `scripts/pg-dialect-check.mjs` (PGlite) |
| 15 | Secrets in argv/bundle; scripts able to hit production silently | scripts | bundle script deleted; every live-DB script requires explicit acknowledgements | — |
| 16 | Public API leaks `user_id` and timestamps | code review | public DTO; API rate limit + short cache | `tests/results.test.ts` |
| 17 | No security headers | code review | nonce CSP via proxy, HSTS, nosniff, DENY, referrer/permissions policies, no `x-powered-by`, `no-referrer` on report links | HTTP check |
| 18 | Host header trusted for absolute links; server-timezone parsing; in-memory hour aggregation; unmanaged report links | review §8 | canonical origin in production; Riyadh explicit offsets; SQL aggregation (session-tz independent); report token expiry/rotate/revoke/view counter | `tests/store-report.test.ts`, PGlite check |

## Manual actions before/after deploy
See `PRODUCTION_CHECKLIST.md` (new env vars, migration 0001, `app_runtime` role, MFA enrolment, backups).

## Remaining risks (honest list)
See the final report (`FIX_REPORT_AR.md`).
