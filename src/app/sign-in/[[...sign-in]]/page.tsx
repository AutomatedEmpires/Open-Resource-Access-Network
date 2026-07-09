import { SignIn } from '@clerk/nextjs';

export const metadata = {
  title: 'Sign in — ORAN',
};

export default function Page() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <SignIn signUpUrl="/sign-up" />
    </main>
  );
}
