import type { Metadata } from 'next';

import OranFormsPageClient from './OranFormsPageClient';

export const metadata: Metadata = {
  title: 'Form Vault',
  description: 'Manage reusable form templates and inspect submission-backed managed forms across ORAN.',
  robots: { index: false, follow: false },
};

export default function OranFormsPage() {
  return <OranFormsPageClient />;
}
