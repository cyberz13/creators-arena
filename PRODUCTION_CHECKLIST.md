# PRODUCTION_CHECKLIST.md — before and after each deploy

## A. One-time setup (manual — the code cannot do these)

### Vercel
- [ ] Environment variables (Production scope): `DATABASE_URL`, `SESSION_SECRET`, `CHALLENGE_SECRET`,
      `IP_HASH_SALT`, `MFA_ENCRYPTION_KEY`, `NEXT_PUBLIC_APP_URL=https://www.<domain>`,
      `REGISTRATION_MODE=pending_approval`, optionally `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM`.
      The deploy fails at boot if a required one is missing or too short (this is intended).
- [ ] **Never** add `MIGRATION_DATABASE_URL` or `TEST_DATABASE_URL` to Vercel.
- [ ] Use a separate Vercel project + Supabase project for **staging**; never point staging at production data.
- [ ] Custom domain with HTTPS; the app also sends HSTS.

### Supabase (production project)
- [ ] Run `migrations/0001_deny_by_default.sql` in the SQL editor (review first; it deletes nothing).
- [ ] `ALTER ROLE app_runtime PASSWORD '<long random>'` in the SQL editor (type it there only).
- [ ] Point Vercel `DATABASE_URL` at the **transaction pooler (6543)** with user `app_runtime.<project-ref>`.
- [ ] Verify (read-only): `PGURL=<owner url> CONFIRM_PROD_ACCESS=I_UNDERSTAND node scripts/db-security-check.mjs` → `ALL CHECKS PASSED`.
- [ ] Apply schema changes: `MIGRATION_DATABASE_URL=<owner url> CONFIRM_PROD_WRITE=I_UNDERSTAND ADMIN_PASSWORD=<strong> npm run db:push`
      (additive only; re-runnable).
- [ ] Backups: enable daily backups / PITR for the plan; note the retention.

### First admin login after this release
- [ ] Log in → you are redirected to `/account/mfa` → scan QR → **store the 8 recovery codes offline**.
- [ ] Change the bootstrap admin password from the profile (10+ chars, letters+digits).

## B. Every deploy
- [ ] CI green (lint, typecheck, tests, build, `npm audit --omit=dev --audit-level=high`, HTTP security check, PostgreSQL concurrency job).
- [ ] `npm run check:http` locally if CI is unavailable.
- [ ] Schema changes are additive and were pushed with `db:push` **before** the code deploy.
- [ ] After deploy: open `/login`, `/campaigns`, one `/go/<code>` (expect the challenge page), `/admin` (expect MFA prompt).
- [ ] `curl -I https://www.<domain>/login` shows `content-security-policy`, `strict-transport-security`, `x-frame-options: DENY`, no `x-powered-by`.

## C. Rollback
- Vercel → Deployments → promote the previous deployment (instant).
- Schema changes are additive; old code keeps working against the new schema.
- If a secret rotation caused the incident, restore the previous value and redeploy.

## D. Backups and restore drill (quarterly)
1. Create a Supabase backup / take a `pg_dump` with the owner connection.
2. Restore into a **fresh** test project; run `scripts/db-security-check.mjs` and `npm run test:pg` against it.
3. Record: date, size, time-to-restore, who verified.

## E. Monitoring & alerts (recommended minimum)
- Vercel: function errors and 5xx rate alert; log drains to your provider.
- Supabase: connection count, slow queries, disk; alert on pooler saturation.
- Application: watch `mail_outbox.status='failed'`, `clicks.reject_reason='ip_unverified'` backlog,
  `admin_actions` for unexpected `results_correct`/`participant_exclude`, and login rate-limit hits
  (`rate_limits` keys `login:*`).
- Uptime check on `/campaigns` (DB-touching) every minute.

## F. Local PostgreSQL for the concurrency proof
```bash
docker run --name ca-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=creators_arena_test -p 5433:5432 -d postgres:16
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/creators_arena_test npm run test:pg
```

## G. Things the code cannot do for you
- Approve creators (Admin → creators → "اعتماد الحساب") when `REGISTRATION_MODE=pending_approval`.
- Confirm results after reviewing pending clicks (campaign page → "تثبيت النتائج"); only then can prizes be approved/paid.
- Keep recovery codes and the owner connection string in a password manager, not in files.
- Review `mail_outbox` if e-mails are not arriving; with `MAIL_PROVIDER=log` nothing is delivered (development only).
