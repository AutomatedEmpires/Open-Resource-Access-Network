import type { Metadata } from 'next';
import SignInPageClient from './SignInPageClient';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return <SignInPageClient />;
}


