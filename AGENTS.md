# Fleet Mail

Private single-owner deployment of DivinPrince/quickinbox, with its existing UI and MIT license retained.

- Keep upstream behavior; limit changes to the owner's mail workflow and deployment.
- Cloudflare Access is the sole production login. Verify its signed JWT, audience, issuer, expiry and exact owner email before exposing any HTTP route. Password/setup/pairing and MCP authentication stay closed in Access mode.
- Keep mail private. Do not add AI services, external analytics or notifications unless requested.
- Use the managed Fleet workspace and pinned pnpm install. Run `pnpm run check`, `pnpm test`, `node --test src/lib/server/owner-access.test.ts`, and `pnpm run build` for changed authentication/deployment behavior.
- Do not change domain catch-all rules until storage and owner-only access are qualified. Preserve the previous rules for rollback.
