'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Password input with a show/hide toggle so users can verify long or
 * password-manager-generated values before submitting.
 */
function PasswordInput({ className, ...props }: React.ComponentProps<'input'>) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <Input
        type={visible ? 'text' : 'password'}
        className={cn('pr-9', className)}
        {...props}
      />
      <button
        type="button"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-lg text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {visible
          ? <EyeOff className="size-4" aria-hidden="true" />
          : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  );
}

export { PasswordInput };
