import Link from "next/link";
import { Card } from "@/components/ui/card";
import { ForgotForm } from "./forgot-form";

export const metadata = { title: "استعادة كلمة المرور" };

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-14">
      <Card className="p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-white">استعادة كلمة المرور</h1>
        <p className="mt-1 text-sm text-zinc-400">أدخل بريدك وسنرسل لك رابط إعادة التعيين إن كان مسجلًا.</p>
        <ForgotForm />
        <p className="mt-5 text-center text-sm text-zinc-400">
          <Link href="/login" className="font-bold text-brand-400 hover:text-brand-300">العودة لتسجيل الدخول</Link>
        </p>
      </Card>
    </div>
  );
}
