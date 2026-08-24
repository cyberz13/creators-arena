import Link from "next/link";
import { Card } from "@/components/ui/card";
import { listCategories } from "@/services/creators";
import { RegisterForm } from "./register-form";

export const metadata = { title: "انضم كصانع محتوى" };
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const categories = await listCategories();
  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      <Card className="p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-white">انضم كصانع محتوى 🚀</h1>
        <p className="mt-1 text-sm text-zinc-400">
          سجّل مجانًا، شارك في التحديات، واربح جوائز نقدية.
        </p>
        <RegisterForm categories={categories} />
        <p className="mt-5 text-center text-sm text-zinc-400">
          لديك حساب؟{" "}
          <Link href="/login" className="font-bold text-brand-400 hover:text-brand-300">
            سجّل دخولك
          </Link>
        </p>
      </Card>
    </div>
  );
}
