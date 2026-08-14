'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  InstalledDataView as InstalledDataViewDefinition,
  InstalledUiElement,
} from '@/lib/modules/types';
import { LoadingSkeleton } from '@/components/shared/loading-skeleton';

async function loadModuleData(moduleSlug: string, endpoint: string, connectionProfileId?: string | null): Promise<unknown> {
  const response = await fetch(
    `/api/modules/${encodeURIComponent(moduleSlug)}/${endpoint.split('/').map(encodeURIComponent).join('/')}`,
    connectionProfileId ? { headers: { 'x-nad-connection-profile': connectionProfileId } } : undefined,
  );
  const result = await response.json() as { data?: unknown; error?: string };
  if (!response.ok) throw new Error(result.error ?? 'Plugin data could not be loaded.');
  return result.data;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function toneClass(value: unknown): string {
  if (value === 'critical' || value === 'error' || value === 'offline') return 'text-destructive';
  if (value === 'warning' || value === 'degraded') return 'text-amber-500';
  if (value === 'ok' || value === 'online' || value === 'healthy') return 'text-emerald-500';
  return 'text-foreground';
}

function DeclarativeElements({ elements, data }: { elements: InstalledUiElement[]; data: unknown }): React.JSX.Element {
  return (
    <div className="space-y-4">
      {elements.map((element, index) => {
        if (element.type === 'section') {
          return (
            <section key={index} className="space-y-3">
              {element.title ? <h3 className="text-sm font-medium">{element.title}</h3> : null}
              <DeclarativeElements elements={element.body} data={data} />
            </section>
          );
        }
        if (element.type === 'metric' || element.type === 'status') {
          const value = valueAtPath(data, element.valuePath);
          const tone = element.tonePath ? valueAtPath(data, element.tonePath) : value;
          return (
            <div key={index} className="inline-flex min-w-28 flex-col border-l border-border/70 pl-3 pr-5">
              <span className="text-xs text-muted-foreground">{element.label}</span>
              <span className={`mt-1 text-lg font-semibold ${toneClass(tone)}`}>
                {displayValue(value)}{element.type === 'metric' && element.unit ? ` ${element.unit}` : ''}
              </span>
            </div>
          );
        }
        if (element.type === 'text') {
          return <p key={index} className="text-sm leading-6">{element.value ?? displayValue(valueAtPath(data, element.valuePath ?? ''))}</p>;
        }
        if (element.type === 'keyValue') {
          return (
            <dl key={index} className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
              {element.items.map((item) => (
                <div key={item.label} className="flex items-baseline justify-between gap-4 border-b border-border/45 py-2">
                  <dt className="text-xs text-muted-foreground">{item.label}</dt>
                  <dd className="max-w-[65%] truncate text-sm font-medium">
                    {displayValue(valueAtPath(data, item.valuePath))}{item.unit ? ` ${item.unit}` : ''}
                  </dd>
                </div>
              ))}
            </dl>
          );
        }
        const rowValue = valueAtPath(data, element.rowsPath);
        const rows = Array.isArray(rowValue)
          ? rowValue.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
          : [];
        if (!rows.length) return <p key={index} className="py-8 text-center text-sm text-muted-foreground">{element.emptyText ?? 'No rows returned.'}</p>;
        return (
          <div key={index} className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground"><tr>{element.columns.map((column) => (
                <th key={column.key} className="border-b border-border/60 px-2 py-2 font-medium">{column.label}</th>
              ))}</tr></thead>
              <tbody>{rows.slice(0, 50).map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-border/35 last:border-0">
                  {element.columns.map((column) => (
                    <td key={column.key} className={`max-w-56 truncate px-2 py-2 ${column.valuePath === 'status' ? toneClass(valueAtPath(row, column.valuePath)) : ''}`}>
                      {displayValue(valueAtPath(row, column.valuePath))}
                    </td>
                  ))}
                </tr>
              ))}</tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function objectRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const candidate of ['items', 'hosts', 'rows', 'metrics']) {
      if (Array.isArray(record[candidate])) return objectRows(record[candidate]);
    }
  }
  return [];
}

export function InstalledDataView({
  moduleSlug,
  view,
  compact = false,
  connectionProfileId,
}: {
  moduleSlug: string;
  view: InstalledDataViewDefinition;
  compact?: boolean;
  connectionProfileId?: string | null;
}): React.JSX.Element {
  const query = useQuery({
    queryKey: ['module', moduleSlug, view.endpoint, connectionProfileId ?? 'default'],
    queryFn: () => loadModuleData(moduleSlug, view.endpoint, connectionProfileId),
    retry: false,
    refetchInterval: (currentQuery) => currentQuery.state.status === 'error'
      ? false
      : view.refreshInterval,
  });
  if (query.isLoading) return <LoadingSkeleton className={compact ? 'min-h-24' : 'min-h-48'} />;
  if (query.isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/8 p-3 text-sm">
        <p role="alert" className="text-destructive">{query.error.message}</p>
        <button
          type="button"
          className="mt-2 rounded-sm font-medium text-destructive underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => void query.refetch()}
        >
          Try again
        </button>
      </div>
    );
  }

  const data = query.data;
  if (view.body?.length) return <DeclarativeElements elements={view.body} data={data} />;
  const rows = objectRows(data);
  if ((view.type === 'table' || view.type === 'status-list' || view.type === 'metrics') && rows.length) {
    const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, compact ? 4 : 8);
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>{columns.map((column) => <th key={column} className="border-b border-border/60 px-2 py-2 font-medium">{column}</th>)}</tr>
          </thead>
          <tbody>{rows.slice(0, compact ? 8 : 50).map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-border/35 last:border-0">
              {columns.map((column) => <td key={column} className="max-w-56 truncate px-2 py-2">{displayValue(row[column])}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
    );
  }
  if (view.type === 'key-value' || view.type === 'metrics') {
    const record = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
    const entries = Object.entries(record);
    if (entries.length) {
      return <dl className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">{entries.slice(0, compact ? 8 : 24).map(([key, value]) => (
        <div key={key} className="flex items-baseline justify-between gap-4 border-b border-border/45 py-2">
          <dt className="text-xs text-muted-foreground">{key}</dt>
          <dd className="max-w-[65%] truncate text-sm font-medium">{displayValue(value)}</dd>
        </div>
      ))}</dl>;
    }
  }
  if (data === null || data === undefined || (Array.isArray(data) && data.length === 0)) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{view.emptyMessage ?? 'No data returned.'}</p>;
  }
  return <pre className="max-h-96 overflow-auto rounded-lg bg-secondary/45 p-3 text-xs leading-5">{JSON.stringify(data, null, 2)}</pre>;
}
