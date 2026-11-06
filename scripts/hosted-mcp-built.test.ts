import assert from 'node:assert/strict';
import { mock, test } from 'bun:test';
import { createTestDb, insertTestUser } from '../src/lib/server/test-db';
import { issueAuthorizationCode, registerClient } from '../src/lib/server/oauth';

const origin = 'https://mail.example.com';
const { db, sqlite } = createTestDb();
insertTestUser(sqlite, 'owner');
sqlite.query('UPDATE users SET is_admin = 1 WHERE id = ?').run('owner');
const env = {
	ACCESS_TEAM_DOMAIN: 'https://test-team.cloudflareaccess.com', ACCESS_AUD: 'owner-audience',
	ACCESS_OWNER_EMAIL: 'owner@example.com', APP_URL: origin, DB: db,
	ASSETS: { fetch: async () => new Response('Missing asset', { status: 404 }) }
};

mock.module('cloudflare:workers', () => ({ env }));
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } } as unknown as CacheStorage;
const { default: worker } = await import('../src/worker');
const context = { waitUntil() {}, passThroughOnException() {} };
const send = (request: Request) => worker.fetch(request, env as unknown as Env, context as never);
const form = (path: string, params: Record<string, string>, headers: HeadersInit = {}) => {
	const requestHeaders = new Headers(headers);
	requestHeaders.set('content-type', 'application/x-www-form-urlencoded');
	return new Request(`${origin}${path}`, { method: 'POST', headers: requestHeaders,
		body: new URLSearchParams(params).toString() });
};

test('production worker accepts no-Origin form token exchange, refresh and revocation', async () => {
	const redirectUri = 'https://chatgpt.com/connector_platform/oauth/callback';
	const client = await registerClient(db, { client_name: 'ChatGPT', redirect_uris: [redirectUri] });
	const code = await issueAuthorizationCode(db, {
		client_id: client.client_id, user_id: 'owner', scope: ['mail:read'], resource: `${origin}/mcp`, redirect_uri: redirectUri,
		code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
	});
	const exchange = await send(form('/oauth/token', { grant_type: 'authorization_code', client_id: client.client_id,
		code, redirect_uri: redirectUri, resource: `${origin}/mcp`, code_verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk' }));
	assert.equal(exchange.status, 200);
	const tokens = await exchange.json() as { access_token: string; refresh_token: string };
	assert(tokens.access_token && tokens.refresh_token);
	const refresh = await send(form('/oauth/token', { grant_type: 'refresh_token', client_id: client.client_id,
		refresh_token: tokens.refresh_token, resource: `${origin}/mcp` }));
	assert.equal(refresh.status, 200);
	const rotated = await refresh.json() as { access_token: string };
	assert(rotated.access_token && rotated.access_token !== tokens.access_token);
	const revoke = await send(form('/oauth/revoke', { token: rotated.access_token, client_id: client.client_id }));
	assert.equal(revoke.status, 200);
	assert.equal((await send(new Request(`${origin}/mcp`, { headers: { authorization: `Bearer ${rotated.access_token}` } }))).status, 401);
});

test('production framework still rejects cross-origin browser and consent forms', async () => {
	for (const path of ['/oauth/authorize', '/api/drafts']) {
		const response = await send(form(path, { decision: 'allow' }, { origin: 'https://foreign.example' }));
		assert.equal(response.status, 403);
		assert.match(await response.text(), /Cross-site POST form submissions are forbidden/);
	}
	const ownerConsent = await send(form('/oauth/authorize', { decision: 'allow' }, { origin }));
	assert.equal(ownerConsent.status, 403);
	assert.match(await ownerConsent.text(), /Cloudflare Access sign-in required/);
});

test('only exact OAuth machine forms are normalized and oversized input is rejected', async () => {
	for (const path of ['/oauth/token/extra', '/oauth/revoke/', '/mcp']) {
		const response = await send(form(path, { client_id: 'client' }));
		assert.equal(response.status, 403);
		assert.match(await response.text(), /Cross-site POST form submissions are forbidden/);
	}
	const oversized = await send(form('/oauth/token', { client_id: 'x'.repeat(17_000) }));
	assert.equal(oversized.status, 413);
});
