'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  AppWindow,
  Blocks,
  LayoutGrid,
  LogOut,
  Moon,
  Search,
  Settings,
  Sun,
  UsersRound,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { ModuleIcon } from '@/components/shared/module-icon';
import { useTheme } from '@/components/theme-provider';
import { workspacePath } from '@/lib/workspaces/route-paths';
import type { WorkspaceNavigation } from '@/lib/workspaces/types';
import { cn } from '@/lib/utils';

/**
 * A keyboard-first command palette.
 *
 * Deliberately unanimated: this is opened many times a day, and motion on a
 * surface used that often reads as latency rather than polish. Results are
 * grouped rather than flat because NAD's command surface is the product of
 * workspaces, tabs, plugins and settings — a flat list buries things as soon
 * as more than a couple of plugins are installed.
 */

export interface PaletteModule {
  slug: string;
  name: string;
  icon: string;
}

type CommandGroup = 'Workspaces' | 'Widgets' | 'Plugins' | 'Settings' | 'Appearance' | 'Account';

interface Command {
  id: string;
  group: CommandGroup;
  label: string;
  hint?: string;
  keywords?: string;
  icon: React.ReactNode;
  run: () => void;
}

const groupOrder: CommandGroup[] = [
  'Workspaces',
  'Widgets',
  'Plugins',
  'Settings',
  'Appearance',
  'Account',
];

function matches(command: Command, query: string): boolean {
  if (!query) return true;
  const haystack = `${command.label} ${command.group} ${command.hint ?? ''} ${command.keywords ?? ''}`.toLowerCase();
  // Every whitespace-separated term must appear, so "prox cpu" narrows the way
  // a person expects without pulling in a fuzzy-match dependency.
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
}

