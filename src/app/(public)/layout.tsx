/**
 * Public Layout
 *
 * Shared chrome for publicly accessible informational pages
 * (About, Privacy, Terms, Accessibility, Contact, Status, Security, Partnerships).
 * Includes the global nav and AppFooter.
 */

import React from 'react';
import AppNav from '@/components/nav/AppNav';
import { AppFooter } from '@/components/footer';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen bg-[var(--bg-page)]">
      <AppNav />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <AppFooter />
    </div>
  );
}
