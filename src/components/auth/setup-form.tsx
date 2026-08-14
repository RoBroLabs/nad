'use client';

import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, Circle, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { NadLogo } from '@/components/shared/nad-logo';
import { requestApi } from '@/lib/client-api';
import { cn } from '@/lib/utils';

interface SetupFormProps {
  loginUrl: string;
}

/** Add an explicit https:// scheme when the user typed a bare host or domain. */
function withUrlScheme(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function SetupForm({ loginUrl }: SetupFormProps): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [password, setPassword] = useState('');
  const [dashboardUrl, setDashboardUrl] = useState('');

  const passwordLongEnough = password.length >= 10;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    setIsSubmitting(true);
    try {
      const result = await requestApi<{ userId: string; loginUrl?: string }>('/api/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: formData.get('name'),
          email: formData.get('email'),
          password,
          dashboardName: formData.get('dashboardName'),
          dashboardUrl,
        }),
      }, 'Setup could not be completed.');
      window.location.assign(result.loginUrl ?? loginUrl);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Setup could not be completed.');
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="glass w-full max-w-xl">
      <CardHeader className="space-y-4 border-b border-border/60 px-7 pt-8 pb-7 sm:px-8 sm:pt-9 sm:pb-8">
        <NadLogo className="size-11" />
        <div className="space-y-1.5">
          <CardTitle role="heading" aria-level={1} className="text-2xl tracking-tight">Set up NAD</CardTitle>
          <CardDescription className="max-w-md text-sm leading-6">
            Create the first administrator and name your dashboard. You can install plugins and add users later.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="p-7 sm:p-8">
        <form className="space-y-6" onSubmit={handleSubmit}>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Your name</Label>
              <Input id="name" name="name" autoComplete="name" required placeholder="Ada Lovelace" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Admin password</Label>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="new-password"
              minLength={10}
              maxLength={1024}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-describedby="password-requirements"
            />
            <p
              id="password-requirements"
              aria-live="polite"
              className={cn(
                'flex items-center gap-1.5 text-sm transition-colors',
                passwordLongEnough ? 'text-success' : 'text-muted-foreground',
              )}
            >
              {passwordLongEnough
                ? <Check className="size-3.5" aria-hidden="true" />
                : <Circle className="size-3.5" aria-hidden="true" />}
              At least 10 characters. Password-manager generated passwords work well here.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dashboardName">Dashboard name</Label>
            <Input id="dashboardName" name="dashboardName" required defaultValue="NAD" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dashboardUrl">
              Dashboard URL <span className="text-xs font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="dashboardUrl"
              name="dashboardUrl"
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://dashboard.example.com"
              value={dashboardUrl}
              onChange={(event) => setDashboardUrl(event.target.value)}
              onBlur={() => setDashboardUrl((current) => withUrlScheme(current))}
            />
            <p className="text-sm leading-5 text-muted-foreground">
              The address people will use to reach this dashboard, for example a domain terminated by your
              reverse proxy. If you type a bare domain, https:// is added for you. You can lock access to
              this URL later in Settings → General.
            </p>
          </div>
          {error ? (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-3 border-t border-border/60 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="size-4 text-success" aria-hidden="true" />
              Your password is never stored in plain text.
            </p>
            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting ? 'Creating dashboard…' : 'Create dashboard'}
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
