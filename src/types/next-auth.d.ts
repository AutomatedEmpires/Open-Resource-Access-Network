/**
 * NextAuth.js Type Declarations
 *
 * Extends the default NextAuth types to include ORAN-specific fields
 * (role, id) on Session and JWT.
 */

import type { OranRole } from '@/domain/types';
import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: OranRole;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }

  interface User {
    role?: OranRole;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: OranRole;
  }
}
