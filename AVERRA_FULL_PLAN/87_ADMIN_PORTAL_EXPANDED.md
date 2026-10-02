# AVERRA ADMIN PORTAL — EXPANDED SPECIFICATION

Document: 87_ADMIN_PORTAL_EXPANDED.md
Version: 1.0
Status: Approved planning baseline
Last reviewed: 2026-09-30


## Purpose
The Admin Portal is Averra's human-operated control center for platform operations. It must expose operational controls without becoming a bypass around financial, security, support, moderation, or audit rules.

## Core principles
- Human authorization is required for sensitive financial actions.
- The frontend is never the financial source of truth.
- Every material admin mutation is authenticated, authorized, auditable, and attributable to a specific operator.
- Least privilege is mandatory; do not use one universal admin role.
- High-risk actions require step-up authentication and, where configured, dual approval.
- Admin interfaces must distinguish preparation, review, approval, settlement, and reconciliation.
- Admin tooling must not silently rewrite immutable financial history.
- Support is 100% human-operated; AI-generated customer replies are prohibited.

## Portal navigation
1. Overview
2. Users
3. Tasks / Offers / Surveys
4. Providers
5. Advertisers
6. Financial Operations
7. Withdrawals
8. Deposits / User Funding
9. Fraud & Risk
10. Disputes
11. Support
12. Reviews & Community
13. Mining Game
14. Promotions / Paid Perks
15. Notifications
16. Analytics
17. Reconciliation
18. System Configuration
19. Admin Access / Roles
20. Audit Logs

## Dashboard
Show operational queues and health indicators, not just vanity analytics:
- pending deposits
- deposits awaiting admin confirmation
- Daimo Hurry requests
- withdrawals awaiting review
- payments in progress
- reconciliation exceptions
- fraud cases
- support tickets by status
- review reports
- provider callback failures
- provider health
- scheduled automation failures
- game economy alerts
- system incidents

Sensitive financial totals should use server-authoritative queries and role-specific visibility.

## User management
Admins may search and inspect users according to role permissions. User profile views can include:
- account status
- registration/activity history
- reward activity
- funding balance activity
- withdrawal history
- deposit history
- support tickets
- reviews
- referrals
- fraud/risk flags
- game account state

Direct balance editing is prohibited. Financial corrections must use approved adjustment workflows that create compensating ledger events.

## Financial Operations
The portal must separate:
- earned rewards
- user-funded balance
- pending rewards
- withdrawable balance
- withdrawal requests
- payment operations
- deposits
- fees
- revenue
- reconciliation records

### Withdrawal workflow
withdrawal_status:         REQUESTED -> ELIGIBILITY_CHECKED -> RISK_REVIEW -> APPROVED -> PROCESSING
                           -> PAYMENT_INITIATED -> CONFIRMED -> COMPLETED
                           (terminal: FAILED, REJECTED, CANCELLED, EXPIRED)
payment_settlement_status:  NOT_STARTED -> INITIATED -> SETTLEMENT_PENDING
                           -> SETTLED | SETTLEMENT_FAILED | REVERSED
reconciliation_status:      PENDING -> MATCHED | VARIANCE | RESOLVED

The former ELIGIBILITY_CHECK token is ELIGIBILITY_CHECKED. The former SETTLEMENT
and RECONCILED steps are now their own lifecycles, not withdrawal_status values.

For manual methods, the operator records the payment operation and evidence. For automatic crypto, the provider adapter reports its own settlement state. `APPROVED` never means `PAID`.

### Deposit workflow
`PENDING -> SUBMITTED -> VERIFIED -> CONFIRMED`

Terminal/review states include `REJECTED`, `EXPIRED`, and `NEEDS_REVIEW`.

For manual MiniPay crypto deposits, the portal must display:
- deposit request ID
- user
- declared amount
- token
- Celo network
- destination address
- submitted tx hash
- verification result
- detected amount
- confirmations
- timestamp
- evidence
- prior matching attempts
- operator history

The admin confirmation action creates the authoritative financial credit; the client cannot trigger it.

