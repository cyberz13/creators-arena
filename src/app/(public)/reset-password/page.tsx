import Link from "next/link";
import { Card } from "@/components/ui/card";
import { ResetForm } from "./reset-form";

export const metadata = { title: "تعيين كلمة مرور جديدة" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="mx-auto max-w-md px-4 py-14">
      <Card className="p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-white">كلمة مرور جديدة</h1>
        {!token ? (
          <p className="mt-3 text-sm text-red-300">
            الرابط ناقص — <Link href="/forgot-password" className="font-bold text-brand-400">اطلب رابطًا جديدًا</Link>.
          </p>
        ) : (
          <ResetForm token={token} />
        )}
      </Card>
    </div>
  );
}
