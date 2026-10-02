import { requireUser } from '@/lib/auth/session';
import { listMyNotifications } from '@/lib/notifications/service';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState, Pill } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';

export const metadata = { title: 'Notifications - Averra' };

// The in-app notification centre (doc 45).
//
// This page makes a distinction the spec insists on (law 60): these are FACTUAL
// SYSTEM EVENTS, not support replies. The notice says so explicitly, so a user
// never mistakes a status message for a human response.

export default async function NotificationsPage() {
  const user = await requireUser();

  // Routed through `public.list_my_notifications`, NOT `.from('notifications')`.
  // The `app` schema is not exposed through the Data API.
  //
  // The unread count is derived from this one list rather than fetched
  // separately: the wrapper already returns at most 50 rows, and two round
  // trips that could disagree are worse than one that cannot.
  const notifications = await listMyNotifications(user.id, 50);
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  return (
    <div>
      <PageHeader
        title="Notifications"
        description={unreadCount > 0 ? `${unreadCount} unread.` : 'You are all caught up.'}
      />

      {/* Law 60. Structural, not decorative: this notice cannot be removed by a
          page-level layout change without someone deleting it deliberately. */}
      <Card tone="sunken" className="mt-4">
        <p className="text-xs leading-relaxed text-ink-700">
          These are automated status updates about your account. They are factual system events, not
          messages from a support agent. To speak with a human, open a support ticket.
        </p>
      </Card>

      {notifications.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nothing here yet"
            description="Reward, deposit and withdrawal updates appear here."
          />
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {notifications.map((notification) => {
            const unread = !notification.readAt;

            return (
              <li key={notification.id}>
                <Card className={unread ? 'border-brand-200 bg-brand-50' : undefined}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-semibold text-ink-900">{notification.title}</h2>
                        {unread ? <Pill tone="brand">Unread</Pill> : null}
                      </div>

                      <p className="mt-1.5 text-sm leading-relaxed text-ink-700">
                        {notification.body}
                      </p>
                      <p className="mt-1.5 text-xs text-ink-500">
                        {String(notification.category).toLowerCase()} ·{' '}
                        {new Date(notification.createdAt).toLocaleString()}
                      </p>
                    </div>

                    {notification.actionPath ? (
                      <ButtonLink
                        href={notification.actionPath}
                        variant="secondary"
                        size="sm"
                        className="shrink-0"
                      >
                        {notification.actionLabel ?? 'View'}
                      </ButtonLink>
                    ) : null}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-8">
        <ButtonLink href="/support" variant="secondary" size="sm">
          Open the Support Center
        </ButtonLink>
      </div>
    </div>
  );
}
