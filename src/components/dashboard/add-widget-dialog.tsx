'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { WidgetPreview } from '@/components/dashboard/widget-preview';
import type { AvailableWidget } from '@/components/dashboard/types';
import { cn } from '@/lib/utils';

export function AddWidgetDialog({
  widgets,
  onAdd,
}: {
  widgets: AvailableWidget[];
  onAdd: (widget: AvailableWidget, connectionProfileId?: string | null) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedProfiles, setSelectedProfiles] = useState<Record<string, string>>({});

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return widgets;
    return widgets.filter((widget) => (
      `${widget.name} ${widget.moduleName} ${widget.description ?? ''}`.toLowerCase().includes(needle)
    ));
  }, [query, widgets]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus data-icon="inline-start" aria-hidden="true" />
          Add Widget
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>Add a Widget</DialogTitle>
          <DialogDescription>
            Previews show the layout each Widget produces. Live values appear once it is on your Dashboard.
          </DialogDescription>
        </DialogHeader>

        {widgets.length > 6 ? (
          <div className="relative px-5 pt-4">
            <Search className="pointer-events-none absolute left-8 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Widgets"
              aria-label="Search Widgets"
              className="pl-9"
            />
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!widgets.length ? (
            <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
              <p className="text-sm font-medium">No Widgets available yet</p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                Widgets appear here once a plugin is installed, has a working connection, and you have
                permission to view it.
              </p>
              {/* Previously a dead end: it named the fix without offering it. */}
              <Button asChild size="sm" variant="outline" className="mt-4">
                <Link href="/settings/modules">Go to plugin settings</Link>
              </Button>
            </div>
          ) : !matches.length ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No Widget matches “{query}”.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {matches.map((widget, index) => {
                const key = `${widget.moduleSlug}:${widget.widgetId}`;
                const profiles = widget.connectionProfiles ?? [];
                const selectedProfileId = selectedProfiles[key]
                  ?? profiles.find(({ isDefault }) => isDefault)?.id
                  ?? profiles[0]?.id;
                return (
                  <li
                    key={key}
                    className={cn(
                      'rise-in group/tile flex flex-col overflow-hidden rounded-xl border border-border bg-card',
                      'transition-[border-color,box-shadow] duration-150 hover:border-primary/40 hover:elevation-2',
                    )}
                    style={{ '--enter-index': Math.min(index, 8) } as React.CSSProperties}
                  >
                    {/* Fixed height keeps the tiles on a grid; the mask stops a
                        taller preview from ending on a hard clipped edge. */}
                    <div
                      className="pointer-events-none h-32 overflow-hidden border-b border-border/50 bg-background/40 p-3 [mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)]"
                      aria-hidden="true"
                    >
                      <WidgetPreview
                        installedView={widget.installedView}
                        isSandbox={Boolean(widget.sandboxSurfaceId)}
                      />
                    </div>
                    <div className="flex flex-1 flex-col gap-1 p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-medium">{widget.name}</p>
                        <p className="shrink-0 font-mono text-[0.68rem] text-muted-foreground">
                          {widget.defaultSize.w}×{widget.defaultSize.h}
                        </p>
                      </div>
                      <p className="text-xs leading-5 text-muted-foreground">
                        {widget.description ?? widget.moduleName}
                      </p>
                      <div className="mt-auto flex items-center gap-2 pt-3">
                        {profiles.length ? (
                          <Select
                            value={selectedProfileId}
                            onValueChange={(value) => setSelectedProfiles((current) => ({ ...current, [key]: value }))}
                          >
                            <SelectTrigger className="h-8 min-w-0 flex-1 text-xs" aria-label={`${widget.name} connection`}>
                              <SelectValue placeholder="Connection" />
                            </SelectTrigger>
                            <SelectContent>
                              {profiles.map((profile) => (
                                <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                            {widget.moduleName}
                          </span>
                        )}
                        <Button
                          size="sm"
                          onClick={() => {
                            onAdd(widget, selectedProfileId ?? null);
                            setOpen(false);
                          }}
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
