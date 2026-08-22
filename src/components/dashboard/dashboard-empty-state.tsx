'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Blocks, PlugZap, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The first thing a new self-hoster sees.
 *
 * A fresh NAD ships with zero plugins by design, so "your dashboard is empty"
 * is the *normal* first state, not an edge case. It previously said "add a
 * Widget from a configured plugin" and offered a picker that was also empty —
 * naming the problem without routing anywhere. Each branch below now ends in
 * the one action that actually moves the person forward from where they are.
 */

export interface DashboardEmptyStateProps {
  canEdit: boolean;
  isAdmin: boolean;
  /** Plugins installed and visible to this user, whatever their state. */
  installedCount: number;
  /** Of those, the ones with a working connection, so their Widgets exist. */
  configuredCount: number;
  /** Rendered when there is genuinely something to add. */
  addWidgetSlot: ReactNode;
}

export function DashboardEmptyState({
  canEdit,
  isAdmin,
  installedCount,
  configuredCount,
  addWidgetSlot,
}: DashboardEmptyStateProps): React.JSX.Element {
  const state = !canEdit
    ? 'read-only'
    : installedCount === 0
      ? 'no-plugins'
      : configuredCount === 0
        ? 'unconfigured'
        : 'ready';

  const copy = {
    'read-only': {
      icon: <Blocks className="size-5" aria-hidden="true" />,
      title: 'Nothing here yet',
      body: 'Whoever owns this Workspace has not added anything to it. You will see Widgets here once they do.',
      action: null,
    },
    'no-plugins': {
      icon: <PlugZap className="size-5" aria-hidden="true" />,
      title: 'Add your first plugin',
      body: 'NAD ships with nothing installed — you choose what it can see. Plugins add Widgets for the services you already run, like Proxmox, Unraid or Pi-hole.',
      action: isAdmin ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button asChild size="sm">
            <Link href="/settings/modules">Browse plugins</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/settings/modules">Upload a .nadmod file</Link>
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Ask an administrator to install one.
        </p>
      ),
    },
    unconfigured: {
      icon: <PlugZap className="size-5" aria-hidden="true" />,
      title: installedCount === 1 ? 'Finish setting up your plugin' : 'Finish setting up your plugins',
      body: `${installedCount === 1 ? 'A plugin is' : `${installedCount} plugins are`} installed but ${installedCount === 1 ? 'has' : 'have'} no working connection yet. Point ${installedCount === 1 ? 'it' : 'them'} at your host and the Widgets appear here.`,
      action: isAdmin ? (
        <Button asChild size="sm">
          <Link href="/settings/modules">Open plugin settings</Link>
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          Ask an administrator to finish configuring it.
        </p>
      ),
    },
    ready: {
      icon: <Blocks className="size-5" aria-hidden="true" />,
      title: 'Your Dashboard is empty',
      body: 'Add a Widget to start building your homelab overview. Drag to rearrange, resize to taste — the layout is yours.',
      action: addWidgetSlot,
    },
  }[state];

  return (
    <section className="glass-subtle flex min-h-80 flex-col items-center justify-center rounded-2xl px-6 py-14 text-center">
      <span className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-primary/12 text-primary ring-1 ring-primary/20">
        {copy.icon}
      </span>
      <h2 className="text-lg font-semibold">{copy.title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{copy.body}</p>
      {copy.action ? <div className="mt-5">{copy.action}</div> : null}

      {state === 'no-plugins' && isAdmin ? (
        <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0 text-verified" aria-hidden="true" />
          Every plugin is signature-checked before it runs, and you approve its access first.
        </p>
      ) : null}
    </section>
  );
}
