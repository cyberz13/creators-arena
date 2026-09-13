# INCIDENT_RESPONSE.md

Keep this short enough to follow under stress. All SQL below is run with the
**owner** connection (`MIGRATION_DATABASE_URL`) in the Supabase SQL editor.
Timestamps in the database are epoch milliseconds.

## 1. Compromised admin account
1. **Contain**: revoke every session — `UPDATE sessions SET revoked_at = (extract(epoch from now())*1000)::bigint WHERE revoked_at IS NULL;`
2. Reset the admin password: `UPDATE users SET password_hash = '<bcrypt hash generated locally>' WHERE role='admin';`
   (generate with `node -e "console.log(require('bcryptjs').hashSync(process.argv[1],10))" '<new password>'`).
3. Force MFA re-enrolment: `UPDATE users SET mfa_enabled = 0, mfa_secret_enc = NULL WHERE role='admin'; DELETE FROM mfa_recovery_codes;`
4. Rotate `SESSION_SECRET`, `CHALLENGE_SECRET`, `MFA_ENCRYPTION_KEY` in Vercel; redeploy.
5. **Assess**: read `admin_actions` since the suspected time — every admin change is logged
   (`SELECT * FROM admin_actions WHERE created_at > <ms> ORDER BY created_at`). Pay special attention to
   `payout_paid`, `results_correct`, `participant_exclude`, `click_correction_*`, `report_token_*`.
6. Reverse illegitimate reviews with a logged correction; payouts marked paid cannot be un-paid in the app — settle manually and record it in `admin_actions` via a logged note.

## 2. Compromised creator account
1. Admin → creators → **disable account** (login and scoring stop immediately) or suspend participation if only fairness is in doubt.
2. `UPDATE sessions SET revoked_at = … WHERE user_id = '<id>'`.
3. Send a password reset from `/forgot-password` once the owner is identified; require e-mail verification.

## 3. Click manipulation suspected
1. Do **not** confirm results for the campaign (keep `results_status = provisional`).
2. Evidence queries (hashed identifiers only — no raw IPs exist):
   - bursts: `SELECT ip_hash, COUNT(*) FROM clicks WHERE campaign_id='…' AND created_at > … GROUP BY 1 ORDER BY 2 DESC LIMIT 20;`
   - device reuse: same for `device_hash`; sessions: `session_id`.
   - signals: `SELECT signals, COUNT(*) FROM clicks WHERE campaign_id='…' GROUP BY 1 ORDER BY 2 DESC;`
     (`wd:1` = automation flag, `cookie:0` = cookie-less, tiny `el` = scripted).
   - network verdicts: `SELECT flags, COUNT(*) FROM ip_intel i JOIN clicks k ON k.ip_hash = i.ip_hash WHERE k.campaign_id='…' GROUP BY 1;`
3. Act with logged tools only: reject clicks in the review screen, **exclude the participant from the campaign** (logged, re-derives results), or suspend participation.
4. Tighten settings if needed (Admin → settings): `max_devices_per_ip_24h`, `review_threshold_24h`, `rate_limit_per_minute`.
5. Confirm results only when the pending queue is empty; every later change is an explicit, logged correction.

## 4. Secret leak (repo, chat, screenshot)
1. Treat the secret as burned; rotate it now (see `SECURITY.md` → rotating secrets).
2. If `DATABASE_URL` leaked: change the `app_runtime` password in Supabase first, then Vercel.
3. If the owner connection leaked: reset the database password in Supabase, re-run `scripts/db-security-check.mjs`.
4. Search the git history and delete the leak (`git filter-repo`), force-push, and invalidate forks/clones you know of.

## 5. Suspicious sign-in activity
- `SELECT key, count, window_start FROM rate_limits WHERE key LIKE 'login:%' ORDER BY count DESC LIMIT 20;`
- Per-IP limits (10/15 min) throttle attackers; per-account limits (20/15 min) are looser on purpose so a victim is not locked out.
- Nothing in the login response reveals whether an account exists.

## 6. Outage / bad deploy
- Roll back in Vercel (previous deployment → promote). Schema changes are additive, so the old build runs on the new schema.
- If the pooler hangs: the driver serializes queries and retries once; check Supabase connection counts and pooler mode (transaction, port 6543).

## 7. After every incident
- Write a short post-mortem: timeline, root cause, what was rotated, what was corrected in results, and which check would have caught it earlier (add it to the tests).
