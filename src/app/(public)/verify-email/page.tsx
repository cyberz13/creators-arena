import Link from "next/link";
import { Card } from "@/components/ui/card";
import { verifyEmailToken } from "@/services/auth";

export const metadata = { title: "تأكيد البريد" };
export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const ok = token ? await verifyEmailToken(token) : false;
  return (
    <div className="mx-auto max-w-md px-4 py-14">
      <Card className="p-6 text-center sm:p-8">
        {ok ? (
          <>
            <h1 className="text-2xl font-bold text-white">✅ تم تأكيد بريدك</h1>
            <p className="mt-2 text-sm text-zinc-400">شكرًا لك — حسابك موثق الآن.</p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-white">رابط غير صالح</h1>
            <p className="mt-2 text-sm text-zinc-400">انتهت صلاحية الرابط أو سبق استخدامه. اطلب رسالة جديدة من صفحة ملفك.</p>
          </>
        )}
        <Link href="/dashboard" className="mt-6 inline-block font-bold text-brand-400 hover:text-brand-300">
          الذهاب إلى لوحتي
        </Link>
      </Card>
    </div>
  );
}
