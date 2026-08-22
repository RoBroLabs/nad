'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Check, FlaskConical, Loader2, RotateCcw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { SecretField } from '@/components/settings/secret-field';
import { requestApi } from '@/lib/client-api';
import type { ConfigField } from '@/lib/modules/types';

export interface DisplayConfigValue {
  value: string;
  masked: boolean;
  isSecret: boolean;
}

interface ModuleConfigFormProps {
  moduleSlug: string;
  fields: ConfigField[];
  initialConfig: Record<string, DisplayConfigValue>;
  testEndpoint?: string;
}

export function supportsConnectionTest(testEndpoint?: string): boolean {
  return Boolean(testEndpoint);
}

export function initialFieldValue(field: ConfigField, config: Record<string, DisplayConfigValue>): string {
  const saved = config[field.key]?.value;
  if (saved !== undefined) return saved;
  if (field.defaultValue !== undefined) return String(field.defaultValue);
  return field.type === 'boolean' ? 'false' : '';
}

export function normalizeConfigValues(
  fields: ConfigField[],
  config: Record<string, DisplayConfigValue>,
): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.key, initialFieldValue(field, config)]));
}

export function ModuleConfigForm({
  moduleSlug,
  fields,
  initialConfig,
  testEndpoint,
}: ModuleConfigFormProps): React.JSX.Element {
  const router = useRouter();
  const initialValues = useMemo(
    () => normalizeConfigValues(fields, initialConfig),
    [fields, initialConfig],
  );
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [displayConfig, setDisplayConfig] = useState(initialConfig);
  const [editedSecrets, setEditedSecrets] = useState<Record<string, boolean>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [secretVersion, setSecretVersion] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const receivedConfig = useRef(initialConfig);

  useEffect(() => {
    if (receivedConfig.current === initialConfig) return;
    receivedConfig.current = initialConfig;
    if (isDirty) return;
    setDisplayConfig(initialConfig);
    setValues(normalizeConfigValues(fields, initialConfig));
  }, [fields, initialConfig, isDirty]);

  function updateValue(key: string, value: string): void {
    setIsDirty(true);
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setStatus(null);
    setIsSubmitting(true);

    const submittedValues = Object.fromEntries(
      fields
        .filter((field) => field.type !== 'secret' || editedSecrets[field.key])
        .map((field) => [field.key, values[field.key] ?? '']),
    );
    try {
      const data = await requestApi<Record<string, DisplayConfigValue>>(
        `/api/settings/modules/${moduleSlug}/config`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ values: submittedValues }),
        },
        'Configuration could not be saved.',
      );
      setDisplayConfig(data);
      setValues(normalizeConfigValues(fields, data));
      setEditedSecrets({});
      setIsDirty(false);
      setSecretVersion((current) => current + 1);
      setStatus('Configuration saved.');
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Configuration could not be saved.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function clearConfig(): Promise<void> {
    setError(null);
    setStatus(null);
    setIsClearing(true);
    try {
      await requestApi<{ cleared: true }>(
        `/api/settings/modules/${moduleSlug}/config`,
        { method: 'DELETE' },
        'Configuration could not be cleared.',
      );
      setValues(Object.fromEntries(
        fields.map((field) => [
          field.key,
          field.defaultValue !== undefined ? String(field.defaultValue) : field.type === 'boolean' ? 'false' : '',
        ]),
      ));
      setDisplayConfig({});
      setEditedSecrets({});
      setIsDirty(false);
      setSecretVersion((current) => current + 1);
      setClearOpen(false);
      setStatus('Plugin configuration cleared.');
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Configuration could not be cleared.');
    } finally {
      setIsClearing(false);
    }
  }

  async function testConnection(): Promise<void> {
    setError(null);
    setStatus('Testing connection…');
    setIsTesting(true);
    try {
      await requestApi<unknown>(
        `/api/modules/${moduleSlug}/${testEndpoint}`,
        undefined,
        'Connection test failed.',
      );
      setStatus('Connection successful.');
    } catch (requestError) {
      setStatus(null);
      setError(requestError instanceof Error ? requestError.message : 'Connection test failed.');
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <form method="post" onSubmit={handleSubmit} className="space-y-7">
      <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card/35">
        {fields.length ? fields.map((field) => (
          <div key={field.key} className="grid gap-3 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,1.15fr)] sm:gap-8">
            <div>
              <Label htmlFor={field.key} className="text-sm font-medium">
                {field.label}{field.required ? <span className="ml-1 text-primary">*</span> : null}
              </Label>
              {field.description ? (
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{field.description}</p>
              ) : null}
            </div>
            <div className="self-center">
              {field.type === 'boolean' ? (
                <div className="flex h-9 items-center justify-between rounded-lg border border-input bg-background/55 px-3">
                  <span className="text-sm text-muted-foreground">{values[field.key] === 'true' ? 'Enabled' : 'Disabled'}</span>
                  <Switch
                    id={field.key}
                    checked={values[field.key] === 'true'}
                    onCheckedChange={(checked) => updateValue(field.key, String(checked))}
                  />
                </div>
              ) : field.type === 'select' ? (
                <Select value={values[field.key]} onValueChange={(value) => updateValue(field.key, value)}>
                  <SelectTrigger id={field.key} className="w-full">
                    <SelectValue placeholder={field.placeholder ?? 'Select an option'} />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options?.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : field.type === 'secret' ? (
                <SecretField
                  key={`${field.key}-${secretVersion}`}
                  id={field.key}
                  value={values[field.key]}
                  masked={displayConfig[field.key]?.masked ?? false}
                  placeholder={field.placeholder}
                  onChange={(value) => updateValue(field.key, value)}
                  onEdited={() => setEditedSecrets((current) => ({ ...current, [field.key]: true }))}
                />
              ) : (
                <Input
                  id={field.key}
                  type={field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'}
                  value={values[field.key]}
                  placeholder={field.placeholder}
                  required={field.required}
                  min={field.min}
                  max={field.max}
                  onChange={(event) => updateValue(field.key, event.target.value)}
                />
              )}
            </div>
          </div>
        )) : (
          <p className="px-5 py-8 text-sm text-muted-foreground">This plugin has no configuration fields.</p>
        )}
      </div>

      {error ? <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      {status ? (
        <p role="status" className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${isTesting ? 'border-border bg-muted/40 text-muted-foreground' : 'border-success/30 bg-success/10 text-success'}`}>
          {isTesting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}{status}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isSubmitting}>
          <Save data-icon="inline-start" aria-hidden="true" />
          {isSubmitting ? 'Saving…' : 'Save configuration'}
        </Button>
        {supportsConnectionTest(testEndpoint) ? (
          <Button type="button" variant="outline" disabled={isTesting || isSubmitting || isClearing} onClick={testConnection}>
            {isTesting ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <FlaskConical data-icon="inline-start" aria-hidden="true" />}
            {isTesting ? 'Testing…' : 'Test connection'}
          </Button>
        ) : null}
        <Dialog open={clearOpen} onOpenChange={(open) => {
          setClearOpen(open);
          if (open) {
            setError(null);
            setStatus(null);
          }
        }}>
          <DialogTrigger asChild>
            <Button type="button" variant="ghost" className="text-destructive hover:text-destructive">
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
              Clear plugin settings
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Clear plugin settings?</DialogTitle>
              <DialogDescription>
                This removes the saved configuration for this plugin, including encrypted secrets. Installed package files are not removed.
              </DialogDescription>
            </DialogHeader>
            {error ? <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={isClearing}>Cancel</Button>
              </DialogClose>
              <Button type="button" variant="destructive" disabled={isClearing} onClick={() => void clearConfig()}>
                {isClearing ? 'Clearing…' : 'Clear settings'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </form>
  );
}
