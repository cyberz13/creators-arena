import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic, Space_Grotesk } from "next/font/google";
import "./globals.css";

const arabicFont = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-arabic",
  display: "swap",
});

// Brand Latin face — no Arabic glyphs, so Arabic text falls through to IBM Plex
const latinFont = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-latin",
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
    <html lang="ar" dir="rtl" className={`${arabicFont.variable} ${latinFont.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
