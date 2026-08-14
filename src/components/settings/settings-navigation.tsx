'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Blocks, Globe, PanelsTopLeft, ScrollText, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

const settingsNavigation = [
  { href: '/settings/general', label: 'General', icon: Globe },
  { href: '/settings/modules', label: 'Plugins', icon: Blocks },
  { href: '/settings/users', label: 'Users', icon: Users },
  { href: '/settings/workspaces', label: 'Workspaces', icon: PanelsTopLeft },
  { href: '/settings/audit', label: 'Audit log', icon: ScrollText },
  { href: '/settings/notifications', label: 'Notifications', icon: Bell },
];

export function SettingsNavigation(): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav className="-mx-1 overflow-x-auto border-b border-border" aria-label="Settings">
      <div className="flex min-w-max gap-1 px-1">
        {settingsNavigation.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex min-h-11 items-center gap-2 rounded-t-md px-3 py-2 text-sm font-medium outline-none transition-colors',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                active
                  ? 'text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary'
                  : 'text-muted-foreground hover:bg-muted/55 hover:text-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
