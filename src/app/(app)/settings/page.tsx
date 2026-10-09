import { requireUser, getProfile, accountAccessState } from '@/lib/auth/session';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, Pill, SectionHeading } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';
import { DisplayNameForm } from '@/components/settings/DisplayNameForm';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

export const metadata = { title: 'Settings - Averra' };

// Settings (never built; the gap is recorded in docs/DISCREPANCIES.md Q-38).
//
// SCOPE, DELIBERATELY NARROW
//
// This page shows what the user owns and lets them change what is genuinely theirs.
// It cannot change `account_status`, and there is no toggle here that pretends to
// unlock earning, withdrawal or a balance. Doc 03 is explicit that paying or
// configuring must never unlock monetary rights, and a settings page full of
// switches that look like entitlements is exactly how that promise gets eroded.
//
// What is NOT here yet, and should be: notification preferences, session
// management, and referral code. The first needs a table that does not exist; the
// third is Phase 1.

const STATUS_COPY: Record<string, string> = {
  ACTIVE: 'Your account is active. You can earn, deposit and withdraw as normal.',
  SUSPENDED: 'This account is suspended. Only a human support agent can explain why.',
  CLOSED: 'This account is closed.',
};

export default async function SettingsPage() {
  const user = await requireUser();
  const profile = await getProfile(user.id);
  const access = accountAccessState(profile);

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Your account details and what you own. Anything that affects money can only be changed by Averra, never from here."
      />

      <section className="mt-6">
        <SectionHeading title="Profile" />
        <Card className="mt-3">
          {access === 'UNPROVISIONED' ? (
            <p className="text-sm leading-relaxed text-ink-500">
              We are still finishing setting up your account, so there is nothing to edit yet.
              Reload this page in a moment.
            </p>
          ) : (
            <DisplayNameForm
              initialName={profile?.display_name ?? ''}
              email={user.email ?? null}
              accountStatus={profile?.account_status ?? 'ACTIVE'}
            />
          )}
        </Card>
      </section>

      <section className="mt-6">
        <SectionHeading title="Appearance" />
        <Card className="mt-3">
          {/*
            A DISPLAY PREFERENCE, and grouped with "what you own" rather than
            "what we control" for one reason: it is the only setting on this page
            that changes nothing on our side. It is stored in this browser, it is
            not an account attribute, and clearing site data resets it. The copy
            says so, because a user who expects their theme to follow them to
            another device will otherwise assume it broke.
          */}
          <ThemeToggle />

          <p className="mt-4 text-xs leading-relaxed text-ink-500">
            Light, dark or your device&apos;s setting. This is remembered in this browser only and
            is not tied to your account, so it will not follow you to another device.
          </p>
        </Card>
      </section>

      <section className="mt-8">
        <SectionHeading title="Account status" />
        <Card className="mt-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-700">
              {STATUS_COPY[profile?.account_status ?? ''] ?? 'Status unavailable.'}
            </p>
            <Pill
              tone={access === 'ACTIVE' ? 'brand' : access === 'RESTRICTED' ? 'danger' : 'warning'}
            >
              {access.toLowerCase()}
            </Pill>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-ink-500">
            Only Averra can change this. No setting on this page, and no person outside Averra, can
            lift a restriction or restore a closed account.
          </p>
        </Card>
      </section>

      <section className="mt-8">
        <SectionHeading title="Security" />
        <Card className="mt-3 space-y-2">
          <p className="text-sm text-ink-700">
            Signing in uses your email address and a password held by Averra&apos;s authentication
            provider. Averra cannot read your password.
          </p>
          <p className="text-xs leading-relaxed text-ink-500">
            Password reset, active sessions and two-factor sign-in are not available yet. Until they
            are, if you think someone else has access to this account, change your password and
            contact support immediately.
          </p>
        </Card>
      </section>

      <section className="mt-8">
        <SectionHeading title="Need something changed?" />
        <Card tone="sunken" className="mt-3">
          <p className="text-sm leading-relaxed text-ink-700">
            Support is 100% human-operated. No automated reply, and no AI-generated answer, will
            ever tell you what happened to your account.
          </p>
          <div className="mt-4">
            <ButtonLink href="/support" size="sm">
              Open the Support Center
            </ButtonLink>
          </div>
        </Card>
      </section>
    </div>
  );
}
