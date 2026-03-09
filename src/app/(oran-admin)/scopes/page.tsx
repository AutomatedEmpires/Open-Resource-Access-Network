import type { Metadata } from 'next';
import ScopesPageClient from './ScopesPageClient';

export const metadata: Metadata = {
  title: 'Scope Center',
  description: 'Manage platform scopes, approvals, and grant decisions for privileged access.',
  robots: { index: false, follow: false },
};

export default function ScopesPage() {
  return <ScopesPageClient />;
}


