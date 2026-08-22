'use client';

import { useQuery } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import type {
  InstalledDataView as InstalledDataViewDefinition,
  InstalledUiElement,
} from '@/lib/modules/types';
import { LoadingSkeleton } from '@/components/shared/loading-skeleton';
import {
  DataTable,
  EmptyNote,
  KeyValueList,
  MetricCell,
  MetricGroup,
  StaleBadge,
  StatusCell,
  displayValue,
  toneName,
  useStaleness,
} from '@/components/modules/declarative/primitives';

async function loadModuleData(moduleSlug: string, endpoint: string, connectionProfileId?: string | null): Promise<unknown> {
  const response = await fetch(
    `/api/modules/${encodeURIComponent(moduleSlug)}/${endpoint.split('/').map(encodeURIComponent).join('/')}`,
    connectionProfileId ? { headers: { 'x-nad-connection-profile': connectionProfileId } } : undefined,
  );
  const result = await response.json() as { data?: unknown; error?: string };
  if (!response.ok) throw new Error(result.error ?? 'Plugin data could not be loaded.');
  return result.data;
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

type MeasureElement = Extract<InstalledUiElement, { type: 'metric' | 'status' }>;

/**
 * Adjacent metrics and statuses are collected into one run so they can share a
 * grid. Declaration order is preserved: a run ends as soon as another element
 * type appears.
 */
type StandaloneElement = Exclude<InstalledUiElement, MeasureElement>;

type ElementRun =
  | { kind: 'measures'; elements: MeasureElement[] }
  | { kind: 'single'; element: StandaloneElement };

function groupElements(elements: InstalledUiElement[]): ElementRun[] {
  const runs: ElementRun[] = [];
  for (const element of elements) {
    if (element.type === 'metric' || element.type === 'status') {
      const last = runs[runs.length - 1];
      if (last?.kind === 'measures') last.elements.push(element);
      else runs.push({ kind: 'measures', elements: [element] });
      continue;
    }
    runs.push({ kind: 'single', element });
  }
  return runs;
}

function MeasureRun({
  elements,
  data,
  compact,
}: {
  elements: MeasureElement[];
  data: unknown;
  compact: boolean;
}): React.JSX.Element {
  return (
    <MetricGroup compact={compact}>
      {elements.map((element, index) => {
        const value = valueAtPath(data, element.valuePath);
        const tone = toneName(element.tonePath ? valueAtPath(data, element.tonePath) : value);
        return element.type === 'status' ? (
          <StatusCell key={index} label={element.label} value={value} tone={tone} />
        ) : (
          <MetricCell
            key={index}
            label={element.label}
            value={value}
            unit={element.unit}
            tone={tone}
            compact={compact}
          />
        );
      })}
    </MetricGroup>
  );
}

function DeclarativeElements({
  elements,
  data,
  compact = false,
}: {
  elements: InstalledUiElement[];
  data: unknown;
  compact?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      {groupElements(elements).map((run, runIndex) => {
        if (run.kind === 'measures') {
          return <MeasureRun key={runIndex} elements={run.elements} data={data} compact={compact} />;
        }

        const element = run.element;

        if (element.type === 'section') {
          return (
            <section key={runIndex} className="flex flex-col gap-3">
              {element.title ? (
                <h3 className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {element.title}
                </h3>
              ) : null}
              <DeclarativeElements elements={element.body} data={data} compact={compact} />
            </section>
          );
        }

        if (element.type === 'text') {
          return (
            <p key={runIndex} className="text-sm leading-6 text-muted-foreground">
              {element.value ?? displayValue(valueAtPath(data, element.valuePath ?? ''))}
            </p>
          );
        }

        if (element.type === 'keyValue') {
          return (
            <KeyValueList
              key={runIndex}
              columns={compact ? 1 : 2}
              items={element.items.map((item) => ({
                label: item.label,
                value: valueAtPath(data, item.valuePath),
                unit: item.unit,
              }))}
            />
          );
        }

        const rowValue = valueAtPath(data, element.rowsPath);
        const rows = Array.isArray(rowValue)
          ? rowValue.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
          : [];
        if (!rows.length) {
          return <EmptyNote key={runIndex}>{element.emptyText ?? 'No rows returned.'}</EmptyNote>;
        }
        return (
          <DataTable
            key={runIndex}
            compact={compact}
            columns={element.columns.map((column) => ({ key: column.key, label: column.label }))}
            rows={rows.slice(0, compact ? 12 : 50).map((row) => element.columns.map((column) => ({
              key: column.key,
              value: valueAtPath(row, column.valuePath),
            })))}
          />
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

/** Turns a data key into something readable when a plugin declared no labels. */
function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
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

  const staleAge = useStaleness(query.dataUpdatedAt, view.refreshInterval);

  if (query.isLoading) return <LoadingSkeleton className={compact ? 'min-h-24' : 'min-h-48'} />;

  if (query.isError) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/8 p-3 text-sm">
        <p role="alert" className="text-destructive">{query.error.message}</p>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-sm font-medium text-destructive underline underline-offset-4 outline-none transition-opacity duration-100 hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => void query.refetch()}
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Try again
        </button>
      </div>
    );
  }

  const data = query.data;

  // The badge is hoisted above every render path below, so a stale widget is
  // marked whether it draws elements, a table, a key/value list or raw JSON.
  const withStaleness = (content: React.JSX.Element): React.JSX.Element => (
    staleAge === null ? content : (
      <div className="flex flex-col gap-2.5">
        <StaleBadge age={staleAge} />
        {content}
      </div>
    )
  );

  if (view.body?.length) {
    return withStaleness(<DeclarativeElements elements={view.body} data={data} compact={compact} />);
  }

  const rows = objectRows(data);
  if ((view.type === 'table' || view.type === 'status-list' || view.type === 'metrics') && rows.length) {
    const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, compact ? 4 : 8);
    return withStaleness(
      <DataTable
        compact={compact}
        columns={keys.map((key) => ({ key, label: humanizeKey(key) }))}
        rows={rows.slice(0, compact ? 8 : 50).map((row) => keys.map((key) => ({ key, value: row[key] })))}
      />,
    );
  }

  if (view.type === 'key-value' || view.type === 'metrics') {
    const record = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
    const entries = Object.entries(record);
    if (entries.length) {
      return withStaleness(
        <KeyValueList
          columns={compact ? 1 : 2}
          items={entries.slice(0, compact ? 8 : 24).map(([key, value]) => ({
            label: humanizeKey(key),
            value,
          }))}
        />,
      );
    }
  }

  if (data === null || data === undefined || (Array.isArray(data) && data.length === 0)) {
    return <EmptyNote>{view.emptyMessage ?? 'No data returned.'}</EmptyNote>;
  }

  return withStaleness(
    <div className="flex flex-col gap-1.5">
      <p className="text-[0.68rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        Raw response
      </p>
      <pre className="max-h-96 overflow-auto rounded-lg border border-border/60 bg-secondary/45 p-3 font-mono text-xs leading-5">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>,
  );
}
