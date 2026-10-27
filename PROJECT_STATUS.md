# Fleet Mail

Owner direction, 2026-10-27: use an existing open-source application with minimal customization. This branch is a preserved Agentic Inbox prototype, not the selected production implementation. Quickinbox is the preferred adoption candidate after source inspection; its runtime and real-provider delivery are not yet qualified. Stop adding features to this prototype.

## 1. Purpose and scope

A private inbox for new mail arriving at any username across the owner's 11 domains.
Mail is grouped by domain, then exact receiving address. Replies use that address.
Existing personal-inbox mail import is out of scope by owner choice.

## 2. Source and architecture

Adapted from `cloudflare/agentic-inbox` commit `48039bb6785af34e592c2966f87cde2b255c4c80`, under Apache-2.0.
React Router and Kumo frontend; Hono Worker; one SQLite Durable Object per exact envelope address; R2 raw mail, mailbox metadata and attachments.
Existing authentication uses Cloudflare Access and fails closed outside local development.

## 3. Implementation

- Exact configured-domain allowlist, automatic catch-all mailbox creation and domain/address navigation.
- SMTP envelope routing, including CC/BCC delivery and absent or unrelated MIME To headers.
- Raw `.eml` preservation, deterministic delivery identity and atomic duplicate-safe message/attachment writes.
- Replies constrained to the receiving address. Reply-To initializes the recipient when valid.
- Persisted outbound attempt before provider send, idempotency IDs, provider acceptance and actual provider Message-ID.
- Unconfirmed attempts stay in Drafts with status and recovery guidance. They never silently become Sent or automatically retry.
- AI processing and HTTP/MCP entry points disabled by default. No personal mail import, calendar or team setup added.

## 4. Verification

`tests/core.test.mjs` executes production ingestion, outbound and API source with actual SQLite persistence.
R2 and the external sending provider use controlled test doubles. Cloudflare's real deployed delivery remains unverified.
The root agent records final test, typecheck, build, browser and independent-review results after implementation.

## 5. Deployment and current limits

Local preparation only as of 2026-10-27. No production deployment, routing/DNS change or live mailbox migration was performed by this implementation.
No 11-domain live receive/reply acceptance is claimed. Domain enrollment, sending access, owner-only Access policy, storage/recovery and provider limits require qualification before cutover.
An ambiguous provider outcome deliberately requires checking before a new send. Provider acceptance does not establish delivery to the recipient.
Inherited upstream dependency vulnerabilities require release review; package upgrades are deferred to a separate release review.

## 6. Next action

Qualify stock https://github.com/DivinPrince/quickinbox against the combined-inbox and catch-all reply workflow. Keep this prototype unmerged and undeployed; the final review still has in-flight deletion, recovery and draft-threading findings.22 native tests, typecheck and build passed, but final browser verification became unavailable.
Keep current forwarding until the new receive/read/reply workflow is proven and the owner authorizes cutover.
