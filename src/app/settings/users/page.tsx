import { asc } from 'drizzle-orm';
import { auth } from '@/lib/auth/config';
import { db } from '@/lib/db';
import { userPermissions, users } from '@/lib/db/schema';
import { getAllModules } from '@/lib/modules/registry';
import { safeJsonParse } from '@/lib/utils';
import {
  UsersManager,
  type ManagedUser,
  type PermissionModule,
} from '@/components/settings/users-manager';
import type { UserRole } from '@/lib/modules/types';

export const dynamic = 'force-dynamic';

export default async function UsersSettingsPage(): Promise<React.JSX.Element> {
  const session = await auth();
  const [records, permissionRecords] = await Promise.all([
    db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      canCreatePersonalWorkspaces: users.canCreatePersonalWorkspaces,
      createdAt: users.createdAt,
    }).from(users).orderBy(asc(users.name)).all(),
    db.select().from(userPermissions).all(),
  ]);
  const managedUsers: ManagedUser[] = records.map((user) => ({ ...user, role: user.role as UserRole }));
  const permissions = permissionRecords.reduce<Record<string, Record<string, string[]>>>((result, permission) => {
    result[permission.userId] ??= {};
    result[permission.userId][permission.moduleSlug] = safeJsonParse<string[]>(permission.actions) ?? [];
    return result;
  }, {});
  const modules: PermissionModule[] = getAllModules().map((manifest) => ({
    slug: manifest.slug,
    name: manifest.name,
    permissions: manifest.permissions.map(({ action, label, description }) => ({ action, label, description })),
  }));

  return (
    <UsersManager
      initialUsers={managedUsers}
      modules={modules}
      initialPermissions={permissions}
      currentUserId={session?.user.id ?? ''}
    />
  );
}
