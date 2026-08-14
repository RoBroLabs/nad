import { asc } from 'drizzle-orm';
import { auth } from '@/lib/auth/config';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { WorkspaceLibraryManager } from '@/components/settings/workspace-library-manager';
import { getWorkspaceDetail, listWorkspaceLibrary } from '@/lib/workspaces/service';

export const dynamic = 'force-dynamic';

export default async function WorkspaceSettingsPage(): Promise<React.JSX.Element> {
  const session = await auth();
  const userId = session?.user.id ?? '';
  const [userRecords, summaries] = await Promise.all([
    db.select({ id: users.id, name: users.name, email: users.email, role: users.role })
      .from(users)
      .orderBy(asc(users.name))
      .all(),
    Promise.resolve(listWorkspaceLibrary(userId)),
  ]);
  const workspaces = summaries.flatMap(({ id }) => {
    const detail = getWorkspaceDetail(userId, id);
    return detail ? [detail] : [];
  });
  return <WorkspaceLibraryManager initialWorkspaces={workspaces} users={userRecords} />;
}
