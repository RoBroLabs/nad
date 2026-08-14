'use client';

import { useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { ArrowRight, ExternalLink, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NadLogo } from '@/components/shared/nad-logo';

interface LoginFormProps {
  appName: string;
  callbackUrl: string;
  setupComplete: boolean;
  canonicalLoginUrl?: string;
  requiresCanonicalLogin: boolean;
}

export function LoginForm({
  appName,
  callbackUrl,
  setupComplete,
  canonicalLoginUrl,
  requiresCanonicalLogin,
}: LoginFormProps): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const formData = new FormData(event.currentTarget);
    try {
      const result = await signIn('credentials', {
        email: formData.get('email'),
        password: formData.get('password'),
        redirect: false,
      });
      if (result?.error) {
        setError('The email or password is incorrect.');
        setIsSubmitting(false);
        return;
      }

      window.location.assign(callbackUrl);
    } catch {
      setError('NAD could not be reached. Check your connection and try again.');
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="glass w-full max-w-md">
      <CardHeader className="space-y-5 p-7 pb-5 sm:p-8 sm:pb-6">
        <div className="flex items-center gap-3">
          <NadLogo className="size-10" />
          <span className="font-semibold tracking-tight">{appName}</span>
        </div>
        <div className="space-y-1.5">
          <CardTitle role="heading" aria-level={1} className="text-2xl tracking-tight">Sign in</CardTitle>
          <CardDescription>Use your local dashboard account to continue.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="p-7 pt-2 sm:p-8 sm:pt-2">
        {requiresCanonicalLogin && canonicalLoginUrl ? (
          <div className="space-y-5">
            <div role="alert" className="rounded-lg border border-warning/35 bg-warning/10 p-4 text-sm leading-6">
              <p className="flex items-center gap-2 font-medium text-foreground">
                <ShieldAlert className="size-4 text-warning" aria-hidden="true" />
                Secure sign-in required
              </p>
              <p className="mt-2 text-muted-foreground">
                This direct HTTP address cannot set NAD&apos;s secure authentication cookie. Your administrator account exists, but its password has not been rejected.
              </p>
            </div>
            <Button asChild className="w-full" size="lg">
              <a href={canonicalLoginUrl}>
                Continue to secure login
                <ExternalLink data-icon="inline-end" aria-hidden="true" />
              </a>
            </Button>
          </div>
        ) : (
          <form className="space-y-5" onSubmit={handleSubmit}>
            {setupComplete ? (
              <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
                Dashboard created. Sign in with your administrator account.
              </p>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <span className="text-xs text-muted-foreground">Local account</span>
              </div>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <Button className="w-full" type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
