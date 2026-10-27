# Fleet Mail prototype

Preserved private prototype adapted from Cloudflare Agentic Inbox. The owner strongly prefers an existing open-source application. Do not continue this custom fork without a new owner instruction; qualify stock DivinPrince/quickinbox for Fleet Mail instead.

- Preserve the Apache-2.0 license and upstream copyright notices. Mark modified upstream files.
- Keep one mailbox per exact receiving address. Route using the SMTP envelope recipient, never MIME To/CC/BCC.
- Only configured `DOMAINS` may receive mail or create mailboxes. An empty list denies all domains.
- Mailbox initialization must preserve existing owner settings. Persist raw mail before parsing and accepting it.
- Retried deliveries must not duplicate stored mail. Receiving failures must propagate to Cloudflare.
- Outbound state is `pending`, `accepted`, or `unknown`. Sent means provider acceptance, never recipient delivery.
- Preserve the receiving address as the reply From address. Keep the provider Message-ID for threading.
- Never automatically resend an unconfirmed attempt. Reusing a send ID with changed content is an error.
- AI and MCP stay disabled unless explicitly enabled. Do not add third-party analytics or expose mail publicly.
- Keep the existing Kumo visual system. Verify phone, tablet and desktop rendering after UI changes.
- Run `npm test`, `npm run typecheck`, and `npm run build`. Production account/domain delivery requires separate live evidence.
- No production deployment, DNS/routing change, credential access, or mailbox-data cleanup without owner scope.
