'use client';

import React, { useRef, useState, type FormEvent } from 'react';
import {
  Bell,
  CheckCircle2,
  CircleAlert,
  Loader2,
  Pencil,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  getNotificationChannelConfigSummary,
  getNotificationChannelMeta,
  getNotificationChannelStateText,
  getNotificationChannelTitle,
  type ChannelSummary,
} from '@/components/settings/notification-channel-ui';
import { requestApi } from '@/lib/client-api';

interface ChannelField {
  key: string;
  label: string;
  type: 'text' | 'secret' | 'number' | 'boolean';
  required: boolean;
  placeholder?: string;
  description?: string;
}

interface StatusMessage {
  message: string;
  tone: 'default' | 'error' | 'loading' | 'success';
}

interface NotificationsManagerProps {
  initialChannels: ChannelSummary[];
  schemas: Record<string, ChannelField[]>;
}

interface ChannelDialogProps {
  channel: ChannelSummary | null;
  schemas: Record<string, ChannelField[]>;
  onClose: () => void;
  onSaved: (channel: ChannelSummary, isNew: boolean) => void;
}

const TYPE_ORDER = ['email', 'telegram', 'ntfy'];
const ADD_CHANNEL_BUTTON_ID = 'add-notification-channel';

function statusClasses(tone: StatusMessage['tone']): string {
  switch (tone) {
    case 'error':
      return 'text-destructive';
    case 'loading':
      return 'text-muted-foreground';
    case 'success':
      return 'text-success';
    default:
      return 'text-muted-foreground';
  }
}

function fallbackStatus(channel: ChannelSummary): StatusMessage {
  return {
    message: getNotificationChannelStateText(channel),
    tone: channel.enabled ? 'success' : 'default',
  };
}

