import type {
  WorkspaceAssignmentSubject,
  WorkspaceKind,
  WorkspaceLayoutItem,
  WorkspaceTabKind,
  WorkspaceWidgetChrome,
  WorkspaceWidgetInstance,
} from '@/lib/workspaces/types';

const slugPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const breakpoints = new Set(['lg', 'md', 'sm', 'xs', 'xxs']);

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
export function parseWorkspaceName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  return name.length > 0 && name.length <= 80 ? name : undefined;
}

export function parseWorkspaceKind(value: unknown): WorkspaceKind | undefined {
  return value === 'personal' || value === 'shared' || value === 'template' ? value : undefined;
}

export function parseWorkspaceTabKind(value: unknown): WorkspaceTabKind | undefined {
  return value === 'grid' || value === 'surface' ? value : undefined;
}

export function parseAssignmentSubject(value: unknown): WorkspaceAssignmentSubject | undefined {
  return value === 'user' || value === 'role' || value === 'all' ? value : undefined;
}

export function parseWidgetChrome(value: unknown): WorkspaceWidgetChrome | undefined {
  return value === 'standard' || value === 'solid' || value === 'frameless' ? value : undefined;
}

function parseLayoutItem(value: unknown, knownInstances: Set<string>): WorkspaceLayoutItem | undefined {
  const item = record(value);
  if (!item || typeof item.i !== 'string' || !knownInstances.has(item.i)) return undefined;
  if (![item.x, item.y, item.w, item.h].every(Number.isInteger)) return undefined;
  const x = item.x as number;
  const y = item.y as number;
  const w = item.w as number;
  const h = item.h as number;
  if (x < 0 || x > 11 || y < 0 || y > 1_000_000 || w < 1 || w > 12 || h < 1 || h > 100) return undefined;
  const result: WorkspaceLayoutItem = { i: item.i, x, y, w, h };
  for (const field of ['minW', 'minH', 'maxW', 'maxH'] as const) {
    const candidate = item[field];
    if (candidate === undefined) continue;
    if (!Number.isInteger(candidate) || (candidate as number) < 1 || (candidate as number) > 100) return undefined;
    result[field] = candidate as number;
  }
  return result;
}

export function parseWorkspaceGrid(value: unknown): {
  widgets: WorkspaceWidgetInstance[];
  layouts: Record<string, WorkspaceLayoutItem[]>;
} | undefined {
  const document = record(value);
  if (!document || !Array.isArray(document.widgets) || document.widgets.length > 100) return undefined;
  const instanceIds = new Set<string>();
  const widgets: WorkspaceWidgetInstance[] = [];
  for (const rawWidget of document.widgets) {
    const widget = record(rawWidget);
    if (
      !widget
      || typeof widget.instanceId !== 'string'
      || !identifierPattern.test(widget.instanceId)
      || instanceIds.has(widget.instanceId)
      || typeof widget.moduleSlug !== 'string'
      || !slugPattern.test(widget.moduleSlug)
      || typeof widget.widgetId !== 'string'
      || !slugPattern.test(widget.widgetId)
    ) return undefined;
    const chrome = widget.chrome === undefined ? 'standard' : parseWidgetChrome(widget.chrome);
    if (!chrome) return undefined;
    const connectionProfileId = widget.connectionProfileId === null || widget.connectionProfileId === undefined
      ? null
      : typeof widget.connectionProfileId === 'string' && identifierPattern.test(widget.connectionProfileId)
        ? widget.connectionProfileId
        : undefined;
    if (connectionProfileId === undefined) return undefined;
    const settings = widget.settings === undefined ? {} : record(widget.settings);
    if (!settings || JSON.stringify(settings).length > 8_192) return undefined;
    instanceIds.add(widget.instanceId);
    widgets.push({
      instanceId: widget.instanceId,
      moduleSlug: widget.moduleSlug,
      widgetId: widget.widgetId,
      connectionProfileId,
      chrome,
      settings,
    });
  }
  const rawLayouts = record(document.layouts);
  if (!rawLayouts) return undefined;
  const layouts: Record<string, WorkspaceLayoutItem[]> = {};
  for (const [breakpoint, rawLayout] of Object.entries(rawLayouts)) {
    if (!breakpoints.has(breakpoint) || !Array.isArray(rawLayout) || rawLayout.length > 100) return undefined;
    const parsed = rawLayout.map((item) => parseLayoutItem(item, instanceIds));
    if (parsed.some((item) => item === undefined)) return undefined;
    const identifiers = parsed.map((item) => item!.i);
    if (new Set(identifiers).size !== identifiers.length) return undefined;
    layouts[breakpoint] = parsed as WorkspaceLayoutItem[];
  }
  return { widgets, layouts };
}
