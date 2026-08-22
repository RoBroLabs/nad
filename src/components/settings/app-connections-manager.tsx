'use client';

import { useState, type FormEvent } from 'react';
import { Check, Plus, Save, Shield, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
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
import type {
  AdminConnectionProfile,
  ConnectionAccessGrantInput,
} from '@/lib/modules/connections';
import type { ConfigField } from '@/lib/modules/types';

export function AppConnectionsManager({
  appId,
  appName,
  fields,
  initialProfiles,
  users,
  initialAccess,
}: {
  appId: string;
  appName: string;
  fields: ConfigField[];
  initialProfiles: AdminConnectionProfile[];
  users: Array<{ id: string; name: string; email: string; role: string }>;
  initialAccess: Record<string, ConnectionAccessGrantInput[]>;
}): React.JSX.Element {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [access, setAccess] = useState(initialAccess);
  const [createOpen, setCreateOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setStatus(null);
    setError(null);
    try {
      const profile = await requestApi<AdminConnectionProfile>(`/api/settings/apps/${encodeURIComponent(appId)}/connections`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payloadFromForm(fields, form)),
      }, 'Connection could not be created.');
      setProfiles((current) => [...current, profile]);
      setCreateOpen(false);
      setStatus(`${profile.name} was created.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Connection could not be created.');
    } finally {
      setPending(false);
    }
  }

  async function update(profile: AdminConnectionProfile, event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setStatus(null);
    setError(null);
    try {
      const submitted = payloadFromForm(fields, form, profile);
      const result = await requestApi<AdminConnectionProfile>(`/api/settings/apps/${encodeURIComponent(appId)}/connections/${profile.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...submitted, expectedRevision: profile.revision }),
      }, 'Connection could not be saved.');
      setProfiles((current) => current.map((candidate) => candidate.id === result.id ? result : candidate));
      setStatus(`${result.name} was saved.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Connection could not be saved.');
    } finally {
      setPending(false);
    }
  }

  async function remove(profile: AdminConnectionProfile): Promise<void> {
    setPending(true);
    setStatus(null);
    setError(null);
    try {
      await requestApi(`/api/settings/apps/${encodeURIComponent(appId)}/connections/${profile.id}`, { method: 'DELETE' }, 'Connection could not be deleted.');
      setProfiles((current) => current.filter(({ id }) => id !== profile.id));
      setStatus(`${profile.name} was deleted.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Connection could not be deleted.');
    } finally {
      setPending(false);
    }
  }

  async function saveAccess(profile: AdminConnectionProfile, grants: ConnectionAccessGrantInput[]): Promise<void> {
    setPending(true);
    setStatus(null);
    setError(null);
    try {
      const result = await requestApi<ConnectionAccessGrantInput[]>(`/api/settings/apps/${encodeURIComponent(appId)}/connections/${profile.id}/access`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grants }),
      }, 'Connection access could not be saved.');
      setAccess((current) => ({ ...current, [profile.id]: result }));
      setStatus(`${profile.name} access was saved.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Connection access could not be saved.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="app-connections-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 id="app-connections-heading" className="text-base font-semibold">Connections</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">Use separate named profiles for each {appName} server. Secrets stay encrypted and are available only to this App&apos;s isolated runtime.</p>
        </div>
        <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (open) setError(null); }}>
          <DialogTrigger asChild><Button><Plus data-icon="inline-start" />Add connection</Button></DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader><DialogTitle>Add {appName} connection</DialogTitle><DialogDescription>Name it for the system it reaches. You can restrict access after saving.</DialogDescription></DialogHeader>
            <ConnectionForm fields={fields} pending={pending} onSubmit={create} submitLabel="Create connection" />
          </DialogContent>
        </Dialog>
      </div>
      {error ? <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      {status ? <p role="status" className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"><Check className="size-4" />{status}</p> : null}
      <div className="space-y-3">
        {profiles.map((profile) => (
          <details key={profile.id} className="group border border-border/70 bg-card/30 open:bg-card/45">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-4 marker:hidden">
              <span className="flex size-8 items-center justify-center border border-border bg-background/50"><Shield className="size-4 text-primary" /></span>
              <span className="min-w-0 flex-1"><span className="font-medium">{profile.name}</span><span className="mt-0.5 block text-xs text-muted-foreground">{profile.accessMode === 'restricted' ? 'Restricted access' : 'Inherits App access'}{profile.isDefault ? ' · Default' : ''}</span></span>
              <span className={`size-2 rounded-full ${profile.enabled ? 'bg-success' : 'bg-muted-foreground'}`} aria-label={profile.enabled ? 'Enabled' : 'Disabled'} />
            </summary>
            <div className="border-t border-border/60 px-4 py-5">
              <ConnectionForm fields={fields} pending={pending} profile={profile} onSubmit={(event) => update(profile, event)} submitLabel="Save connection" />
              {profile.accessMode === 'restricted' ? (
                <ConnectionAccessEditor
                  grants={access[profile.id] ?? []}
                  users={users}
                  disabled={pending}
                  onSave={(grants) => saveAccess(profile, grants)}
                />
              ) : null}
              <div className="mt-4 border-t border-border/50 pt-4">
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={pending || profiles.length <= 1} onClick={() => void remove(profile)}><Trash2 data-icon="inline-start" />Delete connection</Button>
              </div>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function ConnectionAccessEditor({
  grants,
  users,
  disabled,
  onSave,
}: {
  grants: ConnectionAccessGrantInput[];
  users: Array<{ id: string; name: string; email: string; role: string }>;
  disabled: boolean;
  onSave: (grants: ConnectionAccessGrantInput[]) => Promise<void>;
}): React.JSX.Element {
  const initial = new Set(grants.map(({ subjectType, subjectId }) => `${subjectType}:${subjectId}`));
  const [selected, setSelected] = useState(initial);
  const entries = [
    { subjectType: 'role' as const, subjectId: 'member', label: 'All members' },
    { subjectType: 'role' as const, subjectId: 'restricted', label: 'All restricted users' },
    ...users.filter(({ role }) => role !== 'admin').map((user) => ({
      subjectType: 'user' as const,
      subjectId: user.id,
      label: `${user.name} · ${user.email}`,
    })),
  ];
  function toggle(key: string, checked: boolean): void {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(key); else next.delete(key);
      return next;
    });
  }
  return (
    <section className="mt-5 space-y-3 border-t border-border/50 pt-5">
      <div><h4 className="text-sm font-medium">Who can use this connection?</h4><p className="mt-1 text-xs leading-5 text-muted-foreground">App action permission is still required. Administrators always retain access.</p></div>
      <div className="grid gap-2 sm:grid-cols-2">
        {entries.map((entry) => {
          const key = `${entry.subjectType}:${entry.subjectId}`;
          return <label key={key} className="flex items-center justify-between gap-3 border border-border/60 px-3 py-2 text-sm"><span className="truncate">{entry.label}</span><Switch checked={selected.has(key)} onCheckedChange={(checked) => toggle(key, checked)} /></label>;
        })}
      </div>
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void onSave(entries.flatMap((entry) => selected.has(`${entry.subjectType}:${entry.subjectId}`) ? [{ subjectType: entry.subjectType, subjectId: entry.subjectId }] : []))}>Save access</Button>
    </section>
  );
}

function payloadFromForm(fields: ConfigField[], form: FormData, profile?: AdminConnectionProfile): Record<string, unknown> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const value = form.get(field.key);
    if (field.type === 'boolean') {
      values[field.key] = value === 'on' ? 'true' : 'false';
      continue;
    }
    if (typeof value !== 'string') continue;
    if (field.type === 'secret') {
      if (!value) continue;
    }
    values[field.key] = value;
  }
  return {
    name: form.get('name'),
    values,
    accessMode: form.get('accessMode'),
    enabled: form.get('enabled') === 'on',
    isDefault: form.get('isDefault') === 'on' || profile?.isDefault === true,
  };
}

function ConnectionForm({
  fields,
  profile,
  pending,
  onSubmit,
  submitLabel,
}: {
  fields: ConfigField[];
  profile?: AdminConnectionProfile;
  pending: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
}): React.JSX.Element {
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  return (
    <form method="post" className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-2"><Label htmlFor={`${profile?.id ?? 'new'}-name`}>Connection name</Label><Input id={`${profile?.id ?? 'new'}-name`} name="name" defaultValue={profile?.name} placeholder="Lab" maxLength={80} required /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.key} className="space-y-2">
            <Label htmlFor={`${profile?.id ?? 'new'}-${field.key}`}>{field.label}{field.required && !profile?.fields[field.key]?.present ? ' *' : ''}</Label>
            {field.type === 'secret' ? (
              <SecretField id={`${profile?.id ?? 'new'}-${field.key}`} name={field.key} value={fieldValues[field.key] ?? ''} masked={profile?.fields[field.key]?.present ?? false} placeholder={field.placeholder} onChange={(value) => setFieldValues((current) => ({ ...current, [field.key]: value }))} onEdited={() => undefined} />
            ) : field.type === 'boolean' ? (
              <label className="flex h-9 items-center justify-between border border-input px-3">
                <span className="text-sm text-muted-foreground">{field.label}</span>
                <Switch
                  name={field.key}
                  defaultChecked={(profile?.fields[field.key]?.value ?? String(field.defaultValue ?? 'false')) === 'true'}
                />
              </label>
            ) : field.type === 'select' ? (
              <Select
                name={field.key}
                defaultValue={profile?.fields[field.key]?.value
                  ?? (field.defaultValue === undefined ? undefined : String(field.defaultValue))}
              ><SelectTrigger id={`${profile?.id ?? 'new'}-${field.key}`} className="w-full"><SelectValue placeholder={field.placeholder} /></SelectTrigger><SelectContent>{field.options?.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>
            ) : (
              <Input id={`${profile?.id ?? 'new'}-${field.key}`} name={field.key} type={field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'} placeholder={field.placeholder} required={!profile && field.required} defaultValue={profile?.fields[field.key]?.value ?? (field.defaultValue === undefined ? undefined : String(field.defaultValue))} min={field.min} max={field.max} />
            )}
            {field.description ? <p className="text-xs leading-5 text-muted-foreground">{field.description}</p> : null}
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor={`${profile?.id ?? 'new'}-access`}>Profile access</Label><Select name="accessMode" defaultValue={profile?.accessMode ?? 'inherit'}><SelectTrigger id={`${profile?.id ?? 'new'}-access`} className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inherit">Inherit App access</SelectItem><SelectItem value="restricted">Restricted grants only</SelectItem></SelectContent></Select></div>
        <div className="flex items-center gap-5 pt-6"><label className="flex items-center gap-2 text-sm"><Switch name="enabled" defaultChecked={profile?.enabled ?? true} />Enabled</label><label className="flex items-center gap-2 text-sm"><Switch name="isDefault" defaultChecked={profile?.isDefault ?? false} />Default</label></div>
      </div>
      <DialogFooter className="sm:justify-start"><Button type="submit" disabled={pending}><Save data-icon="inline-start" />{pending ? 'Saving…' : submitLabel}</Button></DialogFooter>
    </form>
  );
}
