/**
 * Guards Tests
 *
 * Tests for authorization helper functions.
 */

import { describe, it, expect } from 'vitest';
import { isRoleAtLeast, ROLE_LEVELS } from '../guards';
import type { OranRole } from '@/domain/types';

describe('isRoleAtLeast', () => {
  describe('seeker role', () => {
    it('meets seeker minimum', () => {
      expect(isRoleAtLeast('seeker', 'seeker')).toBe(true);
    });

    it('does not meet host_member minimum', () => {
      expect(isRoleAtLeast('seeker', 'host_member')).toBe(false);
    });

    it('does not meet host_admin minimum', () => {
      expect(isRoleAtLeast('seeker', 'host_admin')).toBe(false);
    });

    it('does not meet community_admin minimum', () => {
      expect(isRoleAtLeast('seeker', 'community_admin')).toBe(false);
    });

    it('does not meet oran_admin minimum', () => {
      expect(isRoleAtLeast('seeker', 'oran_admin')).toBe(false);
    });
  });

  describe('host_member role', () => {
    it('meets seeker minimum', () => {
      expect(isRoleAtLeast('host_member', 'seeker')).toBe(true);
    });

    it('meets host_member minimum', () => {
      expect(isRoleAtLeast('host_member', 'host_member')).toBe(true);
    });

    it('does not meet host_admin minimum', () => {
      expect(isRoleAtLeast('host_member', 'host_admin')).toBe(false);
    });
  });

  describe('host_admin role', () => {
    it('meets seeker minimum', () => {
      expect(isRoleAtLeast('host_admin', 'seeker')).toBe(true);
    });

    it('meets host_member minimum', () => {
      expect(isRoleAtLeast('host_admin', 'host_member')).toBe(true);
    });

    it('meets host_admin minimum', () => {
      expect(isRoleAtLeast('host_admin', 'host_admin')).toBe(true);
    });

    it('does not meet community_admin minimum', () => {
      expect(isRoleAtLeast('host_admin', 'community_admin')).toBe(false);
    });
  });

  describe('community_admin role', () => {
    it('meets all roles up to community_admin', () => {
      expect(isRoleAtLeast('community_admin', 'seeker')).toBe(true);
      expect(isRoleAtLeast('community_admin', 'host_member')).toBe(true);
      expect(isRoleAtLeast('community_admin', 'host_admin')).toBe(true);
      expect(isRoleAtLeast('community_admin', 'community_admin')).toBe(true);
    });

    it('does not meet oran_admin minimum', () => {
      expect(isRoleAtLeast('community_admin', 'oran_admin')).toBe(false);
    });
  });

  describe('oran_admin role', () => {
    it('meets all role minimums', () => {
      const allRoles: OranRole[] = ['seeker', 'host_member', 'host_admin', 'community_admin', 'oran_admin'];
      for (const minRole of allRoles) {
        expect(isRoleAtLeast('oran_admin', minRole)).toBe(true);
      }
    });
  });

  describe('ROLE_LEVELS ordering', () => {
    it('has correct hierarchy ordering', () => {
      expect(ROLE_LEVELS.seeker).toBeLessThan(ROLE_LEVELS.host_member);
      expect(ROLE_LEVELS.host_member).toBeLessThan(ROLE_LEVELS.host_admin);
      expect(ROLE_LEVELS.host_admin).toBeLessThan(ROLE_LEVELS.community_admin);
      expect(ROLE_LEVELS.community_admin).toBeLessThan(ROLE_LEVELS.oran_admin);
    });
  });
});
