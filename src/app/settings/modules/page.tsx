import { getAllModuleStates } from '@/lib/modules/registry';
import { ModuleList, type ModuleListItem } from '@/components/settings/module-list';
import { ModuleInstaller } from '@/components/settings/module-installer';
import { MarketplaceBrowser } from '@/components/settings/marketplace-browser';
import { MarketplaceSecurityPanel } from '@/components/settings/marketplace-security-panel';
import { refreshAndEnforceMarketplaceSecurity } from '@/lib/marketplace/security-enforcement';

export const dynamic = 'force-dynamic';

export default async function ModulesSettingsPage(): Promise<React.JSX.Element> {
  const [states, marketplaceSecurity] = await Promise.all([
    getAllModuleStates(),
    refreshAndEnforceMarketplaceSecurity(),
  ]);
  const modules: ModuleListItem[] = states.map(({ manifest, status }) => ({
    slug: manifest.slug,
    name: manifest.name,
    description: manifest.description,
    icon: manifest.icon,
    category: manifest.category,
    status,
    version: manifest.version,
    publisher: manifest.publisher,
  }));

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Plugins</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Install signed plugins, configure their connection details, then enable the ones you want on your Dashboard.
        </p>
      </div>
      <MarketplaceSecurityPanel state={marketplaceSecurity} />
      <MarketplaceBrowser />
      <ModuleInstaller />
      <ModuleList modules={modules} />
    </section>
  );
}
