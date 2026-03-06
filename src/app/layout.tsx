import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { resolveLocale } from "@/lib/locale";
import { isRTL } from "@/services/i18n/i18n";

// ============================================================
// FONTS
// ============================================================

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

// ============================================================
// SITE-WIDE METADATA
// ============================================================

const BASE_URL = "https://openresourceaccessnetwork.com";

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    template: "%s | ORAN",
    default: "ORAN — Open Resource Access Network",
  },
  description:
    "Find verified government, nonprofit, and community services near you. No hallucinated results — real, confirmed information only.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: BASE_URL,
    siteName: "ORAN — Open Resource Access Network",
    title: "ORAN — Open Resource Access Network",
    description:
      "Find verified government, nonprofit, and community services near you.",
  },
  twitter: {
    card: "summary",
    title: "ORAN — Open Resource Access Network",
    description:
      "Find verified government, nonprofit, and community services near you.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

/** Viewport — NEVER set maximumScale or userScalable (accessibility requirement) */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// ============================================================
// LAYOUT
// ============================================================

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await resolveLocale();
  const dir = isRTL(locale) ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir} className={inter.variable} suppressHydrationWarning>
      <body className="antialiased font-sans">
        {/* Theme init — runs synchronously before paint to avoid flash.
             Reads oran-theme from localStorage; falls back to OS preference. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script
          dangerouslySetInnerHTML={{
            // biome-ignore lint: intentionally using dangerouslySetInnerHTML for blocking init
            __html: `try{var t=localStorage.getItem('oran-theme');if(t==='dark'||(t===null&&matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}`,
          }}
        />
        {/* Skip to main content — WCAG 2.4.1: must be first focusable element */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:z-[var(--z-skip-link)] focus:top-2 focus:left-2 focus:bg-action-base focus:text-white focus:px-4 focus:py-2 focus:rounded-md focus:text-sm focus:font-medium focus:shadow-lg"
        >
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

