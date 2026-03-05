import type { Metadata } from 'next';
import AuthErrorPageClient from './AuthErrorPageClient';

export const metadata: Metadata = {
  title: 'Authentication Error',
  robots: { index: false, follow: false },
};

export default function AuthErrorPage() {
  return <AuthErrorPageClient />;
}


