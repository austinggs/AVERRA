# CPX Research — go-live confirmations (3 questions)

Status: DRAFT — send from the publisher account associated with `app_id`.
Human-authored (78_AI_DEVELOPMENT_RULES: production support comms are never AI-generated;
this file is an internal draft for a human to review and send).

---

**To:** Hello@cpx-research.com
**Subject:** Averra — three quick confirmations before we flip to live

Hello CPX team,

Thank you for the postback on 4 October — attribution, reward amount and status
handling are all landing correctly on our side, and our integration is ready on the
engineering side. Before we move your integration from CANDIDATE to LIVE traffic,
we have three short questions where we need your written confirmation so our
records match yours exactly.

**1. What does `status=1` mean?**

Our integration notes state "1 = completed", but your callback documentation
describes `&status=1` as *pending*. Could you confirm in writing that a callback
carrying `status=1` together with `type=com[plete]` represents a completed,
payable conversion on your side (what we record as VALIDATED)? We do not want to
credit or hold funds on an assumption.

**2. First settlement report**

Once we go live, could you send us our first real settlement report (or point us
to the dashboard/export we should use)? We reconcile every provider conversion
against a matched settlement before any reward becomes withdrawable, so having
the first report establishes the loop from day one. If there is a standard
schedule or format, please let us know.

**3. Offer / survey catalogue delivery**

How do we receive your offer and survey catalogue — an API endpoint, a feed, or
an export from the publisher panel? We want to display CPX surveys natively in
our Earn section with each offer's id, title, payout and tracking link. We note
your `get-surveys` API is per-user and must be refreshed every 120 seconds;
please confirm the recommended way for our server-side integration to pull and
cache that list, and the parameters we should use with our publisher credentials.

For context, our integration uses:

- `subid_1` = our server-minted tracking id (per user session/click)
- `subid_2` = our offer id where applicable
- server-side verification of every callback with our `secure_hash`

We are happy to adjust any of the above to match your recommended pattern.

Looking forward to your reply — we are ready to go live as soon as these three
points are confirmed.

Best regards,
The Averra team
https://vip-averra.vercel.app

---

## Internal notes (do not send)

- Insert our real `app_id` (from publisher.cpx-research.com, or from the
  deployment's `CPX_APP_ID`) into the subject line before sending. It is NOT in
  `.env.local` locally — only on the deployment — so verify rather than guess.
- Q1 mirrors DISCREPANCIES-adjacent CPX contract notes: our adapter records
  `status=1` + `type=com[plete]` as VALIDATED, which is what grants the reward.
  Written confirmation closes the last non-engineering gate.
- Q2: our settlement gate (CR-0033) makes rewards AVAILABLE only from a matched
  provider settlement report — first report is a go-live dependency.
- Q3: no offer inventory exists in `app.offers`/`app.surveys` yet (nothing seeds
  them). The answer to this question is the design input for that loader.
- Never include the secure_hash, any API key, or the database URL in outbound mail.
