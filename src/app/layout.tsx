import type { Metadata } from "next";
import "./globals.css";
import { AppNav } from "@/components/nav/AppNav";

export const metadata: Metadata = {
  title: "ORAN — Open Resource Access Network",
  description: "Find verified government, nonprofit, and community services near you.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AppNav />
        {children}
      </body>
    </html>
  );
}

