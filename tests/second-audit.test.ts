// Review-only probes. PASS demonstrates that the unsafe behavior remains.
// Synthetic in-memory data only; no real email or network-intelligence requests.
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { freshDb, adminId, makeCampaign, makeCreator, visitor } from './helpers';
import { one, run } from '@/lib/db';
import { joinCampaign, finalizeCampaign, getParticipant } from '@/services/campaigns';
import { recordClick, reevaluateIpUnverified } from '@/services/tracking';
import { setSetting } from '@/services/settings';
import { setUserStatus } from '@/services/creators';
import { confirmResults } from '@/services/results';
import { getLeaderboard } from '@/services/leaderboard';
import { listPayouts, updatePayoutStatus } from '@/services/payouts';
import { sendMail } from '@/lib/mailer';
import { emailVerificationRequired } from '@/services/auth';
import { issueChallenge, consumeChallenge } from '@/services/challenges';
import { assertProductionEnv, mfaEncryptionKey } from '@/lib/env';
import { issueSession, resolveSession } from '@/services/sessions';
import { beginMfaEnrollment, completeMfaEnrollment } from '@/services/mfa';
import { totpCode } from '@/lib/totp';
import type { User } from '@/lib/types';

beforeEach(() => { freshDb(); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const hit = (code:string, extra={}) => recordClick({code,...visitor(),referer:null,utmSource:null,...extra});
async function setup() {const c=await makeCampaign();const u=await makeCreator();const l=await joinCampaign(c.id,u);return {c,u,l};}
async function cleanIp(ip:string) {await run('INSERT INTO ip_intel (ip_hash,risky,checked_at) VALUES (?,0,?)',ip,Date.now());}

it('B01 automatic network approval qualifies two duplicates from one visitor',async()=>{
  const {c,u,l}=await setup();await setSetting('ip_intel_enabled',1);
  const identity=visitor();
  expect((await hit(l.code,identity)).status).toBe('pending_review');
  expect((await hit(l.code,identity)).status).toBe('pending_review');
  await cleanIp(identity.ipHash);await reevaluateIpUnverified(identity.ipHash);
  expect((await getParticipant(c.id,u))!.qualified_count).toBe(2);
});

it('B02 automatic network approval skips the missing sec-fetch rule',async()=>{
  const {c,u,l}=await setup();await setSetting('ip_intel_enabled',1);
  const identity=visitor();
  await hit(l.code,{...identity,hasSecFetch:false});
  expect((await one<{reject_reason:string}>('SELECT reject_reason FROM clicks'))!.reject_reason).toBe('ip_unverified');
  await cleanIp(identity.ipHash);await reevaluateIpUnverified(identity.ipHash);
  expect((await getParticipant(c.id,u))!.qualified_count).toBe(1);
});

it('B03 a disabled confirmed winner disappears from standings but can still be marked paid',async()=>{
  const {c,u,l}=await setup();await hit(l.code);
  await finalizeCampaign(c.id);const a=await adminId();await confirmResults(c.id,a);
  const payout=(await listPayouts())[0];await setUserStatus(u,'disabled',a,'audit');
  expect(await getLeaderboard(c.id)).toHaveLength(0);
  await updatePayoutStatus(payout.id,'approved',a);
  await updatePayoutStatus(payout.id,'paid',a,'audit',{reauthenticated:true});
  expect((await listPayouts())[0].status).toBe('paid');
});

it('B04 missing mail provider in production logs reset secrets and marks delivery sent',async()=>{
  vi.stubEnv('NODE_ENV','production');vi.stubEnv('MAIL_PROVIDER',undefined);
  const spy=vi.spyOn(console,'log').mockImplementation(()=>{});
  const marker='SYNTHETIC_RESET_TOKEN_NOT_A_SECRET';
  const result=await sendMail({to:'audit@example.test',subject:'audit',text:'https://example.test/reset-password?token='+marker});
  expect(result.ok).toBe(true);
  expect(spy.mock.calls.some(args=>args.some(s=>String(s).includes(marker)))).toBe(true);
  expect((await one<{status:string}>('SELECT status FROM mail_outbox WHERE id=?',result.id))!.status).toBe('sent');
});

it('B05 configured email verification does not gate joining a campaign',async()=>{
  const c=await makeCampaign();const u=await makeCreator();
  await run('UPDATE users SET email_verified=0 WHERE id=?',u);
  vi.stubEnv('MAIL_PROVIDER','resend');vi.stubEnv('RESEND_API_KEY','synthetic-no-call');vi.stubEnv('MAIL_FROM','audit@example.test');
  expect(emailVerificationRequired()).toBe(true);
  expect(await joinCampaign(c.id,u)).toBeTruthy();
});

it('B06 dropping the visitor cookie bypasses challenge visitor binding',async()=>{
  const token=await issueChallenge('abc1234','synthetic-ip','visitor-a');
  expect(await consumeChallenge(token,'abc1234','synthetic-ip','visitor-b')).toBe('visitor_mismatch');
  expect(await consumeChallenge(token,'abc1234','synthetic-ip',null)).toBe('ok');
});

it('B07 production boot validation misses the mandatory MFA encryption key',()=>{
  vi.stubEnv('NODE_ENV','production');vi.stubEnv('SESSION_SECRET','audit-session-'.padEnd(48,'a'));
  vi.stubEnv('CHALLENGE_SECRET','audit-challenge-'.padEnd(48,'b'));vi.stubEnv('IP_HASH_SALT','audit-ip-salt-'.padEnd(24,'c'));
  vi.stubEnv('NEXT_PUBLIC_APP_URL','https://example.test');vi.stubEnv('REGISTRATION_MODE','open');
  vi.stubEnv('DATABASE_PATH',':memory:');vi.stubEnv('VERCEL',undefined);vi.stubEnv('DATABASE_URL',undefined);
  vi.stubEnv('MFA_ENCRYPTION_KEY',undefined);
  expect(()=>assertProductionEnv()).not.toThrow();
  expect(()=>mfaEncryptionKey()).toThrow(/MFA_ENCRYPTION_KEY/);
});

it('B08 a password-only admin session remains full after another session enables MFA',async()=>{
  const a=await adminId();const user=(await one<User>('SELECT * FROM users WHERE id=?',a))!;
  const old=await issueSession(user,'full');
  const enrollment=await beginMfaEnrollment(user);
  await completeMfaEnrollment(a,totpCode(enrollment.secret));
  const resolved=await resolveSession(old.token);
  expect(resolved!.session.stage).toBe('full');
  expect(Number(resolved!.user.mfa_enabled)).toBe(1);
});
