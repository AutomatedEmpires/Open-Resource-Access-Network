import type { Metadata, Viewport } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { CrisisFloatingButton } from "@/components/crisis/CrisisFloatingButton";
import { resolveLocale } from "@/lib/locale";
import { isRTL, getMessages } from "@/services/i18n/i18n";
import { SITE, getSiteVerification } from '@/lib/site';

// ============================================================
// FONTS
// ============================================================

// Manrope keeps dense service information highly legible on small screens.
const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-manrope",
});

// Space Grotesk gives headings a professional, civic-tech character.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-space-grotesk",
});

// ============================================================
// SITE-WIDE METADATA
// ============================================================

export const metadata: Metadata = {
  metadataBase: new URL(SITE.baseUrl),
  title: {
    template: "%s | ORAN",
    default: SITE.title,
  },
  description: SITE.description,
  applicationName: SITE.acronym,
  keywords: [
    'ORAN',
    'Open Resource Access Network',
    'verified services',
    'community services',
    'nonprofit directory',
    'government services',
    'social services',
    'civic technology',
  ],
  alternates: {
    canonical: "/",
  },
  manifest: '/manifest.webmanifest',
  openGraph: {
    type: "website",
    locale: SITE.defaultLocale,
    url: SITE.baseUrl,
    siteName: SITE.title,
    title: SITE.title,
    description: SITE.description,
  },
  twitter: {
    card: "summary",
    title: SITE.title,
    description: SITE.description,
  },
  robots: {
    index: true,
    follow: true,
  },
  verification: getSiteVerification(),
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
  const messages = getMessages(locale);

  return (
    <html lang={locale} dir={dir} className={`${manrope.variable} ${spaceGrotesk.variable}`} suppressHydrationWarning>
      <body className="antialiased font-sans">

        {/* Skip to main content — WCAG 2.4.1: must be first focusable element */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:z-[var(--z-skip-link)] focus:top-2 focus:left-2 focus:bg-action-base focus:text-white focus:px-4 focus:py-2 focus:rounded-md focus:text-sm focus:font-medium focus:shadow-lg"
        >
          Skip to main content
        </a>
        <Providers locale={locale} dir={dir} messages={messages}>
          {children}
          {/* Persistent crisis help FAB — available on every page */}
          <CrisisFloatingButton />
        </Providers>
      </body>
    </html>
  );
}

