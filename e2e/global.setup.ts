import { clerkSetup } from '@clerk/testing/playwright';
import { test as setup } from '@playwright/test';

setup.describe.configure({ mode: 'serial' });

setup('configure Clerk testing token', async () => {
  const publishableKey = (
    process.env.CLERK_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  )?.trim();

  if (!publishableKey || !process.env.CLERK_SECRET_KEY?.trim()) {
    return;
  }

  process.env.CLERK_PUBLISHABLE_KEY = publishableKey;
  await clerkSetup();
});
