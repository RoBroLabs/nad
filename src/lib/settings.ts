import 'server-only';

import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { appSettings } from '@/lib/db/schema';

export async function getAppName(): Promise<string> {
  const setting = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, 'dashboard_name'))
    .get();
  return setting?.value.trim() || process.env.APP_NAME?.trim() || 'NAD';
}
