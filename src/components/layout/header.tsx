'use client';

import { useRef, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { KeyRound, LogOut } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { CommandPaletteHint } from '@/components/layout/command-palette';
import { ChangePasswordDialog } from '@/components/auth/change-password-dialog';

/**
 * The application bar carries account controls only. The dashboard name lives
 * in the sidebar and the page's own identity lives in the bar below this one,
 * so repeating either here only pushed content further down the page.
 */
export function Header({ appName }: { appName: string }): React.JSX.Element {
  const { data: session } = useSession();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const accountMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const name = session?.user?.name ?? 'Account';
  const initial = name.charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-1 border-b border-border/70 bg-background/85 px-3 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 sm:px-5">
      <SidebarTrigger className="-ml-1" />
      <span className="sr-only">{appName}</span>
      <div className="flex-1" />
      {/* Advertises the palette. Dispatching the real shortcut keeps one code
          path, so the button and the keystroke can never drift apart. */}
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 px-2 text-muted-foreground"
        aria-label="Open the command palette"
        onClick={() => window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
        )}
      >
        <CommandPaletteHint />
      </Button>
      <ThemeToggle />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={accountMenuTriggerRef} variant="ghost" size="sm" className="gap-2 px-1.5" aria-label="Open account menu">
            <Avatar size="sm">
              {session?.user?.image ? <AvatarImage src={session.user.image} alt="" /> : null}
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
            <span className="hidden max-w-32 truncate text-sm sm:inline">{name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate text-sm font-medium">{name}</span>
            <span className="block truncate text-xs text-muted-foreground">{session?.user?.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setChangePasswordOpen(true)}>
            <KeyRound aria-hidden="true" />
            Change password
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => signOut({ callbackUrl: '/login' })}>
            <LogOut aria-hidden="true" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog
        open={changePasswordOpen}
        onOpenChange={(open) => {
          setChangePasswordOpen(open);
          if (!open) window.requestAnimationFrame(() => accountMenuTriggerRef.current?.focus());
        }}
      />
    </header>
  );
}
