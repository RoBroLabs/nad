'use client';

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { requestApi } from '@/lib/client-api';
import type { TrustedCodePolicy } from '@/lib/modules/installed/trust';

const descriptions: Record<TrustedCodePolicy, string> = {
  reviewed_auto: 'Use richer reviewed bridge privileges only when a separately signed review attestation matches the exact artifact digest.',
  manual_each_release: 'Require a local administrator decision for every exact release digest. Approval never carries to an update.',
  sandbox_only: 'Keep all custom plugin surfaces on the minimum sandbox bridge, including reviewed releases.',
};

export function TrustedCodePolicyForm({ initialPolicy }: { initialPolicy: TrustedCodePolicy }): React.JSX.Element {
  const [policy, setPolicy] = useState(initialPolicy);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setPending(true);
    setMessage(null);
    setError(null);
    try {
      const result = await requestApi<{ policy: TrustedCodePolicy }>('/api/settings/apps/trust', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ policy }),
      }, 'Trusted-code policy could not be saved.');
      setPolicy(result.policy);
      setMessage('Trusted-code policy saved.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Trusted-code policy could not be saved.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="glass-subtle border-border/70">
      <CardHeader className="space-y-1.5">
        <CardTitle className="flex items-center gap-2 text-lg"><ShieldCheck className="size-4 text-primary" />Custom plugin UI policy</CardTitle>
        <CardDescription className="max-w-2xl leading-6">All custom HTML runs in an opaque-origin iframe without cookies, network access or secrets. This policy controls exact-release bridge trust, not whether code runs on NAD&apos;s origin.</CardDescription>
      </CardHeader>
      <CardContent className="max-w-xl space-y-4">
        <div className="space-y-2">
          <Label htmlFor="trusted-code-policy">Default policy</Label>
          <Select value={policy} onValueChange={(value) => { setPolicy(value as TrustedCodePolicy); setMessage(null); }}>
            <SelectTrigger id="trusted-code-policy" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="reviewed_auto">Reviewed releases automatically</SelectItem><SelectItem value="manual_each_release">Approve each release manually</SelectItem><SelectItem value="sandbox_only">Sandbox only</SelectItem></SelectContent>
          </Select>
          <p className="text-xs leading-5 text-muted-foreground">{descriptions[policy]}</p>
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {message ? <p role="status" className="text-sm text-success">{message}</p> : null}
        <Button onClick={() => void save()} disabled={pending}>{pending ? 'Saving…' : 'Save UI policy'}</Button>
      </CardContent>
    </Card>
  );
}
