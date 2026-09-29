import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { I18nProvider } from "@/i18n/client";
import { getLocale, getT } from "@/i18n/server";
import "./globals.css";

// next/font downloads the font at build time and self-hosts it –
// no request to Google from the visitor's browser (GDPR-friendly).
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: "AppBuilder", description: t.meta.description };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
