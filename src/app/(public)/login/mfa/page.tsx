import { redirect } from "next/navigation";
import { getPendingMfaSession } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { MfaForm } from "./mfa-form";

export const metadata = { title: "رمز التحقق" };
export const dynamic = "force-dynamic";

export default async function MfaLoginPage() {
  const pending = await getPendingMfaSession();
  if (!pending) redirect("/login");
  return (
    <div className="mx-auto max-w-md px-4 py-14">
      <Card className="p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-white">رمز التحقق 🔐</h1>
        <p className="mt-1 text-sm text-zinc-400">
          أدخل الرمز من تطبيق المصادقة (أو أحد رموز الاستعادة) لإكمال الدخول كأدمن.
        </p>
        <MfaForm />
      </Card>
    </div>
  );
}
