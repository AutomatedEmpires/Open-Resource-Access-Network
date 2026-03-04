import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased font-sans">
        {/* Skip to main content — WCAG 2.4.1: must be first focusable element */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:z-[100] focus:top-2 focus:left-2 focus:bg-blue-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-md focus:text-sm focus:font-medium focus:shadow-lg"
        >
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

