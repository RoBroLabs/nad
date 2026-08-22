'use client';

import type { ReactNode } from 'react';
import { GripVertical, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface WidgetCardProps {
  title: string;
  moduleName: string;
  children: ReactNode;
  editMode?: boolean;
  loading?: boolean;
  error?: string;
  onRefresh?: () => void;
  onRetry?: () => void;
  onRemove?: () => void;
  chrome?: 'standard' | 'solid' | 'frameless';
}

export function WidgetCard({
  title,
  moduleName,
  children,
  editMode = false,
  loading = false,
  error,
  onRefresh,
  onRetry,
  onRemove,
  chrome = 'standard',
}: WidgetCardProps): React.JSX.Element {
  const framed = chrome !== 'frameless';

  return (
    <article
      className={cn(
        'group/widget flex h-full min-h-0 flex-col overflow-hidden',
        framed
          ? 'rounded-xl border border-border bg-card elevation-1 transition-shadow duration-150 hover:elevation-2'
          : 'bg-transparent',
        editMode && framed ? 'ring-1 ring-primary/25' : null,
      )}
    >
      <header
        className={cn(
          'flex h-10 shrink-0 items-center gap-2 px-3',
          framed ? 'border-b border-border/50' : null,
          editMode ? 'widget-drag-handle cursor-grab active:cursor-grabbing' : null,
        )}
      >
        {editMode ? (
          <GripVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium" title={`${title} · ${moduleName}`}>
          {title}
        </h3>
        <span className="hidden max-w-32 shrink-0 truncate text-xs text-muted-foreground/70 sm:inline">
          {moduleName}
        </span>
        {onRefresh ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="widget-control shrink-0 opacity-0 transition-opacity duration-100 focus-visible:opacity-100 group-hover/widget:opacity-100"
            onClick={onRefresh}
            aria-label={`Refresh ${title}`}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
        ) : null}
        {editMode && onRemove ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="widget-control shrink-0 text-destructive"
            onClick={onRemove}
            aria-label={`Remove ${title}`}
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <div className="space-y-3"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-24 w-full" /></div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-sm text-destructive">{error}</p>
            {onRetry ? <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>Retry</Button> : null}
          </div>
        ) : children}
      </div>
    </article>
  );
}
