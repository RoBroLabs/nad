const MAX_WORKSPACE_ROUTE_ID_LENGTH = 256;

export function decodeWorkspaceRouteId(value: string): string | undefined {
  if (!value || value.length > MAX_WORKSPACE_ROUTE_ID_LENGTH * 3) return undefined;
  try {
    const decoded = decodeURIComponent(value);
    if (
      !decoded
      || decoded.length > MAX_WORKSPACE_ROUTE_ID_LENGTH
      || decoded.includes('/')
      || decoded.includes('\0')
    ) return undefined;
    return decoded;
  } catch {
    return undefined;
  }
}

export function workspacePath(workspaceId: string, tabId?: string): string {
  const base = `/w/${encodeURIComponent(workspaceId)}`;
  return tabId ? `${base}/${encodeURIComponent(tabId)}` : base;
}
