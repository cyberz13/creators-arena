import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { requireAdmin } from "@/lib/auth";
import { one } from "@/lib/db";
import { beginMfaEnrollment } from "@/services/mfa";
import { Card } from "@/components/ui/card";
import type { User } from "@/lib/types";
import { EnrollForm } from "./enroll-form";

export const metadata = { title: "تفعيل المصادقة الثنائية" };
export const dynamic = "force-dynamic";

/**
 * Mandatory MFA enrolment for admins. Lives outside the admin layout so the
 * admin guard can send unenrolled admins here without a redirect loop.
 */
export default async function MfaEnrollPage() {
  const admin = await requireAdmin({ allowUnenrolled: true });
  if (admin.mfaEnabled) redirect("/admin");
  const row = (await one<User>("SELECT * FROM users WHERE id = ?", admin.id))!;
  const { secret, uri } = await beginMfaEnrollment(row);
  const svg = await QRCode.toString(uri, { type: "svg", margin: 1, width: 200 });

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <Card className="p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-white">🔐 تفعيل المصادقة الثنائية</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          حساب الأدمن يتطلب رمزًا من تطبيق مصادقة (Google Authenticator, Authy, 1Password…) عند كل دخول.
          امسح الرمز أو أدخل المفتاح يدويًا، ثم أكّد برمز من التطبيق.
        </p>
        <div className="mt-6 flex flex-col items-center gap-4 rounded-2xl bg-white p-4 sm:flex-row sm:items-start">
          <div className="size-[200px] shrink-0" dangerouslySetInnerHTML={{ __html: svg }} />
          <div className="text-sm text-zinc-700">
            <p className="font-semibold">المفتاح اليدوي:</p>
            <code dir="ltr" className="mt-1 block break-all rounded bg-zinc-100 p-2 text-xs">{secret}</code>
            <p className="mt-2 text-xs text-zinc-500">الحساب: {admin.email}</p>
          </div>
        </div>
        <EnrollForm />
      </Card>
    </div>
  );
}
