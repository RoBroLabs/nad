'use client';

import { useState, type FormEvent } from 'react';
import { signOut } from 'next-auth/react';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { passwordsMatch } from '@/lib/auth/password';
import { requestApi } from '@/lib/client-api';

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangePasswordDialog({ open, onOpenChange }: ChangePasswordDialogProps): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const password = formData.get('password');
    const passwordConfirmation = formData.get('passwordConfirmation');
    if (!passwordsMatch(password, passwordConfirmation)) {
      setError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      await requestApi<{ changed: boolean }>('/api/user/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          currentPassword: formData.get('currentPassword'),
          password,
          passwordConfirmation,
        }),
      }, 'The password could not be changed.');
      // Every session is invalidated by the change; sign in again fresh.
      await signOut({ callbackUrl: '/login' });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The password could not be changed.');
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSubmitting) {
          setError(null);
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" aria-hidden="true" />
            Change password
          </DialogTitle>
          <DialogDescription className="leading-6">
            Choose a new password of at least 10 characters. All of your existing sessions,
            including this one, will be signed out.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current password</Label>
            <PasswordInput id="currentPassword" name="currentPassword" autoComplete="current-password" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <PasswordInput id="password" name="password" autoComplete="new-password" minLength={10} maxLength={1024} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="passwordConfirmation">Confirm new password</Label>
            <PasswordInput id="passwordConfirmation" name="passwordConfirmation" autoComplete="new-password" minLength={10} maxLength={1024} required />
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Changing…' : 'Change password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
