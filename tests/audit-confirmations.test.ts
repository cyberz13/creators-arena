// Audit-only reproductions: PASS means the reported unsafe behavior exists.
// All data is synthetic, SQLite is in memory, and external callbacks are disabled.
import { beforeEach, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { freshDb, adminId, makeCampaign, makeCreator, visitor } from './helpers';
import { joinCampaign, finalizeCampaign, getParticipant } from '@/services/campaigns';
import { recordClick, reviewClick } from '@/services/tracking';
import { getLeaderboard } from '@/services/leaderboard';
import { getSessionUser } from '@/lib/auth';
import { q, one, run } from '@/lib/db';
import { GET } from '@/app/go/[code]/route';

const cookieState = vi.hoisted(() => ({ token: '' }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: cookieState.token }) }) }));
vi.mock('next/server', async (load) => ({ ...(await load<object>()), after: () => {} }));

beforeEach(() => { freshDb(); cookieState.token = ''; });
const hit = (code: string, t = Date.now(), extra = {}) => recordClick({code, ...visitor(), referer: null, utmSource: null, nowMs: t, ...extra});

it('A01: reflected code executes harmless JavaScript in the generated challenge', async () => {
  const code = 'x");globalThis.__auditXss=1;//';
  const res = await GET(new NextRequest('http://localhost/go/' + encodeURIComponent(code), {
    headers: { 'user-agent': visitor().userAgent, 'x-forwarded-for': '127.0.0.1' }
  }), { params: Promise.resolve({ code }) });
  const html = await res.text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  const ctx: Record<string, unknown> = {
    performance: { now: () => 0 }, addEventListener: () => {},
    screen: { width: 1, height: 1, colorDepth: 24 }, navigator: {},
    window: {}, document: {}, location: { replace: () => {} },
    setTimeout: (fn: () => void) => fn(),
  };
  runInNewContext(script, ctx, { timeout: 1000 });
  expect(res.status).toBe(200);
  expect(ctx.__auditXss).toBe(1);
});

it('A02: missing SESSION_SECRET accepts a forged admin session', async () => {
  vi.stubEnv('SESSION_SECRET', undefined);
  const target = await adminId();
  cookieState.token = await new SignJWT({ sub: target }).setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1m').sign(new TextEncoder().encode('dev-secret-change-in-production'));
  expect((await getSessionUser())?.role).toBe('admin');
  vi.unstubAllEnvs();
});

it('A03: the same challenge token qualifies twice without executing browser JS', async () => {
  const c = await makeCampaign(); const u = await makeCreator(); const link = await joinCampaign(c.id, u);
  const headers = { 'user-agent': visitor().userAgent, 'x-forwarded-for': '127.0.0.1', 'sec-fetch-mode': 'navigate' };
  const initial = await GET(new NextRequest('http://localhost/go/' + link.code, {headers}), {params: Promise.resolve({code: link.code})});
  const token = (await initial.text()).match(/\?t=([^&]+)/)![1];
  for (const fp of ['device-a', 'device-b']) {
    const counted = await GET(new NextRequest(`http://localhost/go/${link.code}?t=${token}&fp=${fp}&wd=0`, {headers}), {params: Promise.resolve({code: link.code})});
    expect(counted.status).toBe(302);
  }
  expect((await getParticipant(c.id, u))!.qualified_count).toBe(2);
});

it('A04: review after finalization changes the leader but leaves the prize assigned to the old winner', async () => {
  const c = await makeCampaign(); const a = await makeCreator('a_creator'); const b = await makeCreator('b_creator');
  const la = await joinCampaign(c.id, a); const lb = await joinCampaign(c.id, b);
  await hit(la.code); await hit(lb.code, Date.now(), {hasSecFetch: false}); await hit(lb.code, Date.now(), {hasSecFetch: false});
  await finalizeCampaign(c.id);
  const pending = await q<{id:string}>("SELECT id FROM clicks WHERE status='pending_review'");
  for (const k of pending) await reviewClick(k.id, 'qualified', await adminId(), 'audit');
  expect((await getLeaderboard(c.id))[0].user_id).toBe(b);
  expect((await one<{user_id:string}>('SELECT user_id FROM payouts WHERE campaign_id=?',c.id))!.user_id).toBe(a);
});

it('A05: approving an old click replaces the latest timestamp and flips a tie incorrectly', async () => {
  const c = await makeCampaign(); const a = await makeCreator('a_creator'); const b = await makeCreator('b_creator');
  const la = await joinCampaign(c.id,a); const lb = await joinCampaign(c.id,b); const t=Date.now();
  await hit(la.code,t,{hasSecFetch:false}); await hit(lb.code,t+10); await hit(lb.code,t+20); await hit(la.code,t+30);
  const pending=(await one<{id:string}>("SELECT id FROM clicks WHERE status='pending_review'"))!;
  await reviewClick(pending.id,'qualified',await adminId(),'audit');
  expect((await getParticipant(c.id,a))!.last_qualified_at).toBe(t);
  expect((await getLeaderboard(c.id))[0].user_id).toBe(a); // should be b: b reached 2 at t+20, a at t+30
});

it('A06: rejecting the latest click does not restore the previous qualifying time', async () => {
  const c = await makeCampaign(); const a = await makeCreator(); const l = await joinCampaign(c.id,a); const t=Date.now();
  await hit(l.code,t); await hit(l.code,t+100);
  const k=(await one<{id:string}>('SELECT id FROM clicks ORDER BY created_at DESC LIMIT 1'))!;
  await reviewClick(k.id,'rejected',await adminId(),'audit');
  expect((await getParticipant(c.id,a))!.last_qualified_at).toBe(t+100); // should be t
});

it('A07: finalization leaves participant 101 without a final rank', async () => {
  const c=await makeCampaign();
  for(let i=0;i<101;i++) await joinCampaign(c.id,await makeCreator());
  await finalizeCampaign(c.id);
  expect((await one<{n:number}>('SELECT COUNT(*) AS n FROM campaign_participants WHERE final_rank IS NULL'))!.n).toBe(1);
});

it('A08: disabled creators continue collecting qualified clicks and winning', async () => {
  const c=await makeCampaign(); const u=await makeCreator(); const l=await joinCampaign(c.id,u);
  await run("UPDATE users SET status='disabled' WHERE id=?",u);
  expect((await hit(l.code)).status).toBe('qualified');
  await finalizeCampaign(c.id);
  expect((await one<{user_id:string}>('SELECT user_id FROM payouts'))!.user_id).toBe(u);
});
