import { headers } from 'next/headers';
import { getGeneralSettings } from '@/lib/access';
import { getRequestOrigin } from '@/lib/access-url';
import { getAppName } from '@/lib/settings';
import { GeneralSettingsForm } from '@/components/settings/general-settings-form';
import { TrustedCodePolicyForm } from '@/components/settings/trusted-code-policy';
import { getTrustedCodePolicy } from '@/lib/modules/installed/trust';

export const dynamic = 'force-dynamic';

export default async function GeneralSettingsPage(): Promise<React.JSX.Element> {
  const [settings, requestHeaders, dashboardName] = await Promise.all([
    getGeneralSettings(),
    headers(),
    getAppName(),
  ]);

  return (
    <div className="space-y-5">
      <GeneralSettingsForm
        initialCanonicalUrl={settings.canonicalUrl}
        envCanonicalUrl={settings.envCanonicalUrl}
        initialAccessMode={settings.accessMode}
        requestOrigin={getRequestOrigin(requestHeaders) ?? null}
        dashboardName={dashboardName}
      />
      <TrustedCodePolicyForm initialPolicy={getTrustedCodePolicy()} />
    </div>
  );
}
