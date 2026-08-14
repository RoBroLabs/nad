import type { DefaultSession } from 'next-auth';
import type { UserRole } from '@/lib/modules/types';

declare module 'next-auth' {
  interface User {
    authVersion: number;
    role: UserRole;
  }

  interface Session {
    user: DefaultSession['user'] & {
      id: string;
      role: UserRole;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    authVersion?: number;
    userId?: string;
    role?: UserRole;
  }
}
