# Fleet Mail

## Purpose
One private inbox for new catch-all mail across the owner's 11 domains, with replies from the exact receiving address.

## Source
Stock Quickinbox at `bae9da459b68aa6164ed4e5c84a452b7423c277a`, retaining its UI and MIT license. The previous Agentic Inbox prototype is preserved on its own branch and draft PR.

## Scope
Cloudflare Workers, D1, R2 and Email Service. Single-owner Cloudflare Access email-code login. New mail only; no historical personal-inbox import.

Inbox navigation filters by domain only: All domains or one connected domain, including mail for unregistered catch-all recipients. The default sending aliases are kept for composing; they are not inbox selectors. Old address-filter links are cleared automatically.

## Verification — 2026-10-27
381 upstream tests and 14 owner/provisioning tests passed. Typecheck before and after build passed with four existing upstream Svelte warnings. Production build, deployment dry-run and current-main CI passed. Independent CodeVetter review identified authentication, provisioning and packaging defects; confirmed findings were fixed and checked.

Live verification passed: owner email-code sign-in, storage for all 11 domain inboxes, actual catch-all receipt at an unregistered address on every domain, recipient-address search, and a Reply-button message delivered to owner Gmail from the exact receiving address. Stock UI inspected at 390, 768 and 1440 pixel widths.

## Deployment
https://mail.significanthobbies.com

Cloudflare Access protects this custom domain and the original Workers hostname with the same owner-only email-code policy. The custom domain changes the web entry point; all 11 catch-all rules continue to invoke the same `fleet-mail` Worker.

Dedicated Worker `fleet-mail`, D1 `fleet-mail`, R2 `fleet-mail-attachments`. All 11 domain catch-all rules now invoke `fleet-mail`; they no longer forward directly to personal Gmail. The prior forwarding rules are retained in owner-local rollback snapshots. Domain sending is enabled for all 11 domains. Password/setup/pairing, API-token and MCP login paths stay closed; Access is the sole HTTP login.

## Next
Use the domain-filtered inbox. Per-address inbox navigation and historical mail migration are outside the owner's current scope.
