import { listChannels } from '@/lib/notifications/channels';
import { CHANNEL_SCHEMAS } from '@/lib/notifications/providers';
import { NotificationsManager } from '@/components/settings/notifications-manager';

export const dynamic = 'force-dynamic';

export default async function NotificationSettingsPage(): Promise<React.JSX.Element> {
  const channels = await listChannels();

  return (
    <NotificationsManager
      initialChannels={channels}
      schemas={CHANNEL_SCHEMAS}
    />
  );
}
