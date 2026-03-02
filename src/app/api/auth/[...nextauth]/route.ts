/**
 * NextAuth.js API Route Handler
 *
 * Wires NextAuth.js into the Next.js App Router.
 * Uses Microsoft Entra ID as the sole authentication provider.
 *
 * See: src/lib/auth.ts for configuration.
 */

import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth';

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
