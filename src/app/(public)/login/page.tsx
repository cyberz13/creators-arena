import Link from "next/link";
import { Card } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const metadata = { title: "تسجيل الدخول" };

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-14">
      <Card className="p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-white">أهلًا بعودتك 👋</h1>
        <p className="mt-1 text-sm text-zinc-400">سجّل دخولك لمتابعة تحدياتك</p>
        <LoginForm />
        <p className="mt-5 text-center text-sm text-zinc-400">
          ليس لديك حساب؟{" "}
          <Link href="/register" className="font-bold text-brand-400 hover:text-brand-300">
            انضم كصانع محتوى
          </Link>
        </p>
      </Card>
    </div>
  );
}