export function CommandPalette({
  workspaces,
  modules,
  showSettings,
}: {
  workspaces: WorkspaceNavigation;
  modules: PaletteModule[];
  showSettings: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const commands = useMemo<Command[]>(() => {
    const items: Command[] = [];

    for (const workspace of [...workspaces.mine, ...workspaces.shared]) {
      const shared = workspaces.shared.includes(workspace);
      const tabs = [...workspace.tabs].sort((a, b) => a.position - b.position);
      for (const tab of tabs) {
        items.push({
          id: `ws:${workspace.id}:${tab.id}`,
          group: 'Workspaces',
          label: tabs.length > 1 ? `${workspace.name} / ${tab.name}` : workspace.name,
          hint: shared ? 'Shared' : undefined,
          keywords: 'workspace tab dashboard go to open',
          icon: shared
            ? <UsersRound className="size-4" aria-hidden="true" />
            : <LayoutGrid className="size-4" aria-hidden="true" />,
          run: () => router.push(workspacePath(workspace.id, tab.id)),
        });
      }
    }

    for (const plugin of modules) {
      items.push({
        id: `mod:${plugin.slug}`,
        group: 'Plugins',
        label: plugin.name,
        keywords: `plugin app addon ${plugin.slug}`,
        icon: <ModuleIcon name={plugin.icon} className="size-4" />,
        run: () => router.push(`/m/${plugin.slug}`),
      });
    }

    if (showSettings) {
      const settings: Array<[string, string, string]> = [
        ['modules', 'Plugins', 'install packages nadmod marketplace'],
        ['general', 'General', 'dashboard url access name'],
        ['users', 'Users', 'accounts roles permissions people'],
        ['workspaces', 'Workspaces', 'sharing assignments'],
        ['notifications', 'Notifications', 'email smtp telegram ntfy alerts'],
        ['audit', 'Audit log', 'history events security'],
      ];
      for (const [slug, label, keywords] of settings) {
        items.push({
          id: `set:${slug}`,
          group: 'Settings',
          label: `Settings · ${label}`,
          keywords,
          icon: <Settings className="size-4" aria-hidden="true" />,
          run: () => router.push(`/settings/${slug}`),
        });
      }
    }

    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    items.push({
      id: 'theme',
      group: 'Appearance',
      label: `Switch to ${nextTheme} theme`,
      keywords: 'dark light colour color appearance',
      icon: nextTheme === 'dark'
        ? <Moon className="size-4" aria-hidden="true" />
        : <Sun className="size-4" aria-hidden="true" />,
      run: () => setTheme(nextTheme),
    });

    items.push({
      id: 'signout',
      group: 'Account',
      label: 'Sign out',
      keywords: 'log out leave session',
      icon: <LogOut className="size-4" aria-hidden="true" />,
      run: () => void signOut({ callbackUrl: '/login' }),
    });

    return items;
  }, [modules, router, setTheme, showSettings, theme, workspaces]);

  const visible = useMemo(() => commands.filter((c) => matches(c, query)), [commands, query]);

  const grouped = useMemo(() => groupOrder
    .map((group) => ({ group, items: visible.filter((c) => c.group === group) }))
    .filter(({ items }) => items.length > 0), [visible]);

  // Flat order drives arrow navigation; the grouping is presentational only.
  const flat = useMemo(() => grouped.flatMap(({ items }) => items), [grouped]);

  useEffect(() => setActiveIndex(0), [query]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  // Keep the highlighted row in view without animating the scroll — this is a
  // high-frequency surface and smooth scrolling reads as lag here.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, query]);

  function runAt(index: number): void {
    const command = flat[index];
    if (!command) return;
    setOpen(false);
    command.run();
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (event.key === 'Tab' && flat.length) {
      // Jump to the first item of the next group.
      event.preventDefault();
      const current = flat[activeIndex];
      const order = grouped.map(({ group }) => group);
      const next = order[(order.indexOf(current.group) + (event.shiftKey ? -1 : 1) + order.length) % order.length];
      setActiveIndex(flat.findIndex((c) => c.group === next));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runAt(activeIndex);
    }
  }

  let cursor = -1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="top-[12%] max-h-[70vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search Workspaces, plugins and settings. Use the arrow keys to move and Enter to open.
        </DialogDescription>

        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Type a command or search…"
            aria-label="Search commands"
            aria-controls="command-palette-results"
            className="min-w-0 flex-1 bg-transparent text-[0.95rem] outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground sm:block">
            esc
          </kbd>
        </div>

        <div id="command-palette-results" ref={listRef} role="listbox" aria-label="Commands" className="min-h-0 flex-1 overflow-y-auto p-2">
          {flat.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          ) : grouped.map(({ group, items }) => (
            <section key={group} className="pb-1">
              <h2 className="px-3 pb-1 pt-2.5 text-[0.65rem] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                {group}
              </h2>
              {items.map((command) => {
                cursor += 1;
                const index = cursor;
                const active = index === activeIndex;
                return (
                  <div
                    key={command.id}
                    role="option"
                    aria-selected={active}
                    data-active={active}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => runAt(index)}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm',
                      active ? 'bg-accent text-foreground' : 'text-foreground/90',
                    )}
                  >
                    <span className={cn('shrink-0', active ? 'text-primary' : 'text-muted-foreground')}>
                      {command.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{command.label}</span>
                    {command.hint ? (
                      <span className="shrink-0 text-xs text-muted-foreground">{command.hint}</span>
                    ) : null}
                  </div>
                );
              })}
            </section>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-4 border-t border-border bg-muted/40 px-4 py-2.5 text-[0.68rem] text-muted-foreground">
          <span>↑↓ navigate</span>
          <span>⇥ next group</span>
          <span>⏎ open</span>
          <span className="ml-auto tabular-nums">
            {flat.length} {flat.length === 1 ? 'result' : 'results'}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Renders the shortcut hint used to advertise the palette in the header. */
export function CommandPaletteHint(): React.JSX.Element {
  const [isApple, setIsApple] = useState(false);
  useEffect(() => {
    setIsApple(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);
  return (
    <>
      <Blocks className="size-3.5 sm:hidden" aria-hidden="true" />
      <AppWindow className="hidden size-3.5" aria-hidden="true" />
      <span className="hidden sm:inline">Search</span>
      <kbd className="hidden rounded border border-border px-1 font-mono text-[0.65rem] sm:inline">
        {isApple ? '⌘' : 'Ctrl'} K
      </kbd>
    </>
  );
}
