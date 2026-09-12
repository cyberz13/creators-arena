# SECURITY.md — CREATORS ARENA

This document describes the security model of the platform as implemented in
this repository, how to configure it safely, and how to report problems.

## Threat model in one paragraph

Public visitors hit `/go/:code` (tracking redirect) and read-only pages.
Creators log in to join campaigns and share links. One admin operates
everything (campaigns, reviews, payouts). The valuable assets are: the
integrity of click counting (prize money depends on it), account credentials,
and the store-report links. External dependencies: Supabase PostgreSQL,
Vercel, an IP-intelligence API, and optionally an e-mail provider.

## Controls (what exists in code)

| Area | Control | Where |
|---|---|---|
| Secrets | Production fails closed on missing/short/placeholder secrets; validated at boot | `src/lib/env.ts`, `src/instrumentation.ts` |
| Sessions | Server-side sessions, random 256-bit token, SHA-256 stored, revoke one/all, admin 12h, creator 30d, rotation after MFA | `src/services/sessions.ts`, `src/lib/auth.ts` |
| Admin MFA | Mandatory TOTP (RFC 6238), AES-256-GCM encrypted secret, 8 single-use hashed recovery codes | `src/lib/totp.ts`, `src/services/mfa.ts`, `/account/mfa`, `/login/mfa` |
| Brute force | DB-backed fixed-window limiter (per IP and per account, login/register/reset/MFA); generic failure message; constant-time compare for unknown accounts | `src/services/rate-limit.ts`, `src/services/auth.ts` |
| Passwords | bcrypt, 10–128 chars with letters+digits, change requires current password and revokes other sessions | `src/services/auth.ts` |
| Account recovery | Single-use hashed tokens (1h reset / 24h verify), no account enumeration | `src/services/auth.ts`, `src/lib/mailer.ts` |
| Tracking route | Strict code syntax → link must exist before any work; static challenge script; escaped JSON config; per-response CSP; one-time signed nonces bound to code+IP+visitor; early per-IP limiter; input clamps | `src/app/go/[code]/route.ts`, `src/services/challenges.ts`, `public/go-challenge.js` |
| Click integrity | Classification inside a transaction behind advisory locks; eligibility checks; fail-closed on missing network verdict; client signals are risk-only | `src/services/tracking.ts`, `src/services/fraud.ts` |
| Results & prizes | provisional → final lifecycle; tie-break re-derived from the click log; conditional updates with affected-row checks; audit rows in the same transaction; paid entitlements never move silently; paying requires password re-entry | `src/services/results.ts`, `src/services/payouts.ts` |
| Headers | Nonce CSP (`strict-dynamic`, no `unsafe-eval`), HSTS, nosniff, DENY framing, referrer policy, permissions policy, no `x-powered-by`; `no-referrer` on report links | `src/proxy.ts`, `next.config.ts` |
| Public data | Leaderboard DTO exposes rank/username/name/avatar/count only; API rate-limited and briefly cached | `src/services/leaderboard.ts`, `src/app/api/campaigns/[id]/leaderboard/route.ts` |
| Database exposure | Migration revokes Data API roles, enables RLS, creates a limited runtime role; read-only checker | `migrations/0001_deny_by_default.sql`, `scripts/db-security-check.mjs` |
| Privacy | Raw IPs never stored; IP-intel rows deleted after 7 days; hashed visitor ids | `src/services/ip-intel.ts`, privacy page |
| Operational safety | Every script that can reach a live database requires explicit acknowledgements; migrations use a separate owner connection | `scripts/lib/prod-guard.mjs`, `scripts/db-push.mjs` |

### What the platform does NOT claim

A qualified visit means: a redirect to the store URL that passed the
platform's filters (JavaScript challenge, session/device duplicate checks,
network checks) and was not classified as duplicate or automated. It does not
prove the store page loaded, that a human was present, or that a purchase
happened. Copy in the product uses this wording deliberately.

## Configuration

See `.env.example`. Required in production: `DATABASE_URL`, `SESSION_SECRET`,
`CHALLENGE_SECRET`, `IP_HASH_SALT`, `MFA_ENCRYPTION_KEY`, `NEXT_PUBLIC_APP_URL`.
Generate secrets with `openssl rand -base64 32`; store them only in the host's
secret store (Vercel → Environment Variables). Never paste secrets into chat,
tickets, commit messages or shell history that is persisted.

## Rotating secrets (runbook)

| Secret | Effect of rotation | Procedure |
|---|---|---|
| `SESSION_SECRET` | Recovery-code hashes (peppered) and nothing else in the DB depend on it; sessions themselves are random tokens and survive | Set new value → redeploy → ask admins to regenerate recovery codes (re-enrol MFA) |
| `CHALLENGE_SECRET` | In-flight tracking challenges (≤ 2 min) become invalid — visitors are still redirected, just not counted for that instant | Set new value → redeploy |
| `IP_HASH_SALT` | Changes every ip/device hash → duplicate detection restarts from zero and cached `ip_intel` rows no longer match | Rotate only during a quiet window; expect a 24h window of weaker dedup |
| `MFA_ENCRYPTION_KEY` | Existing TOTP secrets can no longer be decrypted | Before rotating: keep old key available; admins must re-enrol after rotation (`UPDATE users SET mfa_enabled=0, mfa_secret_enc=NULL WHERE role='admin'` via the owner connection, logged) |
| Database password / `app_runtime` | Immediate | Change in Supabase, update `DATABASE_URL`, redeploy |
| `RESEND_API_KEY` | Immediate | Rotate at provider, update env, redeploy |

## Revoking sessions

- One user: Admin → creators → (disable account) revokes access immediately
  because every request re-checks `users.status`; or run
  `UPDATE sessions SET revoked_at = <now ms> WHERE user_id = '<id>'`.
- Everyone (suspected secret leak): `UPDATE sessions SET revoked_at = <now ms> WHERE revoked_at IS NULL`.
- The creator profile page offers "log out from all other devices".

## Reporting a vulnerability

E-mail the operator listed on the site's contact channels with steps to
reproduce. Do not test against the production database or other people's
accounts; a local setup with `npm run seed` reproduces the whole platform.