function StatusBanner({ status }: { status: StatusMessage }): React.JSX.Element {
  const Icon = status.tone === 'error'
    ? CircleAlert
    : status.tone === 'loading'
      ? Loader2
      : CheckCircle2;

  return (
    <p
      role={status.tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm leading-6 ${
        status.tone === 'error'
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : status.tone === 'loading'
            ? 'border-border/70 bg-muted/40 text-muted-foreground'
            : 'border-success/30 bg-success/10 text-success'
      }`}
    >
      <Icon className={`mt-0.5 size-4 shrink-0 ${status.tone === 'loading' ? 'animate-spin' : ''}`} aria-hidden="true" />
      <span>{status.message}</span>
    </p>
  );
}

function NotificationProviderIcon({ type }: { type: string }): React.JSX.Element {
  const { Icon, iconLabel } = getNotificationChannelMeta(type);

  return (
    <span aria-hidden="true" title={iconLabel} className="rounded-lg bg-primary/10 p-2 text-primary">
      <Icon className="size-4" />
    </span>
  );
}

export function NotificationsManager({ initialChannels, schemas }: NotificationsManagerProps): React.JSX.Element {
  const [channels, setChannels] = useState(initialChannels);
  const [dialogChannel, setDialogChannel] = useState<ChannelSummary | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChannelSummary | null>(null);
  const [banner, setBanner] = useState<StatusMessage | null>(null);
  const [feedback, setFeedback] = useState<Record<string, StatusMessage>>({});
  const [pendingAction, setPendingAction] = useState<Record<string, 'test' | 'toggle' | undefined>>({});
  const [isDeleting, setIsDeleting] = useState(false);
  const lastTriggerRef = useRef<HTMLElement | null>(null);

  function rememberTrigger(element: HTMLElement): void {
    lastTriggerRef.current = element;
  }

  function restoreFocus(): void {
    const addButton = typeof document === 'undefined'
      ? null
      : document.getElementById(ADD_CHANNEL_BUTTON_ID);
    const trigger = lastTriggerRef.current?.isConnected ? lastTriggerRef.current : null;
    const target = trigger ?? addButton;
    target?.focus();
    lastTriggerRef.current = null;
  }

  function announce(channelId: string, status: StatusMessage): void {
    setFeedback((current) => ({ ...current, [channelId]: status }));
  }

  function setChannelPending(channelId: string, action?: 'test' | 'toggle'): void {
    setPendingAction((current) => ({ ...current, [channelId]: action }));
  }

  async function handleToggle(channel: ChannelSummary, enabled: boolean): Promise<void> {
    setBanner(null);
    setChannelPending(channel.id, 'toggle');
    announce(channel.id, {
      message: enabled ? 'Enabling channel…' : 'Disabling channel…',
      tone: 'loading',
    });

    try {
      const updated = await requestApi<ChannelSummary>(`/api/settings/notifications/${channel.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }, 'The channel could not be updated.');
      setChannels((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      announce(updated.id, fallbackStatus(updated));
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'The channel could not be updated.';
      announce(channel.id, { message, tone: 'error' });
      setBanner({ message, tone: 'error' });
    } finally {
      setChannelPending(channel.id);
    }
  }

  async function handleTest(channel: ChannelSummary): Promise<void> {
    setBanner(null);
    setChannelPending(channel.id, 'test');
    announce(channel.id, {
      message: 'Sending a test notification…',
      tone: 'loading',
    });

    try {
      await requestApi<{ delivered: boolean }>(`/api/settings/notifications/${channel.id}/test`, {
        method: 'POST',
      }, 'The test notification could not be delivered.');
      announce(channel.id, {
        message: 'Test notification sent.',
        tone: 'success',
      });
    } catch (requestError) {
      announce(channel.id, {
        message: requestError instanceof Error ? requestError.message : 'The test notification could not be delivered.',
        tone: 'error',
      });
    } finally {
      setChannelPending(channel.id);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!deleteTarget) return;

    setBanner(null);
    setIsDeleting(true);
    const deletedTitle = getNotificationChannelTitle(deleteTarget);

    try {
      await requestApi<{ deleted: boolean }>(`/api/settings/notifications/${deleteTarget.id}`, {
        method: 'DELETE',
      }, 'The channel could not be deleted.');
      setChannels((current) => current.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
      setBanner({
        message: `${deletedTitle} deleted.`,
        tone: 'success',
      });
      restoreFocus();
    } catch (requestError) {
      setBanner({
        message: requestError instanceof Error ? requestError.message : 'The channel could not be deleted.',
        tone: 'error',
      });
      setDeleteTarget(null);
      restoreFocus();
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="glass-subtle border-border/70">
        <CardHeader className="flex flex-col items-stretch justify-between gap-4 space-y-0 sm:flex-row sm:items-start">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Bell className="size-4 text-primary" aria-hidden="true" />
              Notification channels
            </CardTitle>
            <CardDescription className="max-w-2xl leading-6">
              Configure the core-owned channels NAD uses to deliver alerts. Email, Telegram, and ntfy are
              supported here; secrets stay encrypted at rest and are only used server-side.
            </CardDescription>
          </div>
          <Button
            id={ADD_CHANNEL_BUTTON_ID}
            className="w-full sm:w-auto"
            onClick={(event) => {
              rememberTrigger(event.currentTarget);
              setBanner(null);
              setDialogChannel('new');
            }}
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add notification channel
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {banner ? <StatusBanner status={banner} /> : null}

          {channels.length === 0 ? (
            <div className="space-y-4 rounded-lg border border-dashed border-border/70 px-4 py-6">
              <p className="text-sm text-muted-foreground">
                No notification channels yet. Add one so NAD can send alerts by email, Telegram, or ntfy.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {TYPE_ORDER.map((type) => {
                  const meta = getNotificationChannelMeta(type);
                  return (
                    <div key={type} className="rounded-lg border border-border/70 bg-card/40 p-3">
                      <div className="flex items-start gap-3">
                        <NotificationProviderIcon type={type} />
                        <div className="space-y-1">
                          <p className="text-sm font-medium">{meta.label}</p>
                          <p className="text-xs leading-5 text-muted-foreground">{meta.description}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {channels.map((channel) => (
            <div
              key={channel.id}
              className="flex flex-col gap-4 rounded-lg border border-border/70 p-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex items-start gap-3">
                <NotificationProviderIcon type={channel.type} />
                <div className="space-y-1">
                  <p className="text-sm font-medium">{getNotificationChannelTitle(channel)}</p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {getNotificationChannelConfigSummary(channel)}
                  </p>
                  <p
                    aria-live="polite"
                    className={`text-xs leading-5 ${statusClasses((feedback[channel.id] ?? fallbackStatus(channel)).tone)}`}
                  >
                    {(feedback[channel.id] ?? fallbackStatus(channel)).message}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:items-end">
                <div className="flex items-center gap-3 self-start sm:self-end">
                  <span className="text-xs text-muted-foreground">{channel.enabled ? 'Enabled' : 'Disabled'}</span>
                  <Switch
                    checked={channel.enabled}
                    disabled={pendingAction[channel.id] === 'toggle'}
                    onCheckedChange={(enabled) => void handleToggle(channel, enabled)}
                    aria-label={`${channel.enabled ? 'Disable' : 'Enable'} ${getNotificationChannelTitle(channel)}`}
                  />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto"
                    disabled={Boolean(pendingAction[channel.id])}
                    onClick={() => void handleTest(channel)}
                  >
                    {pendingAction[channel.id] === 'test'
                      ? <Loader2 className="animate-spin" aria-hidden="true" />
                      : <Send data-icon="inline-start" aria-hidden="true" />}
                    Send test
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto"
                    disabled={Boolean(pendingAction[channel.id])}
                    onClick={(event) => {
                      rememberTrigger(event.currentTarget);
                      setBanner(null);
                      setDialogChannel(channel);
                    }}
                  >
                    <Pencil data-icon="inline-start" aria-hidden="true" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto"
                    disabled={Boolean(pendingAction[channel.id])}
                    onClick={(event) => {
                      rememberTrigger(event.currentTarget);
                      setBanner(null);
                      setDeleteTarget(channel);
                    }}
                    aria-label={`Delete ${getNotificationChannelTitle(channel)}`}
                  >
                    <Trash2 aria-hidden="true" />
                    <span className="sm:sr-only">Delete</span>
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {dialogChannel ? (
        <ChannelDialog
          channel={dialogChannel === 'new' ? null : dialogChannel}
          schemas={schemas}
          onClose={() => {
            setDialogChannel(null);
            restoreFocus();
          }}
          onSaved={(saved, isNew) => {
            setChannels((current) => (isNew
              ? [...current, saved]
              : current.map((item) => (item.id === saved.id ? saved : item))));
            if (!isNew) {
              announce(saved.id, {
                message: 'Channel settings saved.',
                tone: 'success',
              });
            }
            setBanner({
              message: `${getNotificationChannelMeta(saved.type).label} channel saved.`,
              tone: 'success',
            });
            setDialogChannel(null);
            restoreFocus();
          }}
        />
      ) : null}

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (open) return;
          setDeleteTarget(null);
          restoreFocus();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget ? getNotificationChannelTitle(deleteTarget) : 'channel'}?</DialogTitle>
            <DialogDescription className="leading-6">
              NAD will stop using this channel for alerts. Remove it only if you no longer want core-owned
              delivery through this provider.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteTarget(null);
                restoreFocus();
              }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={isDeleting}>
              {isDeleting ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Delete channel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChannelDialog({ channel, schemas, onClose, onSaved }: ChannelDialogProps): React.JSX.Element {
  const isNew = channel === null;
  const [type, setType] = useState(channel?.type ?? 'email');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fields = schemas[type] ?? [];
  const providerMeta = getNotificationChannelMeta(type);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const config: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = formData.get(field.key);
      if (field.type === 'boolean') {
        if (raw !== null || channel?.config[field.key]) config[field.key] = raw === 'on' ? 'true' : 'false';
      } else if (typeof raw === 'string' && raw.trim() !== '') {
        config[field.key] = raw.trim();
      }
    }

    try {
      const saved = await requestApi<ChannelSummary>(
        isNew ? '/api/settings/notifications' : `/api/settings/notifications/${channel.id}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(isNew ? { type, config, enabled: true } : { config }),
        },
        'The channel could not be saved.',
      );
      onSaved(saved, isNew);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The channel could not be saved.');
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Add notification channel' : `Edit ${providerMeta.label} channel`}</DialogTitle>
          <DialogDescription className="leading-6">
            {isNew
              ? 'Choose how NAD should deliver alerts, then enter the operator-managed connection details.'
              : 'Update the saved delivery details. Leave a secret field empty to keep the stored value.'}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {isNew ? (
            <div className="space-y-2">
              <Label htmlFor="channel-type">Delivery method</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="channel-type" aria-label="Delivery method" className="w-full">
                  <SelectValue placeholder="Select a delivery method" />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_ORDER.map((value) => {
                    const meta = getNotificationChannelMeta(value);
                    return (
                      <SelectItem key={value} value={value}>
                        <span className="flex items-center gap-2">
                          <meta.Icon className="size-4 text-primary" aria-hidden="true" />
                          <span>{meta.label}</span>
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="rounded-lg border border-border/70 bg-card/40 p-3">
            <div className="flex items-start gap-3">
              <NotificationProviderIcon type={type} />
              <div className="space-y-1">
                <p className="text-sm font-medium">{providerMeta.label}</p>
                <p className="text-xs leading-5 text-muted-foreground">{providerMeta.selectorHint}</p>
              </div>
            </div>
          </div>

          {fields.map((field, index) => {
            const existing = channel?.config[field.key];
            if (field.type === 'boolean') {
              return (
                <div key={field.key} className="flex items-center justify-between gap-4 rounded-lg border border-border/70 p-3">
                  <div className="space-y-0.5">
                    <Label htmlFor={`field-${field.key}`} className="text-sm">{field.label}</Label>
                    {field.description ? <p className="text-xs text-muted-foreground">{field.description}</p> : null}
                  </div>
                  <Switch
                    id={`field-${field.key}`}
                    name={field.key}
                    defaultChecked={existing ? existing.value === 'true' : false}
                  />
                </div>
              );
            }
            return (
              <div key={field.key} className="space-y-2">
                <Label htmlFor={`field-${field.key}`}>
                  {field.label}
                  {!field.required ? <span className="text-xs font-normal text-muted-foreground"> (optional)</span> : null}
                </Label>
                <Input
                  id={`field-${field.key}`}
                  name={field.key}
                  type={field.type === 'secret' ? 'password' : field.type === 'number' ? 'number' : 'text'}
                  autoComplete="off"
                  required={field.required && isNew}
                  autoFocus={index === 0}
                  placeholder={existing?.masked ? existing.value : field.placeholder}
                  defaultValue={existing && !existing.isSecret ? existing.value : undefined}
                />
                {field.description ? <p className="text-xs text-muted-foreground">{field.description}</p> : null}
                {existing?.isSecret ? (
                  <p className="text-xs text-muted-foreground">Leave blank to keep the saved secret.</p>
                ) : null}
              </div>
            );
          })}

          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {isSubmitting ? 'Saving…' : isNew ? 'Add channel' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
