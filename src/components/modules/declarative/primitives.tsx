'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Presentation primitives for the core-rendered declarative surfaces.
 *
 * Core owns how a plugin's declared data is drawn. Nothing here reads a new
 * field from the package contract: every treatment is inferred from values the
 * schema-v1 UI element vocabulary already carries (`unit`, `tonePath`), so a
 * plugin gets the improved rendering without being republished.
 */

export type ToneName = 'critical' | 'warning' | 'success';

/** Written out in full rather than composed, so Tailwind can see them. */
const toneText: Record<ToneName, string> = {
  critical: 'text-critical',
  warning: 'text-warning',
  success: 'text-success',
};

const toneFill: Record<ToneName, string> = {
  critical: 'bg-critical',
  warning: 'bg-warning',
  success: 'bg-success',
};

const tonePillClass: Record<ToneName, string> = {
  critical: 'border-critical/30 bg-critical/12 text-critical',
  warning: 'border-warning/30 bg-warning/12 text-warning',
  success: 'border-success/30 bg-success/12 text-success',
};

const toneDot: Record<ToneName, string> = {
  critical: 'bg-critical',
  warning: 'bg-warning',
  success: 'bg-success',
};

export function toneName(value: unknown): ToneName | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (['critical', 'error', 'offline', 'failed', 'down'].includes(normalized)) return 'critical';
  if (['warning', 'degraded', 'stale', 'pending'].includes(normalized)) return 'warning';
  if (['ok', 'online', 'healthy', 'up', 'active', 'running'].includes(normalized)) return 'success';
  return null;
}

export function toneTextClass(value: unknown): string {
  const tone = toneName(value);
  return tone ? toneText[tone] : 'text-foreground';
}

export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Long numbers are grouped so a byte count or an uptime stays readable. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function isNumericLike(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A percentage is the one unit core can safely draw as a filled track. */
function percentageOf(value: unknown, unit?: string): number | null {
  if (unit !== '%' || !isNumericLike(value)) return null;
  return Math.max(0, Math.min(100, value));
}

export function Meter({ percent, tone }: { percent: number; tone: ToneName | null }): React.JSX.Element {
  return (
    <span
      className="block h-1 overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={`${Math.round(percent)} percent`}
    >
      <span
        className={cn(
          'block h-full rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
          tone ? toneFill[tone] : 'bg-primary',
        )}
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}

export function StatusPill({ value, tone }: { value: string; tone: ToneName | null }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        tone ? tonePillClass[tone] : 'border-border bg-muted/60 text-muted-foreground',
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', tone ? toneDot[tone] : 'bg-muted-foreground')} aria-hidden="true" />
      {value}
    </span>
  );
}

/**
 * A single declared metric. Percentages gain a track; everything else is a
 * large tabular figure so a column of them lines up.
 */
export function MetricCell({
  label,
  value,
  unit,
  tone,
  compact = false,
}: {
  label: string;
  value: unknown;
  unit?: string;
  tone: ToneName | null;
  compact?: boolean;
}): React.JSX.Element {
  const percent = percentageOf(value, unit);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="truncate text-[0.68rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          'flex items-baseline gap-0.5 font-semibold tabular-nums tracking-tight',
          compact ? 'text-xl' : 'text-2xl',
          tone ? toneText[tone] : 'text-foreground',
        )}
      >
        <span className="truncate">{displayValue(value)}</span>
        {unit ? <span className="text-xs font-medium text-muted-foreground">{unit}</span> : null}
      </span>
      {percent === null ? null : <Meter percent={percent} tone={tone} />}
    </div>
  );
}

export function StatusCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: unknown;
  tone: ToneName | null;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="truncate text-[0.68rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <StatusPill value={displayValue(value)} tone={tone} />
    </div>
  );
}

/** Adjacent metrics and statuses share one responsive row. */
export function MetricGroup({ children, compact = false }: { children: ReactNode; compact?: boolean }): React.JSX.Element {
  return (
    <div
      className={cn(
        'grid gap-x-5 gap-y-4',
        compact
          ? 'grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))]'
          : 'grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))]',
      )}
    >
      {children}
    </div>
  );
}

export function KeyValueList({
  items,
  columns = 2,
}: {
  items: Array<{ label: string; value: unknown; unit?: string }>;
  columns?: 1 | 2;
}): React.JSX.Element {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6', columns === 2 ? 'sm:grid-cols-2' : null)}>
      {items.map((item) => {
        const tone = toneName(item.value);
        return (
          <div
            key={item.label}
            className="flex items-baseline justify-between gap-4 border-b border-border/45 py-2 last:border-b-0"
          >
            <dt className="shrink-0 text-xs text-muted-foreground">{item.label}</dt>
            <dd
              className={cn(
                'min-w-0 truncate text-sm font-medium tabular-nums',
                tone ? toneText[tone] : null,
              )}
              title={displayValue(item.value)}
            >
              {displayValue(item.value)}
              {item.unit ? <span className="ml-0.5 text-xs font-normal text-muted-foreground">{item.unit}</span> : null}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function DataTable({
  columns,
  rows,
  compact = false,
}: {
  columns: Array<{ key: string; label: string }>;
  rows: Array<Array<{ key: string; value: unknown }>>;
  compact?: boolean;
}): React.JSX.Element {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-full border-separate border-spacing-0 text-left text-xs">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className="sticky top-0 z-10 whitespace-nowrap border-b border-border bg-card px-2 py-2 text-[0.68rem] font-medium uppercase tracking-[0.07em] text-muted-foreground"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="transition-colors duration-100 hover:bg-muted/40"
              style={{ '--enter-index': rowIndex } as React.CSSProperties}
            >
              {row.map((cell) => {
                const tone = toneName(cell.value);
                const numeric = isNumericLike(cell.value);
                return (
                  <td
                    key={cell.key}
                    className={cn(
                      'max-w-56 border-b border-border/40 px-2 align-middle',
                      compact ? 'py-1.5' : 'py-2',
                      numeric ? 'text-right tabular-nums' : null,
                    )}
                  >
                    {tone ? (
                      <StatusPill value={displayValue(cell.value)} tone={tone} />
                    ) : (
                      <span className="block truncate" title={displayValue(cell.value)}>
                        {displayValue(cell.value)}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <p className="flex min-h-20 items-center justify-center px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
