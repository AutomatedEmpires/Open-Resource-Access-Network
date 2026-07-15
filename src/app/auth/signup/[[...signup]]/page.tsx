import type { Metadata } from 'next';
import { SignUp } from '@clerk/nextjs';

export const metadata: Metadata = {
  title: 'Create your account',
  robots: { index: false, follow: false },
};

export default function SignUpPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-300 via-blue-800 to-blue-950 px-4 py-8 sm:py-12">
      <div className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/30 bg-white/90 shadow-2xl backdrop-blur-xl lg:grid-cols-2">
        <section className="flex flex-col justify-center bg-gradient-to-br from-blue-950 via-blue-800 to-cyan-600 p-7 text-white sm:p-10">
          <p className="text-xs font-extrabold uppercase tracking-widest text-cyan-100">
            Open Resource Access Network
          </p>
          <h1 className="mt-4 font-display text-3xl font-black tracking-tight sm:text-4xl">
            Build your support profile at your pace.
          </h1>
          <p className="mt-4 text-base font-semibold text-blue-50">
            Building Bridges | Strengthening Communities
          </p>
          <p className="mt-7 max-w-md text-sm leading-6 text-blue-50">
            Start with a secure account. Onboarding explains every optional question before
            anything sensitive is saved, and you can skip details that are not needed today.
          </p>
        </section>
        <section className="flex items-center justify-center bg-gradient-to-br from-white via-slate-100 to-slate-300 p-4 sm:p-8">
          <SignUp
            path="/auth/signup"
            routing="path"
            signInUrl="/auth/signin"
            fallbackRedirectUrl="/onboarding"
            appearance={{
              elements: {
                rootBox: 'w-full',
                cardBox: 'w-full shadow-none',
                card: 'w-full border-0 bg-transparent shadow-none',
                headerTitle: 'text-blue-950 font-black',
                headerSubtitle: 'text-slate-600',
                formButtonPrimary: 'bg-blue-700 hover:bg-blue-800 font-bold shadow-lg',
                footerActionLink: 'text-blue-700 font-bold',
              },
            }}
          />
        </section>
      </div>
    </main>
  );
}
