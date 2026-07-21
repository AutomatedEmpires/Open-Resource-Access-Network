import { clerk } from '@clerk/testing/playwright';
import { test, type Page } from '@playwright/test';

type OranRole = 'seeker' | 'host_member' | 'host_admin' | 'community_admin' | 'oran_admin';

const ROLE_EMAIL_ENV: Record<OranRole, string> = {
  seeker: 'ORAN_E2E_SEEKER_EMAIL',
  host_member: 'ORAN_E2E_HOST_MEMBER_EMAIL',
  host_admin: 'ORAN_E2E_HOST_ADMIN_EMAIL',
  community_admin: 'ORAN_E2E_COMMUNITY_ADMIN_EMAIL',
  oran_admin: 'ORAN_E2E_ORAN_ADMIN_EMAIL',
};

function getEmailEnvName(role: OranRole, requestedIdentity: string): string {
  if (role === 'oran_admin' && requestedIdentity.toLowerCase().includes('approver')) {
    return 'ORAN_E2E_ORAN_ADMIN_ALT_EMAIL';
  }
  return ROLE_EMAIL_ENV[role];
}

/**
 * Authenticates with a pre-provisioned Clerk development user whose ORAN role
 * is stored in user_profiles. Identity and authorization remain separate: the
 * helper never injects a role claim or creates an application password.
 */
export async function loginAs(
  page: Page,
  role: OranRole,
  requestedIdentity = `e2e-${role}`,
): Promise<void> {
  const emailEnvName = getEmailEnvName(role, requestedIdentity);
  const emailAddress = process.env[emailEnvName]?.trim();
  const clerkSecret = process.env.CLERK_SECRET_KEY?.trim();
  const clerkPublishable = (
    process.env.CLERK_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  )?.trim();

  if (!emailAddress || !clerkSecret || !clerkPublishable) {
    test.skip(
      true,
      `Clerk E2E auth requires ${emailEnvName}, CLERK_SECRET_KEY, and a Clerk publishable key.`,
    );
    return;
  }

  await page.goto('/');
  await clerk.signOut({ page }).catch(() => undefined);
  await clerk.signIn({ page, emailAddress });

  const response = await page.request.get('/api/auth/context');
  if (!response.ok()) {
    throw new Error(`Clerk sign-in succeeded but ORAN auth context returned ${response.status()}.`);
  }

  const context = (await response.json()) as {
    userId?: unknown;
    role?: unknown;
    accountStatus?: unknown;
  };
  const hasUserId = typeof context.userId === 'string' && context.userId.trim().length > 0;
  if (!hasUserId || context.role !== role || context.accountStatus !== 'active') {
    throw new Error(
      `Expected active ORAN role ${role} for ${emailEnvName}; received ${
        typeof context.role === 'string' ? context.role : 'none'
      } (${typeof context.accountStatus === 'string' ? context.accountStatus : 'status unavailable'}).`,
    );
  }
}
