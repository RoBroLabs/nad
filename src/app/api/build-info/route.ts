import { NextResponse } from 'next/server';
import { enforceApiAccessLock } from '@/lib/access';
import { auth } from '@/lib/auth/config';
import { getMarketplaceBaseUrl, getMarketplaceMode } from '@/lib/marketplace/client';
import { getBuildMetadata } from '@/lib/runtime/build-info';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const accessLockBlock = await enforceApiAccessLock(request);
  if (accessLockBlock) return accessLockBlock;

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  let marketplaceUrl: string | null = null;
  let marketplaceConfigurationValid = true;
  try {
    marketplaceUrl = getMarketplaceBaseUrl()?.toString() ?? null;
  } catch {
    marketplaceConfigurationValid = false;
  }

  return NextResponse.json({
    data: {
      ...getBuildMetadata(),
      marketplace: {
        mode: getMarketplaceMode(),
        url: marketplaceUrl,
        configurationValid: marketplaceConfigurationValid,
      },
    },
  }, {
    headers: { 'cache-control': 'no-store' },
  });
}
