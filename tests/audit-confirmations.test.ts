// Audit reproductions from the external review (2026-09-12).
// Originally PASS meant "the defect exists"; each case is flipped to assert the
// SAFE behaviour as its fix lands, so the suite keeps the original coverage.
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

it('A01 (fixed): a reflected code is rejected before any HTML is generated, and the challenge page has no inline script', async () => {
  const code = 'x");globalThis.__auditXss=1;//';
  const res = await GET(new NextRequest('http://localhost/go/' + encodeURIComponent(code), {
    headers: { 'user-agent': visitor().userAgent, 'x-forwarded-for': '127.0.0.1' }
  }), { params: Promise.resolve({ code }) });
  const html = await res.text();
  expect(res.status).toBe(404);
  expect(html).not.toContain('__auditXss');
  expect(html).not.toContain('<script');
  const c = await makeCampaign(); const u = await makeCreator(); const link = await joinCampaign(c.id, u);
  const ok = await GET(new NextRequest('http://localhost/go/' + link.code, {
    headers: { 'user-agent': visitor().userAgent, 'x-forwarded-for': '127.0.0.1' }
  }), { params: Promise.resolve({ code: link.code }) });
  const page = await ok.text();
  expect(page.match(/<script>([\s\S]*?)<\/script>/)).toBeNull();
  const ctx: Record<string, unknown> = { performance: { now: () => 0 }, addEventListener: () => {}, screen: {}, navigator: {}, window: {}, document: {}, location: { replace: () => {} }, setTimeout: (fn: () => void) => fn() };
  for (const m of page.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
    runInNewContext('(' + m[1] + ')', ctx, { timeout: 1000 }); // pure data, never code
  }
  expect(ctx.__auditXss).toBeUndefined();
});

it('A02 (fixed): a forged session signed with the old known default is rejected; production refuses to run without a secret', async () => {
  vi.stubEnv('SESSION_SECRET', undefined);
  const target = await adminId();
  cookieState.token = await new SignJWT({ sub: target }).setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1m').sign(new TextEncoder().encode('dev-secret-change-in-production'));
  expect(await getSessionUser()).toBeNull();
  vi.stubEnv('NODE_ENV', 'production');
  expect(await getSessionUser()).toBeNull(); // a ConfigError is never a bypass
  vi.unstubAllEnvs();
});

it('A03 (fixed): the same challenge token counts at most once, whatever identities are presented', async () => {
  const c = await makeCampaign(); const u = await makeCreator(); const link = await joinCampaign(c.id, u);
  const headers = { 'user-agent': visitor().userAgent, 'x-forwarded-for': '127.0.0.1', 'sec-fetch-mode': 'navigate' };
  const initial = await GET(new NextRequest('http://localhost/go/' + link.code, {headers}), {params: Promise.resolve({code: link.code})});
  const html = await initial.text();
  const token = (JSON.parse(html.match(/id="ca-config">([\s\S]*?)<\/script>/)![1]) as { t: string }).t;
  const cookie = /tahaddi_vid=([a-f0-9-]{36})/.exec(initial.headers.get('set-cookie') ?? '')![1];
  for (const fp of ['device-a', 'device-b']) {
    const counted = await GET(new NextRequest(`http://localhost/go/${link.code}?t=${encodeURIComponent(token)}&fp=${fp}&wd=0`, {headers: {...headers, cookie: 'tahaddi_vid=' + cookie}}), {params: Promise.resolve({code: link.code})});
    expect(counted.status).toBe(302);
  }
  expect((await getParticipant(c.id, u))!.qualified_count).toBe(1);
});

it('A04 (fixed): a review after finalization re-derives ranks AND the prize together while results are provisional', async () => {
  const c = await makeCampaign(); const a = await makeCreator('a_creator'); const b = await makeCreator('b_creator');
  const la = await joinCampaign(c.id, a); const lb = await joinCampaign(c.id, b);
  await hit(la.code); await hit(lb.code, Date.now(), {hasSecFetch: false}); await hit(lb.code, Date.now(), {hasSecFetch: false});
  await finalizeCampaign(c.id);
  const pending = await q<{id:string}>("SELECT id FROM clicks WHERE status='pending_review'");
  for (const k of pending) await reviewClick(k.id, 'qualified', await adminId(), 'audit');
  expect((await getLeaderboard(c.id))[0].user_id).toBe(b);
  expect((await one<{user_id:string}>('SELECT user_id FROM payouts WHERE campaign_id=?',c.id))!.user_id).toBe(b);
});

it('A05 (fixed): approving an old click keeps the time the count was reached; the tie resolves in favour of b', async () => {
  const c = await makeCampaign(); const a = await makeCreator('a_creator'); const b = await makeCreator('b_creator');
  const la = await joinCampaign(c.id,a); const lb = await joinCampaign(c.id,b); const t=Date.now();
  await hit(la.code,t,{hasSecFetch:false}); await hit(lb.code,t+10); await hit(lb.code,t+20); await hit(la.code,t+30);
  const pending=(await one<{id:string}>("SELECT id FROM clicks WHERE status='pending_review'"))!;
  await reviewClick(pending.id,'qualified',await adminId(),'audit');
  expect((await getParticipant(c.id,a))!.last_qualified_at).toBe(t+30);
  expect((await getLeaderboard(c.id))[0].user_id).toBe(b); // b reached 2 at t+20, a at t+30
});

it('A06 (fixed): rejecting the latest click restores the previous qualifying time', async () => {
  const c = await makeCampaign(); const a = await makeCreator(); const l = await joinCampaign(c.id,a); const t=Date.now();
  await hit(l.code,t); await hit(l.code,t+100);
  const k=(await one<{id:string}>('SELECT id FROM clicks ORDER BY created_at DESC LIMIT 1'))!;
  await reviewClick(k.id,'rejected',await adminId(),'audit');
  expect((await getParticipant(c.id,a))!.last_qualified_at).toBe(t);
});

it('A07 (fixed): finalization ranks every participant, not just the first 100', async () => {
  const c=await makeCampaign();
  for(let i=0;i<101;i++) await joinCampaign(c.id,await makeCreator());
  await finalizeCampaign(c.id);
  expect((await one<{n:number}>('SELECT COUNT(*) AS n FROM campaign_participants WHERE final_rank IS NULL'))!.n).toBe(0);
});

it('A08 (fixed): disabled creators stop collecting qualified clicks and never win', async () => {
  const c=await makeCampaign(); const u=await makeCreator(); const l=await joinCampaign(c.id,u);
  await run("UPDATE users SET status='disabled' WHERE id=?",u);
  expect((await hit(l.code)).status).toBe('rejected');
  await finalizeCampaign(c.id);
  expect(await one('SELECT user_id FROM payouts')).toBeUndefined();
});
