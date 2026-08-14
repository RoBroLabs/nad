'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AvailableWidget } from '@/components/dashboard/types';

export function AddWidgetDialog({
  widgets,
  onAdd,
}: {
  widgets: AvailableWidget[];
  onAdd: (widget: AvailableWidget, connectionProfileId?: string | null) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [selectedProfiles, setSelectedProfiles] = useState<Record<string, string>>({});
  const moduleNames = Array.from(new Set(widgets.map(({ moduleName }) => moduleName)));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" aria-hidden="true" />
          Add Widget
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add Widget</DialogTitle>
          <DialogDescription>Choose a Widget from one of your configured plugins.</DialogDescription>
        </DialogHeader>
        {widgets.length ? (
          <div className="space-y-6 pt-2">
            {moduleNames.map((moduleName) => (
              <section key={moduleName} className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{moduleName}</h3>
                <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70">
                  {widgets.filter((widget) => widget.moduleName === moduleName).map((widget) => {
                    const key = `${widget.moduleSlug}:${widget.widgetId}`;
                    const profiles = widget.connectionProfiles ?? [];
                    const selectedProfileId = selectedProfiles[key]
                      ?? profiles.find(({ isDefault }) => isDefault)?.id
                      ?? profiles[0]?.id;
                    return (
                    <div
                      key={key}
                      className="flex min-h-14 flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{widget.name}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{widget.description}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {profiles.length ? (
                          <Select
                            value={selectedProfileId}
                            onValueChange={(value) => setSelectedProfiles((current) => ({ ...current, [key]: value }))}
                          >
                            <SelectTrigger className="h-8 w-36 text-xs" aria-label={`${widget.name} connection`}>
                              <SelectValue placeholder="Connection" />
                            </SelectTrigger>
                            <SelectContent>
                              {profiles.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">
                            {widget.defaultSize.w} × {widget.defaultSize.h}
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            onAdd(widget, selectedProfileId ?? null);
                            setOpen(false);
                          }}
                        >
                          Add
                        </Button>
                      </span>
                    </div>
                  );})}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
            <p className="text-sm font-medium">No Widgets available yet</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Install and configure a plugin you can access to make its Widgets available here.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
