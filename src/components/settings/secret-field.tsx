'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface SecretFieldProps {
  id: string;
  name?: string;
  value: string;
  masked: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  onEdited: () => void;
}

export function SecretField({
  id,
  name,
  value,
  masked,
  placeholder,
  onChange,
  onEdited,
}: SecretFieldProps): React.JSX.Element {
  const [revealed, setRevealed] = useState(false);
  const [edited, setEdited] = useState(false);

  function beginEditing(): void {
    if (edited) return;
    setEdited(true);
    onEdited();
    if (masked) onChange('');
  }

  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={revealed ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        onFocus={beginEditing}
        onChange={(event) => {
          beginEditing();
          onChange(event.target.value);
        }}
        className="pr-10 font-mono"
        autoComplete="new-password"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        onClick={() => setRevealed((current) => !current)}
        aria-label={revealed ? 'Hide secret' : 'Reveal secret'}
      >
        {revealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </div>
  );
}
