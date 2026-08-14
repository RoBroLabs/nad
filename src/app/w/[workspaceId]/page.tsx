import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth/config';
import { ensurePersonalWorkspace, getWorkspaceDetail } from '@/lib/workspaces/service';
import { decodeWorkspaceRouteId, workspacePath } from '@/lib/workspaces/route-paths';

export const dynamic = 'force-dynamic';

interface WorkspaceIndexPageProps {
  params: Promise<{ workspaceId: string }>;
}
export default async function WorkspaceIndexPage({ params }: WorkspaceIndexPageProps): Promise<never> {
  const session = await auth();
  if (!session) redirect('/login');
  const { workspaceId: routeWorkspaceId } = await params;
  const workspaceId = decodeWorkspaceRouteId(routeWorkspaceId);
  if (!workspaceId) notFound();
  const workspace = getWorkspaceDetail(session.user.id, workspaceId)
    ?? (ensurePersonalWorkspace(session.user.id)?.id === workspaceId
      ? getWorkspaceDetail(session.user.id, workspaceId)
      : undefined);
  if (!workspace || !workspace.tabs[0]) notFound();
  redirect(workspacePath(workspace.id, workspace.tabs[0].id));
}
