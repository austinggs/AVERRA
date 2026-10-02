# AVERRA — SUPPORT & CONTACT POLICY

Document: `85_SUPPORT_AND_CONTACT_POLICY.md`  
Version: 1.1  
Status: Approved planning baseline  
Last reviewed: 2026-09-30

## PURPOSE
Define Averra's official support channels, human-only support policy, ticket lifecycle, Telegram handling, notification architecture, escalation controls, priority support, and privacy/security rules.

## 1. CORE POLICY — 0% AI CUSTOMER SUPPORT
Averra customer support is **100% human-operated**.

AI-generated customer-support replies are prohibited in the production support system.

Averra MUST NOT:
- use an AI chatbot as a customer-support representative;
- automatically generate and send conversational support replies using AI;
- present AI-generated text as if written by a human support agent;
- allow AI to approve deposits, withdrawals, refunds, account changes, fraud decisions, disputes, or other financial/support exceptions.

AI development agents may be used by the engineering team to build Averra, but they are outside the customer-support runtime and must never be exposed as support agents.

## 2. OFFICIAL SUPPORT CHANNELS
### Primary — In-app Support Center
The in-app Support Center and ticketing system are the authoritative support channel and case record.

Users can:
- create tickets;
- select a category;
- describe the issue;
- attach permitted evidence;
- view ticket status;
- receive human replies;
- reply to the ticket;
- view resolution history.

### Telegram — @vipaverra
`@vipaverra` is the official Averra Telegram support contact and is human-operated.

Telegram is an intake/contact channel, not the authoritative account or financial system.

### Help Center / FAQ
Provides self-service documentation for common questions, including rewards, withdrawals, MiniPay deposits, Cash Link, fees, Mining Game, paid perks, referrals, and account support.

### Email
No official support email is configured yet. The documentation MUST NOT invent or publish an email address until one is created and approved.

## 3. SUPPORT TICKET LIFECYCLE
Recommended states:
`OPEN → ASSIGNED → IN_PROGRESS → WAITING_FOR_USER → WAITING_FOR_INTERNAL_TEAM → RESOLVED → CLOSED`

Eligible closed tickets may be reopened according to policy.

Every human reply and material support action should include actor identity, timestamp, ticket reference, and audit linkage.

## 4. AUTOMATED SYSTEM NOTIFICATIONS
Automation is allowed for factual state notifications only, for example:
- ticket created;
- ticket assigned;
- support agent replied;
- ticket status changed;
- deposit submitted;
- deposit verified/confirmed/rejected;
- withdrawal status changed;
- request expired;
- system maintenance notice.

These are system events, not conversational support responses.

The UI MUST clearly distinguish automated system notifications from human-authored support messages.

## 5. LOW-COST NOTIFICATION ARCHITECTURE
Averra does not require a paid notification API for the initial support system.

Required launch architecture:
- first-party notification table/records;
- in-app notification center;
- unread badge/count;
- ticket-thread unread indicator;
- server-side creation of notification events.

Push, email, SMS, or third-party notification services may be added later, but they must be optional and replaceable.

## 6. TELEGRAM HANDLING
A support operator may receive a message through `@vipaverra` and:
1. identify the general issue;
2. request the Averra ticket/reference ID where appropriate;
3. create or link an in-app ticket;
4. continue the material case inside Averra's support workflow;
5. escalate to the proper operations team when necessary.

Telegram MUST NOT be used to:
- collect passwords, OTPs, seed phrases, private keys, or wallet secrets;
- authorize balance credits;
- approve withdrawals;
- confirm deposits without the documented payment verification controls;
- approve refunds outside policy;
- disable fraud controls;
- change account ownership;
- create an undocumented financial exception.

Support agents should not request a user to send funds to an employee's personal wallet.

## 7. PAYMENT SUPPORT
For MiniPay deposits, Cash Link payments, Daimo deposits, and withdrawals, support may collect the relevant request ID and transaction hash and attach them to the ticket.

Support communication does not itself constitute settlement.

Financial operations remain governed by:
- on-chain/provider verification;
- authorized payment roles;
- admin confirmation where required;
- immutable ledger events;
- reconciliation;
- audit logging.

## 8. PRIORITY SUPPORT
Priority Support is an optional paid perk.

It provides support queue/response-priority benefits only.

It MUST NOT guarantee:
- deposit approval;
- withdrawal approval;
- fraud-review outcomes;
- refunds;
- dispute outcomes;
- financial exceptions;
- bypassing ordinary verification or security controls.

Priority Support remains entirely human-operated. It does not unlock AI support.

## 9. SUPPORT CATEGORIES
Recommended launch categories:
- Account & Access
- Rewards & Tasks
- Surveys & Offers
- MiniPay Deposits
- Cash Link
- Daimo / Hurry
- Withdrawals & Payments
- Mining Game
- Referrals
- Paid Perks
- Donations
- Fraud / Security
- Technical Issue
- Privacy / Data
- Other

## 10. ESCALATION
Support must escalate cases to authorized teams when they involve:
- payment verification;
- withdrawal approval or failure;
- suspected fraud or abuse;
- account takeover/security incidents;
- provider disputes;
- legal/compliance matters;
- data/privacy requests;
- high-value financial exceptions.

The support agent may coordinate the case but must not bypass the receiving team's controls.

## 11. DATA MINIMIZATION
Collect only the information required to resolve the case. Avoid requesting secrets or unnecessary personal information through Telegram or support attachments.

Financial evidence should be linked to the relevant Averra entity rather than duplicated unnecessarily across free-text conversations.

## 12. SOURCE-OF-TRUTH RULE
Support tickets are authoritative for customer-support communication.

Financial ledgers, payment operations, withdrawal records, provider settlement records, and verified blockchain evidence remain authoritative for financial state.

A support message can reference financial state but cannot replace the financial record.

## 13. AUDIT
Log:
- ticket creation;
- assignment;
- priority changes;
- human replies;
- status changes;
- escalation;
- linked financial entities;
- material support actions;
- administrative overrides where explicitly permitted.

Support logs must be tamper-evident/append-oriented according to Averra's audit architecture.

## 14. IMPLEMENTATION REQUIREMENTS
The first release must work with no dedicated support email, no paid notification provider, no AI support runtime, and no Telegram bot dependency.

The minimum viable support stack is:
- in-app ticketing;
- human admin/support dashboard;
- database-backed in-app notifications;
- Telegram `@vipaverra` as an external human contact channel;
- audit logging;
- escalation to payment/operations teams.

## RELATED DOCUMENTS
- `43_ADMIN_PLATFORM.txt`
- `44_SUPPORT_SYSTEM.txt`
- `45_NOTIFICATION_SYSTEM.txt`
- `49_API_SPECIFICATION.txt`
- `50_BACKEND_ARCHITECTURE.txt`
- `53_SECURITY_ARCHITECTURE.txt`
- `59_PLATFORM_OPERATIONS.txt`
- `65_TESTING_STRATEGY.md`
- `70_ACCEPTANCE_CRITERIA.md`
- `71_ARCHITECTURAL_LAWS.md`
- `79_AGENTS.txt`
- `82_SOURCE_INDEX.md`
- `83_MONETIZATION_PAID_PERKS.md`
- `84_USER_FUNDING_DEPOSIT_SYSTEM.md`


## V7 Admin Integration
Operational administration for this subsystem is defined in `87_ADMIN_PORTAL_EXPANDED.md`.
