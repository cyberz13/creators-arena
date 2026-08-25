import type { Metadata } from "next";
import { Tajawal, Inter } from "next/font/google";
import "./globals.css";

// Nocturne design system faces: Tajawal carries Arabic + Latin, Inter backs it up.
const tajawal = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "700", "800"],
  variable: "--font-tajawal",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "CREATORS ARENA — نافس. اجلب الزيارات. واربح",
    template: "%s | CREATORS ARENA",
  },
  description:
    "شارك في تحديات المتاجر الإلكترونية، نافس صناع المحتوى، واجلب أكبر عدد من الزيارات للفوز بالجوائز.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${tajawal.variable} ${inter.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
