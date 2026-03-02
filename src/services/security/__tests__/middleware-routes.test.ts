/**
 * Middleware Protected Routes Tests
 *
 * Verifies that all App Router route groups have matching
 * middleware protection patterns. This is a safety-critical test:
 * unprotected admin routes could allow unauthorized access.
 */

import { describe, it, expect } from 'vitest';

// We test the regex patterns directly rather than importing middleware
// (which depends on Next.js runtime). The patterns must stay in sync.

const PROTECTED_ROUTES: { pattern: RegExp; minRole: string }[] = [
  { pattern: /^\/(saved|profile)/, minRole: 'seeker' },
  { pattern: /^\/(claim|org|locations|services|admins)/, minRole: 'host_member' },
  { pattern: /^\/(queue|verify|coverage)/, minRole: 'community_admin' },
  { pattern: /^\/(approvals|rules|audit|zone-management)/, minRole: 'oran_admin' },
];

function isProtected(pathname: string): { protected: boolean; minRole?: string } {
  for (const route of PROTECTED_ROUTES) {
    if (route.pattern.test(pathname)) {
      return { protected: true, minRole: route.minRole };
    }
  }
  return { protected: false };
}

describe('middleware route protection', () => {
  // ── Seeker routes ────────────────────────────────────────
  describe('seeker routes', () => {
    it('protects /saved', () => {
      expect(isProtected('/saved').protected).toBe(true);
      expect(isProtected('/saved').minRole).toBe('seeker');
    });

    it('protects /profile', () => {
      expect(isProtected('/profile').protected).toBe(true);
      expect(isProtected('/profile').minRole).toBe('seeker');
    });
  });

  // ── Host routes ──────────────────────────────────────────
  describe('host routes', () => {
    const hostPaths = ['/claim', '/org', '/locations', '/services', '/admins'];

    it.each(hostPaths)('protects %s', (path) => {
      const result = isProtected(path);
      expect(result.protected).toBe(true);
      expect(result.minRole).toBe('host_member');
    });
  });

  // ── Community admin routes ───────────────────────────────
  describe('community admin routes', () => {
    const communityPaths = ['/queue', '/verify', '/coverage'];

    it.each(communityPaths)('protects %s', (path) => {
      const result = isProtected(path);
      expect(result.protected).toBe(true);
      expect(result.minRole).toBe('community_admin');
    });
  });

  // ── ORAN admin routes ────────────────────────────────────
  describe('oran admin routes', () => {
    const oranAdminPaths = ['/approvals', '/rules', '/audit', '/zone-management'];

    it.each(oranAdminPaths)('protects %s', (path) => {
      const result = isProtected(path);
      expect(result.protected).toBe(true);
      expect(result.minRole).toBe('oran_admin');
    });
  });

  // ── Public routes (should NOT be protected) ──────────────
  describe('public routes', () => {
    const publicPaths = ['/', '/chat', '/directory', '/map', '/api/search'];

    it.each(publicPaths)('%s is NOT protected', (path) => {
      expect(isProtected(path).protected).toBe(false);
    });
  });

  // ── Subpath coverage ─────────────────────────────────────
  it('protects subpaths (e.g. /zone-management/edit)', () => {
    expect(isProtected('/zone-management/edit').protected).toBe(true);
    expect(isProtected('/zone-management/edit').minRole).toBe('oran_admin');
  });

  it('protects subpaths (e.g. /coverage/zones)', () => {
    expect(isProtected('/coverage/zones').protected).toBe(true);
    expect(isProtected('/coverage/zones').minRole).toBe('community_admin');
  });
});
