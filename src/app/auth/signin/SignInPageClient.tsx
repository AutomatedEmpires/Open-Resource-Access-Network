/**
 * Custom Sign-in Page
 *
 * Three-path sign-in: Seeker, Organization, and Administration.
 * Three auth methods: Microsoft, Google, or email/password.
 * Each path routes to the correct portal after auth.
 * The middleware enforces RBAC — this page only sets intent/callbackUrl.
 */

'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getProviders, signIn } from 'next-auth/react';
import Link from 'next/link';
import { Search, Building2, ShieldCheck, ArrowLeft, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { FormSection } from '@/components/ui/form-section';

// ============================================================
// PATH DEFINITIONS
// ============================================================

type UserPath = 'seeker' | 'organization' | 'admin';

interface PathOption {
  id: UserPath;
  label: string;
  icon: React.ElementType;
  description: string;
  callbackUrl: string;
  guestAllowed: boolean;
  detail: string;
}

const PATHS: PathOption[] = [
  {
    id: 'seeker',
    label: 'Find Services',
    icon: Search,
    description: 'Looking for help or resources?',
    callbackUrl: '/chat',
    guestAllowed: true,
    detail: 'Search verified community resources, save favorites, and get personalized results.',
  },
  {
    id: 'organization',
    label: 'Organization',
    icon: Building2,
    description: 'Manage your organization?',
    callbackUrl: '/claim',
    guestAllowed: false,
    detail: 'Register your organization or manage your service listings on ORAN.',
  },
  {
    id: 'admin',
    label: 'Administration',
    icon: ShieldCheck,
    description: 'Platform staff?',
    callbackUrl: '/approvals',
    guestAllowed: false,
    detail: 'Community moderation, data verification, and platform management.',
  },
];

/** Detect which path to pre-select from a callbackUrl */
function detectPath(callbackUrl: string | null): UserPath {
  if (!callbackUrl) return 'seeker';
  if (/^\/(claim|org|services|locations|admins)/.test(callbackUrl)) return 'organization';
  if (/^\/(approvals|rules|audit|zone-management|ingestion|triage|queue|verify|coverage|appeals|scopes|templates)/.test(callbackUrl))
    return 'admin';
  return 'seeker';
}

// ============================================================
// ERROR MAP
// ============================================================

const ERROR_MESSAGES: Record<string, string> = {
  OAuthSignin: 'Could not start the sign-in process. Please try again.',
  OAuthCallback: 'There was an error during sign-in. Please try again.',
  OAuthAccountNotLinked: 'This email is already linked to another account.',
  Callback: 'Sign-in failed. Please try again.',
  AccessDenied: 'Access denied. You may not have permission to sign in.',
};

// ============================================================
// PROVIDER LOGOS
// ============================================================

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" className="h-5 w-5" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

// ============================================================
// MAIN CONTENT
// ============================================================

function SignInContent() {
  const searchParams = useSearchParams();
  const originalCallback = searchParams.get('callbackUrl');
  const error = searchParams.get('error');
  const detectedPath = detectPath(originalCallback);
  const [selected, setSelected] = useState<UserPath>(detectedPath);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [providerIds, setProviderIds] = useState<Set<string>>(new Set(['azure-ad']));

  const activePath = PATHS.find((p) => p.id === selected)!;

  // If the user stays on the auto-detected path, preserve the original deep-link.
  // Otherwise use the selected path's default callback.
  const effectiveCallback =
    selected === detectedPath && originalCallback
      ? originalCallback
      : activePath.callbackUrl;

  const errorMessage = error
    ? ERROR_MESSAGES[error] ?? 'An unexpected error occurred. Please try again.'
    : null;

  useEffect(() => {
    let cancelled = false;

    void getProviders()
      .then((providers) => {
        if (cancelled || !providers) {
          return;
        }
        setProviderIds(new Set(Object.keys(providers)));
      })
      .catch(() => {
        if (!cancelled) {
          setProviderIds(new Set(['azure-ad']));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const hasAzureAd = providerIds.has('azure-ad');
  const hasGoogle = providerIds.has('google');
  const hasCredentials = providerIds.has('credentials');

  async function handleEmailSignIn(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    try {
      const result = await signIn('credentials', {
        email,
        password,
        callbackUrl: effectiveCallback,
        redirect: false,
      });

      if (result?.error) {
        setFormError('Invalid email or password. Please try again.');
      } else if (result?.url) {
        window.location.href = result.url;
      }
    } catch {
      setFormError('Sign-in failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setIsSubmitting(true);

    if (password !== confirmPassword) {
      setFormError('Passwords do not match.');
      setIsSubmitting(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, displayName, phone: phone || undefined }),
      });

      const data = await res.json();

      if (!res.ok) {
        setFormError(data.error ?? 'Registration failed. Please try again.');
        return;
      }

      setFormSuccess('Account created! You can now sign in.');
      setIsRegistering(false);
    } catch {
      setFormError('Registration failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="container mx-auto max-w-lg px-4 py-12">
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-8 pt-8 pb-2 text-center">
          <h1 className="text-xl font-bold text-gray-900">Welcome to ORAN</h1>
          <p className="mt-1 text-sm text-gray-700">
            How would you like to use ORAN?
          </p>
        </div>

        {/* Path selector */}
        <div role="radiogroup" aria-label="Account type" className="px-6 pt-4 pb-2">
          <div className="grid grid-cols-3 gap-2">
            {PATHS.map(({ id, label, icon: Icon }) => {
              const isActive = selected === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => setSelected(id)}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border-2 px-3 py-3 text-xs font-medium transition-all min-h-[44px] cursor-pointer ${
                    isActive
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dynamic content area */}
        <div className="px-8 pb-8 pt-4">
          <p className="text-sm text-gray-700 text-center mb-5" data-testid="path-detail">
            {activePath.detail}
          </p>

          {/* Error messages */}
          {errorMessage && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-error-soft bg-error-subtle p-3 text-sm text-error-deep"
            >
              {errorMessage}
            </div>
          )}
          {formError && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {formError}
            </div>
          )}
          {formSuccess && (
            <div
              role="status"
              className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700"
            >
              {formSuccess}
            </div>
          )}

          {/* OAuth sign-in buttons */}
          {!showEmailForm && (
            <div className="space-y-3">
              {hasAzureAd && (
                <Button
                  className="w-full min-h-[44px] text-sm font-medium gap-2"
                  onClick={() => signIn('azure-ad', { callbackUrl: effectiveCallback })}
                >
                  <MicrosoftLogo />
                  Sign in with Microsoft
                </Button>
              )}

              {hasGoogle && (
                <Button
                  variant="outline"
                  className="w-full min-h-[44px] text-sm font-medium gap-2"
                  onClick={() => signIn('google', { callbackUrl: effectiveCallback })}
                >
                  <GoogleLogo />
                  Sign in with Google
                </Button>
              )}

              {hasCredentials && (hasAzureAd || hasGoogle) && (
                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-white px-3 text-gray-500">or</span>
                  </div>
                </div>
              )}

              {hasCredentials && (
                <Button
                  variant="outline"
                  className="w-full min-h-[44px] text-sm font-medium gap-2"
                  onClick={() => setShowEmailForm(true)}
                >
                  <Mail className="h-5 w-5" aria-hidden="true" />
                  Sign in with Email
                </Button>
              )}

              {/* Sign-up discoverability */}
              {hasCredentials && (
                <div className="mt-2 text-center border-t border-gray-100 pt-3">
                  <p className="text-sm text-gray-700">
                    New to ORAN?{' '}
                    <button
                      type="button"
                      onClick={() => { setShowEmailForm(true); setIsRegistering(true); }}
                      className="font-semibold text-blue-600 hover:text-blue-800 underline underline-offset-2 transition-colors"
                    >
                      Create a free account
                    </button>
                  </p>
                </div>
              )}

              {!hasAzureAd && !hasGoogle && !hasCredentials && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                  Sign-in is temporarily unavailable. Contact an ORAN administrator if this persists.
                </p>
              )}
            </div>
          )}

          {/* Email/Password form */}
          {showEmailForm && (
            <form
              onSubmit={isRegistering ? handleRegister : handleEmailSignIn}
              className="space-y-3"
            >
              <FormSection
                title={isRegistering ? 'Create your account' : 'Sign in with email'}
                description={isRegistering ? 'Enter the account details ORAN will use for this sign-in path.' : 'Use your email and password to continue to the selected ORAN experience.'}
              >
                {isRegistering && (
                  <FormField id="displayName" label="Display Name" required>
                    <input
                      id="displayName"
                      type="text"
                      required
                      maxLength={100}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Your name"
                    />
                  </FormField>
                )}

                <FormField id="email" label="Email" required>
                  <input
                    id="email"
                    type="email"
                    required
                    maxLength={255}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="you@example.com"
                  />
                </FormField>

                <FormField id="password" label="Password" required>
                  <input
                    id="password"
                    type="password"
                    required
                    minLength={8}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder={isRegistering ? 'Create a password (8+ characters)' : 'Your password'}
                  />
                </FormField>

                {isRegistering && (
                  <FormField
                    id="confirmPassword"
                    label="Confirm password"
                    required
                    error={confirmPassword.length > 0 && password !== confirmPassword ? 'Passwords must match to create your account.' : undefined}
                  >
                    <input
                      id="confirmPassword"
                      type="password"
                      required
                      minLength={8}
                      maxLength={128}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      aria-invalid={confirmPassword.length > 0 && password !== confirmPassword}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Re-enter your password"
                    />
                  </FormField>
                )}

                {isRegistering && (
                  <FormField id="phone" label="Phone" hint="Optional">
                    <input
                      id="phone"
                      type="tel"
                      maxLength={20}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="(555) 123-4567"
                    />
                  </FormField>
                )}
              </FormSection>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full min-h-[44px] text-sm font-medium"
              >
                {isSubmitting
                  ? 'Please wait...'
                  : isRegistering
                    ? 'Create Account'
                    : 'Sign In'}
              </Button>

              <div className="flex items-center justify-between text-xs pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsRegistering(!isRegistering);
                    setFormError(null);
                    setFormSuccess(null);
                    setConfirmPassword('');
                  }}
                  className="text-blue-600 hover:text-blue-800 transition-colors"
                >
                  {isRegistering ? 'Already have an account? Sign in' : 'Need an account? Register'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowEmailForm(false);
                    setFormError(null);
                    setFormSuccess(null);
                  }}
                  className="text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Back to options
                </button>
              </div>
            </form>
          )}

          {!showEmailForm && (
            <p className="mt-3 text-xs text-gray-600 text-center">
              Secure sign-in. Your credentials are encrypted and never shared.
            </p>
          )}

          {/* Guest path (seekers only) */}
          {activePath.guestAllowed && (
            <div className="mt-5 text-center border-t border-gray-100 pt-4">
              <Link
                href={effectiveCallback}
                className="inline-flex items-center gap-1 text-sm text-gray-700 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Continue without signing in
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Privacy note */}
      <p className="mt-4 text-xs text-gray-600 text-center max-w-sm mx-auto">
        By signing in, you agree to ORAN collecting your name, email, and
        location data to deliver and improve our services.
        See our <Link href="/privacy" className="underline hover:text-gray-600">Privacy Policy</Link> for
        details.
      </p>
    </main>
  );
}

// ============================================================
// EXPORTS
// ============================================================

export { detectPath, PATHS, ERROR_MESSAGES };
export type { UserPath };

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <main className="container mx-auto max-w-lg px-4 py-12">
          <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm text-center">
            <p className="text-gray-500">Loading…</p>
          </div>
        </main>
      }
    >
      <SignInContent />
    </Suspense>
  );
}
