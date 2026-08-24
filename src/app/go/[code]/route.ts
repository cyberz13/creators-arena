import { NextRequest, NextResponse } from "next/server";
import { recordClick } from "@/services/tracking";
import { hashIp } from "@/services/fraud";

export const dynamic = "force-dynamic";

const VISITOR_COOKIE = "tahaddi_vid";

export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;

  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "0.0.0.0";

  let sessionId = req.cookies.get(VISITOR_COOKIE)?.value;
  const isNewVisitor = !sessionId;
  if (!sessionId || !/^[a-f0-9-]{36}$/.test(sessionId)) sessionId = crypto.randomUUID();

  const url = new URL(req.url);
  const result = await recordClick({
    code,
    ipHash: hashIp(ip),
    sessionId,
    userAgent: req.headers.get("user-agent") ?? "",
    referer: req.headers.get("referer"),
    utmSource: url.searchParams.get("utm_source"),
  });

  if (!result.redirectUrl) {
    return NextResponse.redirect(new URL("/?e=link", req.url), 302);
  }

  const res = NextResponse.redirect(result.redirectUrl, 302);
  if (isNewVisitor) {
    res.cookies.set(VISITOR_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 365 * 24 * 60 * 60,
      path: "/",
    });
  }
  return res;
}