## Admin roles
Recommended roles:
- SUPER_ADMIN
- FINANCE_ADMIN
- PAYMENT_OPERATOR
- PAYMENT_APPROVER
- DEPOSIT_APPROVER
- RECONCILIATION_OPERATOR
- DEPOSIT_REVIEWER
- FRAUD_REVIEWER
- SUPPORT_AGENT
- SUPPORT_MANAGER
- CONTENT_MODERATOR
- GAME_ADMIN
- PROVIDER_MANAGER
- ADVERTISER_MANAGER
- ANALYST
- AUDITOR

Permissions should be capability-based and stored separately from UI role labels.

## Dual approval
High-value or otherwise sensitive operations can require two distinct authorized humans:
1. operator prepares action
2. second approver independently reviews
3. system records both identities and timestamps
4. only then may the action proceed

The preparer must not approve their own dual-control action.

## Admin authentication
Require strong authentication for privileged access. Recommended controls:
- Supabase Auth for identity/session management
- MFA for privileged roles where available/configured
- short sessions or reauthentication for high-risk actions
- server-side authorization checks
- no authorization based on editable user metadata
- no service-role credentials in browser code

## Support
Support is human-only.
- In-app tickets are the authoritative support record.
- Telegram `@vipaverra` is an official support intake channel.
- Automated messages may announce factual ticket/status events.
- AI must not generate or send customer-support replies.
- Human agents may assign, reply, escalate, close, and document tickets according to permissions.
- Telegram-originated cases should be linked to an in-app ticket where practical.

## Reviews & Community
Moderators can:
- review reports
- inspect reported text/images
- hide/remove content
- restore content
- handle appeals
- manage verified-experience status
- suspend abusive review privileges where policy permits

Moderation actions must be logged and must not modify financial records.

## Mining Game administration
Game admins may configure content and operational parameters, but may not directly mint financial rewards. Game resources remain separate from the financial ledger.

## Provider management
Provider managers can:
- configure provider status
- inspect callbacks
- review integration errors
- suspend providers
- reconcile provider conversions
- manage provider-specific economics

Provider credentials/secrets are never displayed in plaintext to ordinary admins.

## Paid perks and fee configuration
Authorized admins may manage:
- paid perk products
- subscription status
- entitlement rules
- pricing
- 15% Platform Service & Maintenance Fee configuration

Fee changes must be versioned, auditable, and announced according to change-management policy. The portal must display gross, fee, and net amounts for affected transactions.

## Automation control
Supabase-backed automations may be monitored and retried by authorized operators. Admins must see:
- job name
- schedule
- last run
- status
- error
- retry count
- affected records
- idempotency/result reference

A retry must not duplicate financial credits, payments, rewards, or notifications.

## Audit logs
Record at minimum:
- admin identity
- role/permission used
- action
- target record
- before/after state where appropriate
- reason
- timestamp
- request/session correlation ID
- approval chain
- result/error

Audit records should be append-only from the application perspective.

## Supabase implementation
The Admin Portal should use Supabase as the backend platform:
- PostgreSQL for authoritative operational data
- RLS for user-facing data access
- privileged server-side/Edge Function operations for sensitive workflows
- Storage for controlled evidence/media
- Realtime only where operationally useful
- scheduled jobs/Edge Functions for custom automations

Use dedicated internal schemas where appropriate and expose only the minimum Data API surface. Never expose Supabase secret/service-role keys to Vercel browser bundles.

## Vercel deployment
The web Admin Portal is part of the Averra web application deployed through Vercel. Sensitive operations should execute through server-side application routes or Supabase Edge Functions rather than trusting browser-side state.

## Failure handling
Every sensitive action must have a visible failure state and safe retry path. Partial operations must be reconciled rather than hidden. Operators should be able to place records into `NEEDS_REVIEW` instead of forcing an incorrect resolution.

## Acceptance criteria
- Every sensitive admin action requires permission verification server-side.
- Financial actions cannot be performed solely by client-side requests.
- Deposit confirmation cannot be self-triggered by users.
- Dual-control actions prevent self-approval.
- All admin financial actions are auditable.
- Support replies are human-authored.
- Review moderation does not alter financial records.
- Automation retries are idempotent.
- Service-role/secret keys are never shipped to clients.
- Admin UI reflects authoritative database state.
