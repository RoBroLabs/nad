'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Blocks, Check, CloudUpload, Pencil, RotateCcw, Save } from 'lucide-react';
import { AddWidgetDialog } from '@/components/dashboard/add-widget-dialog';
import { WidgetGrid } from '@/components/dashboard/widget-grid';
import type {
  AvailableWidget,
  DashboardLayoutState,
} from '@/components/dashboard/types';
import { Button } from '@/components/ui/button';
import { LoadingSkeleton } from '@/components/shared/loading-skeleton';
import { WORKSPACE_ACTIONS_SLOT_ID } from '@/components/workspaces/workspace-header';
import { generateId } from '@/lib/utils';

const breakpoints = ['lg', 'md', 'sm', 'xs', 'xxs'];

async function loadLayout(endpoint: string): Promise<DashboardLayoutState> {
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error('Dashboard layout could not be loaded.');
  const result = (await response.json()) as { data: DashboardLayoutState };
  return result.data;
}

/**
 * Renders into the workspace bar when one is on the page, and inline when it
 * is not — the root dashboard route has no workspace bar above it.
 */
function ToolbarSlot({ children }: { children: ReactNode }): React.JSX.Element {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setSlot(document.getElementById(WORKSPACE_ACTIONS_SLOT_ID));
  }, []);

  if (slot) return <>{createPortal(children, slot)}</>;
  return <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>;
}

