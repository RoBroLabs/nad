'use client';

import type { ReactNode } from 'react';
import { GripHorizontal, RefreshCw, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

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
  const shellClass = chrome === 'frameless'
    ? 'flex h-full min-h-0 flex-col overflow-hidden bg-transparent'
    : chrome === 'solid'
      ? 'flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card'
      : 'glass flex h-full min-h-0 flex-col overflow-hidden rounded-xl';
  return (
    <article className={shellClass}>
      <header className={`flex h-11 shrink-0 items-center gap-2 ${chrome === 'frameless' ? '' : 'border-b border-border/60'} px-3 ${editMode ? 'widget-drag-handle cursor-move' : ''}`}>
        {editMode ? <GripHorizontal className="size-4 text-muted-foreground" aria-hidden="true" /> : null}
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h3>
        <Badge variant="outline" className="hidden max-w-32 truncate font-normal sm:inline-flex">{moduleName}</Badge>
        {onRefresh ? (
          <Button variant="ghost" size="icon-xs" className="widget-control" onClick={onRefresh} aria-label={`Refresh ${title}`}>
            <RefreshCw aria-hidden="true" />
          </Button>
        ) : null}
        {editMode && onRemove ? (
          <Button variant="ghost" size="icon-xs" className="widget-control text-destructive" onClick={onRemove} aria-label={`Remove ${title}`}>
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
