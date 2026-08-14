import type { NextRequest } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { handlers } from '@/lib/auth/config';

export async function GET(request: NextRequest): Promise<Response> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;
  return handlers.GET(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;
  return handlers.POST(request);
}