export function DashboardWorkspace({
  availableWidgets,
  layoutEndpoint = '/api/user/layout',
  saveMethod = 'POST',
  canEdit = true,
}: {
  availableWidgets: AvailableWidget[];
  layoutEndpoint?: string;
  saveMethod?: 'POST' | 'PUT';
  canEdit?: boolean;
}): React.JSX.Element {
  const layoutQuery = useQuery({
    queryKey: ['dashboard-layout', layoutEndpoint],
    queryFn: () => loadLayout(layoutEndpoint),
  });
  const [state, setState] = useState<DashboardLayoutState>({ widgets: [], layouts: {} });
  const [hydrated, setHydrated] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'pending' | 'saving' | 'saved'>('idle');
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const suppressNextSave = useRef(false);

  useEffect(() => {
    if (!layoutQuery.data || hydrated) return;
    suppressNextSave.current = true;
    setState(layoutQuery.data);
    setHydrated(true);
  }, [hydrated, layoutQuery.data]);

  useEffect(() => {
    if (!hydrated || !canEdit) return;
    if (suppressNextSave.current) {
      suppressNextSave.current = false;
      return;
    }
    setSaveStatus('pending');
    const timeout = window.setTimeout(() => {
      saveQueue.current = saveQueue.current
        .catch(() => undefined)
        .then(async () => {
          setSaveStatus('saving');
          const response = await fetch(layoutEndpoint, {
            method: saveMethod,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(state),
          });
          if (!response.ok) throw new Error('Dashboard layout could not be saved.');
          setSaveError(null);
          setSaveStatus('saved');
        })
        .catch((error: unknown) => {
          setSaveError(error instanceof Error ? error.message : 'Dashboard layout could not be saved.');
          setSaveStatus('idle');
        });
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [canEdit, hydrated, layoutEndpoint, saveMethod, state]);

  function addWidget(widget: AvailableWidget, connectionProfileId?: string | null): void {
    const instanceId = generateId();
    setState((current) => {
      const layouts = { ...current.layouts };
      for (const breakpoint of breakpoints) {
        layouts[breakpoint] = [
          ...(layouts[breakpoint] ?? []),
          {
            i: instanceId,
            x: 0,
            y: 1_000_000,
            w: widget.defaultSize.w,
            h: widget.defaultSize.h,
            minW: widget.minSize?.w,
            minH: widget.minSize?.h,
            maxW: widget.maxSize?.w,
            maxH: widget.maxSize?.h,
          },
        ];
      }
      return {
        widgets: [...current.widgets, {
          instanceId,
          moduleSlug: widget.moduleSlug,
          widgetId: widget.widgetId,
          connectionProfileId: connectionProfileId ?? null,
          chrome: 'standard',
          settings: {},
        }],
        layouts,
      };
    });
  }

  function removeWidget(instanceId: string): void {
    setState((current) => ({
      widgets: current.widgets.filter((widget) => widget.instanceId !== instanceId),
      layouts: Object.fromEntries(
        Object.entries(current.layouts).map(([breakpoint, layout]) => [
          breakpoint,
          layout.filter((item) => item.i !== instanceId),
        ]),
      ),
    }));
  }

  function updateWidgetConnection(instanceId: string, connectionProfileId: string): void {
    if (!canEdit) return;
    setState((current) => ({
      ...current,
      widgets: current.widgets.map((widget) => widget.instanceId === instanceId
        ? { ...widget, connectionProfileId }
        : widget),
    }));
  }

  if (layoutQuery.isLoading) return <LoadingSkeleton className="min-h-96" />;
  if (layoutQuery.isError) {
    return (
      <section className="rounded-xl border border-destructive/40 bg-destructive/10 p-5" aria-labelledby="dashboard-load-error">
        <h1 id="dashboard-load-error" className="font-semibold text-destructive">Dashboard unavailable</h1>
        <p role="alert" className="mt-1 text-sm text-destructive">{layoutQuery.error.message}</p>
        <Button className="mt-4" variant="outline" onClick={() => void layoutQuery.refetch()}>
          <RotateCcw data-icon="inline-start" aria-hidden="true" />
          Try again
        </Button>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <ToolbarSlot>
        {saveStatus !== 'idle' || saveError ? (
          <span
            className="flex min-h-8 items-center gap-1.5 text-xs text-muted-foreground transition-opacity duration-200"
            role="status"
            aria-live="polite"
          >
            {saveError ? null : saveStatus === 'saved'
              ? <Check className="size-3.5 text-success" aria-hidden="true" />
              : <CloudUpload className="size-3.5 animate-pulse" aria-hidden="true" />}
            <span className="hidden sm:inline">
              {saveError ? 'Not saved' : saveStatus === 'saved' ? 'Saved' : 'Saving…'}
            </span>
          </span>
        ) : null}
        {canEdit ? (
          <>
            <Button variant={editMode ? 'secondary' : 'outline'} size="sm" onClick={() => setEditMode((current) => !current)}>
              {editMode ? <Save data-icon="inline-start" aria-hidden="true" /> : <Pencil data-icon="inline-start" aria-hidden="true" />}
              {editMode ? 'Done' : 'Edit layout'}
            </Button>
            <AddWidgetDialog widgets={availableWidgets} onAdd={addWidget} />
          </>
        ) : null}
      </ToolbarSlot>

      {saveError ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {saveError}
        </p>
      ) : null}

      {state.widgets.length ? (
        <section aria-labelledby="dashboard-widgets-heading">
          <h2 id="dashboard-widgets-heading" className="sr-only">Dashboard Widgets</h2>
          <WidgetGrid
            widgets={state.widgets}
            layouts={state.layouts}
            editMode={editMode}
            availableWidgets={availableWidgets}
            onLayoutsChange={(layouts) => setState((current) => ({ ...current, layouts }))}
            onRemove={removeWidget}
            onConnectionProfileChange={updateWidgetConnection}
          />
        </section>
      ) : (
        <section className="glass-subtle flex min-h-80 flex-col items-center justify-center rounded-2xl px-6 py-14 text-center">
          <span className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/20">
            <Blocks className="size-5" aria-hidden="true" />
          </span>
          <h2 className="text-lg font-semibold">Your Dashboard is empty</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            {canEdit
              ? 'Add a Widget from a configured plugin to start building your homelab overview.'
              : 'Nothing has been added to this shared view yet.'}
          </p>
          {canEdit ? (
            <div className="mt-5">
              <AddWidgetDialog widgets={availableWidgets} onAdd={addWidget} />
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
