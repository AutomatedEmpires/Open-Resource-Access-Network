import { SignUp } from '@clerk/nextjs';

export const metadata = {
  title: 'Create your account — ORAN',
};

export default function Page() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <SignUp signInUrl="/sign-in" />
    </main>
  );
}
