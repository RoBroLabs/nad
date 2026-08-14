import bcrypt from 'bcrypt';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import type { UserRole } from '@/lib/modules/types';
import { notify } from '@/lib/notifications';
import {
  consumeRateLimit,
  getClientAddress,
  resetRateLimit,
} from '@/lib/auth/rate-limit';

const DUMMY_PASSWORD_HASH = '$2b$12$dV0pSil84iX0NyP8MmbPseP2DjiHfpG9GAduDkAmGuT.wFuvbM2uC';
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const localCredentialsProvider = Credentials({
  name: 'Email and password',
  credentials: {
    email: { label: 'Email', type: 'email' },
    password: { label: 'Password', type: 'password' },
  },
  async authorize(credentials, request) {
    const email = typeof credentials.email === 'string'
      ? credentials.email.trim().toLowerCase()
      : '';
    const password = typeof credentials.password === 'string'
      ? credentials.password
      : '';

    if (!email || !password || email.length > 320 || password.length > 1_024) return null;

    const rateLimitKey = `login:${getClientAddress(request)}`;
    const rateLimit = consumeRateLimit(rateLimitKey, 10, LOGIN_WINDOW_MS);
    if (!rateLimit.allowed) return null;

    // Notify once per lockout, at the moment the limiter trips — not on every
    // rejected retry. Fire-and-forget: a channel outage must not slow sign-in.
    if (rateLimit.becameBlocked) {
      void notify(
        'Sign-in attempts rate-limited',
        `Repeated failed sign-in attempts from ${getClientAddress(request)} exhausted the login allowance. Further attempts are refused for up to 15 minutes.`,
        'warning',
      ).catch(() => {});
    }

    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .get();

    const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !passwordMatches) {
      return null;
    }

    resetRateLimit(rateLimitKey);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      authVersion: user.authVersion,
      role: user.role as UserRole,
    };
  },
});

// Keep providers in one list so OIDC providers can be added without changing
// authentication callbacks or the rest of the application.
const providers = [localCredentialsProvider];

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.authVersion = user.authVersion;
        token.role = user.role;
      } else if (token.userId) {
        const currentUser = await db
          .select({ authVersion: users.authVersion, role: users.role })
          .from(users)
          .where(eq(users.id, token.userId))
          .get();

        if (!currentUser) return null;
        if (token.authVersion !== currentUser.authVersion) return null;
        token.role = currentUser.role as UserRole;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId ?? token.sub ?? '';
        session.user.role = token.role ?? 'member';
      }

      return session;
    },
  },
});
