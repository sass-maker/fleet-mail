# Fleet Mail

## Purpose
One private inbox for new catch-all mail across the owner's domains, with replies from the receiving address.

## Source
Stock Quickinbox at `bae9da459b68aa6164ed4e5c84a452b7423c277a`, retaining its UI and MIT license. The previous Agentic Inbox prototype is preserved on its own branch and draft PR.

## Scope
Cloudflare Workers, D1, R2 and Email Service. Single-owner Cloudflare Access email-code login. No historical personal-inbox import.

## Verification
Upstream baseline: 381 tests passed; typecheck passed with four upstream Svelte warnings. Deployment and changed authentication verification are in progress.

## Deployment
Dedicated Worker `fleet-mail`, D1 `fleet-mail`, R2 `fleet-mail-attachments`. Mail routing must be qualified before cutover; no successful live mail claim yet.

## Remaining
Verify Access sign-in, provision all domains, qualify live receive/reply and retain rollback routing snapshots.
