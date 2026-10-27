# Domain Inbox

A private catch-all inbox for your domains. Every receiving address appears automatically under its domain, and replies use that exact address.

Adapted from [Cloudflare Agentic Inbox](https://github.com/cloudflare/agentic-inbox) at `48039bb6785af34e592c2966f87cde2b255c4c80`. Cloudflare's copyright and Apache-2.0 license are retained in [LICENSE](LICENSE).

## Included

- New incoming mail at any username on configured domains.
- Domain and address navigation, conversations, search, drafts and attachments.
- Envelope-recipient routing for direct, CC and BCC mail.
- Replies from the receiving mailbox and normal Reply-To support.
- Raw message preservation and duplicate-safe ingestion.
- Saved outbound attempts with provider acceptance or unconfirmed status.
- Private access through Cloudflare Access in production.

Historical personal-inbox import is excluded. AI and MCP are disabled by default, and the app sends no third-party analytics.

## Run locally

Use Node 24 and the checked-in npm lockfile.

```sh
npm ci
npm run dev
```

Vite disables remote bindings for local development. Local mail tests do not send real messages. Set the local Worker `DOMAINS` binding to comma-separated test domains through your normal local configuration process. Do not commit real credentials. An empty domain list accepts no mail.

```sh
npm test
npm run typecheck
npm run build
```

The test suite bundles actual Worker source and executes mailbox persistence with SQLite. It controls the external R2/provider boundaries. These tests do not prove a live Cloudflare account can receive or send.

## Mail behavior

Each domain's catch-all routing must point to the deployed Worker. The SMTP envelope receiving address selects the mailbox; the visible To header does not control routing. New addresses require no prior mailbox setup. The application checks the configured domains before saving mail.

Incoming raw `.eml` messages are stored in R2 before parsing. A digest of the exact receiving address and raw mail identifies a delivery. Identical retries for that address do not duplicate it, and delivery to a second address remains a separate mailbox record.

Replies retain the mailbox From identity. New outbound attempts are saved in Drafts with `pending` status before the provider is called. Provider acceptance moves them to Sent with `accepted` status and records the provider Message-ID. An error or interruption retains an unconfirmed copy for recovery. Reusing the same operation ID never automatically sends again; using it with altered content is rejected.

An unconfirmed attempt may already have reached the provider. Check before creating a replacement message. Provider acceptance is not proof of recipient delivery.

## Production activation

Production remains unconfigured until account and domain qualification is complete.

1. Keep the existing forwarding in place during preparation.
2. Provision this project's isolated Worker, Durable Object namespace and R2 bucket.
3. Configure an owner-only Cloudflare Access policy. Production refuses HTTP access without valid Access configuration and identity.
4. Configure the 11 owned domains and onboard each required sending domain. Cloudflare Email Sending has its own plan, enrollment, quota and message-size limits.
5. Qualify one domain with new direct, CC and BCC mail, attachments, read/reopen and an exact-address reply observed in an independent inbox.
6. Verify provider failures and recoverable stored content, then authorize and verify the remaining routing cutover.

The upstream Wrangler file is a template, not evidence that an account is configured. No app release or DNS/routing change occurs from the CI workflow.

Optional AI requires an explicit `AI_ENABLED=true` binding and separate privacy/provider qualification. The default does not process mail with AI or expose the upstream agent/MCP endpoints.

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for implementation and verification limits.
