# Fleet Mail

## Purpose
One private inbox for new catch-all mail across the owner's 11 domains, with replies from the exact receiving address.

## Source
Stock Quickinbox at `bae9da459b68aa6164ed4e5c84a452b7423c277a`, retaining its UI and MIT license. The superseded Agentic Inbox prototype's PR is closed; its complete Git history is retained in an owner-local recovery bundle.

## Scope
Cloudflare Workers, D1, R2 and Email Service. Single-owner Cloudflare Access email-code login. New mail only; no historical personal-inbox import.

The current Zero interface filters by domain only: All domains or one connected domain, including mail for unregistered catch-all recipients. The default sending aliases are kept for composing; they are not inbox selectors. This interface clears old address-filter links automatically while retaining open conversations and other filters.

## Verification — 2026-10-27
381 upstream tests and 14 owner/provisioning tests passed. Typecheck before and after build passed with four existing upstream Svelte warnings. Production build, deployment dry-run and current-main CI passed. Independent CodeVetter review identified authentication, provisioning and packaging defects; confirmed findings were fixed and checked.

Live verification passed: owner email-code sign-in, storage for all 11 domain inboxes, actual catch-all receipt at an unregistered address on every domain, recipient-address search, and a Reply-button message delivered to owner Gmail from the exact receiving address. Stock UI inspected at 390, 768 and 1440 pixel widths.

## Deployment
https://mail.significanthobbies.com

Cloudflare Access protects this custom domain and the original Workers hostname with the same owner-only email-code policy. The custom domain changes the web entry point; all 11 catch-all rules continue to invoke the same `fleet-mail` Worker.

Dedicated Worker `fleet-mail`, D1 `fleet-mail`, R2 `fleet-mail-attachments`. All 11 domain catch-all rules invoke `fleet-mail`; the prior forwarding rules are retained in owner-local rollback snapshots. Domain sending is enabled for all 11 domains. Password/setup/pairing and API-token login stay closed. Browser and REST login use Cloudflare Access.

## Local agent connection — 2026-11-06
`cli/fleet-mcp.ts` connects a local Codex stdio MCP server to the existing REST API with the owner's Cloudflare Access session. It reuses the CLI mail tools and adds sending-identity discovery. It does not change catch-all rules or run automatic replies. Mail send/reply delivery through this connection has not been exercised.

## Hosted agent connection — 2026-11-06
The hosted `/mcp` deployment uses OAuth with an exact machine-route allowlist and resource-bound owner grants. Consent stays behind signed owner-only Access. On 2026-11-06, live owner consent, PKCE exchange, mailbox reads, refresh rotation and revocation passed; anonymous MCP calls returned 401 while browser/REST routes retained Access. All ten tools are available. The deployment config sets the shared owner send budget to 1,000 per UTC day across all domains, matching the currently verified Cloudflare account quota; other account usage also consumes the provider quota. The ChatGPT plugin is connected; a read-only `whoami` check in ChatGPT confirmed the connection works and sending is enabled. No test email was sent or modified; outbound delivery remains untested.

## Next
Use the domain-filtered inbox. Per-address inbox navigation and historical mail migration are outside the owner's current scope.
