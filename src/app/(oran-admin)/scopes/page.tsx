import type { Metadata } from 'next';
import ScopesPageClient from './ScopesPageClient';

export const metadata: Metadata = { title: 'Scope Center' };

export default function ScopesPage() {
  return <ScopesPageClient />;
}


