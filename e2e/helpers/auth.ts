import type { Page } from '@playwright/test';

type OranRole = 'seeker' | 'host_member' | 'host_admin' | 'community_admin' | 'oran_admin';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractCsrfFromSignInHtml(html: string): string | null {
  const patterns = [
    /name="csrfToken"\s+type="hidden"\s+value="([^"]+)"/i,
    /name="csrfToken"\s+value="([^"]+)"\s+type="hidden"/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return match[1];
  }

  return null;
}

async function getCsrfTokenFromSignIn(page: Page): Promise<string> {
  const signIn = await page.request.get('/api/auth/signin?callbackUrl=/');
  if (!signIn.ok()) {
    throw new Error(`Failed to load sign-in page for CSRF fallback: ${signIn.status()}`);
  }

  const html = await signIn.text();
  const csrfToken = extractCsrfFromSignInHtml(html);
  if (!csrfToken) {
    throw new Error('CSRF token missing from sign-in page fallback');
  }

  return csrfToken;
}

async function getCsrfToken(page: Page): Promise<string> {
  // The auth route can be rate-limited or briefly unavailable during startup.
  for (let attempt = 1; attempt <= 5; attempt++) {
    let res;
    try {
      res = await page.request.get('/api/auth/csrf');
    } catch (error) {
      if (attempt < 5) {
        await sleep(attempt * 500);
        continue;
      }
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new Error(`Failed to fetch CSRF token: ${message}`);
    }
    if (res.ok()) {
      const json = (await res.json()) as { csrfToken?: string };
      if (!json.csrfToken) {
        throw new Error('CSRF token missing from /api/auth/csrf response');
      }
      return json.csrfToken;
    }

    // Some NextAuth setups do not expose /api/auth/csrf. Fall back to
    // extracting the hidden csrfToken input from the sign-in form.
    if (res.status() === 404) {
      try {
        return await getCsrfTokenFromSignIn(page);
      } catch {
        // Keep retry loop behavior for transient startup races.
      }
    }

    if ((res.status() === 404 || res.status() === 429 || res.status() === 500 || res.status() === 503) && attempt < 5) {
      const retryAfter = Number(res.headers()['retry-after'] ?? '1');
      const backoffMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000;
      await sleep(backoffMs);
      continue;
    }

    throw new Error(`Failed to fetch CSRF token: ${res.status()}`);
  }

  throw new Error('Failed to fetch CSRF token after retries');
}

/**
 * Programmatically authenticates the browser context using the dev-only
 * ORAN test auth provider (enabled via ORAN_TEST_AUTH_ENABLED=1).
 */
export async function loginAs(page: Page, role: OranRole, userId = `e2e-${role}`): Promise<void> {
  const callbackUrl = '/';
  const callbackPaths = ['/api/auth/callback/oran-test', '/api/auth/callback/credentials'] as const;

  for (let attempt = 1; attempt <= 5; attempt++) {
    const csrfToken = await getCsrfToken(page);
    let shouldRetry = false;
    let terminalError: string | null = null;
    let loggedIn = false;
    const attemptNotes: string[] = [];

    for (const callbackPath of callbackPaths) {
      const res = await page.request.post(callbackPath, {
        form: {
          csrfToken,
          callbackUrl,
          userId,
          role,
        },
      });

      // NextAuth typically redirects (302) on successful sign-in.
      if (res.status() === 200 || res.status() === 302) {
        loggedIn = true;
        break;
      }

      const body = await res.text().catch(() => '');
      attemptNotes.push(`${callbackPath} -> ${res.status()} (${body.slice(0, 100)})`);
      if (
        res.status() === 400 &&
        body.includes('This action with HTTP POST is not supported by NextAuth.js')
      ) {
        // Provider callback route mismatch; try the next known callback route.
        continue;
      }

      if (res.status() === 404 || res.status() === 429 || res.status() === 503) {
        shouldRetry = true;
        continue;
      }

      terminalError = `Login failed via ${callbackPath} (${res.status()}): ${body.slice(0, 300)}`;
      break;
    }

    if (loggedIn) {
      break;
    }

    if (terminalError) {
      throw new Error(terminalError);
    }

    if (shouldRetry && attempt < 5) {
      const backoffMs = 1000;
      await sleep(backoffMs);
      continue;
    }

    throw new Error(`Login failed: no supported callback route accepted credentials. ${attemptNotes.join(' | ')}`);
  }

  // Confirm session is set in this browser context. This endpoint can also be rate-limited.
  for (let attempt = 1; attempt <= 5; attempt++) {
    let session;
    try {
      session = await page.request.get('/api/auth/session');
    } catch (error) {
      if (attempt < 5) {
        await sleep(attempt * 500);
        continue;
      }
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new Error(`Failed to read session after login: ${message}`);
    }
    if (session.ok()) {
      const sessionJson = (await session.json()) as { user?: { role?: string } };
      if (sessionJson.user?.role !== role) {
        throw new Error(`Expected session role ${role}, got ${sessionJson.user?.role ?? 'none'}`);
      }
      return;
    }

    if (session.status() === 429 && attempt < 5) {
      const retryAfter = Number(session.headers()['retry-after'] ?? '1');
      const backoffMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000;
      await sleep(backoffMs);
      continue;
    }

    throw new Error(`Failed to read session after login: ${session.status()}`);
  }

  throw new Error('Failed to read session after login after retries');
}
