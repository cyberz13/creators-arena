import Link from "next/link";

/**
 * Regulatory disclaimer shown wherever a creator receives their tracking link:
 * paid promotion by influencers in Saudi Arabia requires a GCAM "Mawthooq"
 * license — the platform does not bear the consequences of publishing without it.
 */
export function LicenseNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div
      role="note"
      className={`rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-100 ${
        compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"
      }`}
    >
      <p className="font-bold">⚠️ تنبيه نظامي — رخصة «موثوق»</p>
      <p className="mt-1 leading-relaxed text-amber-100/90">
        نشر الروابط الإعلانية في وسائل التواصل الاجتماعي داخل المملكة يتطلب رخصة «موثوق» من الهيئة
        العامة لتنظيم الإعلام. أنت المسؤول الوحيد عن استيفاء هذا الشرط قبل نشر رابطك، والمنصة{" "}
        <strong>لا تتحمل أي مسؤولية</strong> عن نتائج النشر لمن لا يملك الرخصة.{" "}
        {!compact && (
          <Link href="/terms" className="font-semibold text-amber-200 underline underline-offset-2">
            الشروط والأحكام
          </Link>
        )}
      </p>
    </div>
  );
}
