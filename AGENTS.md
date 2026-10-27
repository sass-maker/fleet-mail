# Fleet Mail

Private single-owner deployment of DivinPrince/quickinbox, with its existing UI and MIT license retained.

- Keep upstream behavior; limit changes to the owner's mail workflow and deployment.
- Cloudflare Access is always the sole HTTP login. Verify its signed JWT, audience, issuer, expiry and exact owner email before exposing any HTTP route. Missing configuration fails closed. Password/setup/pairing and MCP authentication stay closed; verified-owner domain onboarding remains available.
- Keep mail private. Do not add AI services, external analytics or notifications unless requested.
- Use the managed Fleet workspace and pinned pnpm install. Run `pnpm run verify` for changed authentication/deployment behavior. Use `pnpm provision:local` or `pnpm provision:remote` after migrations to provision and verify the sole owner and domain inboxes without replacing stored mail.
- Do not change domain catch-all rules until storage and owner-only access are qualified. Preserve the previous rules for rollback.
