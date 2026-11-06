import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { RequestEvent } from '@sveltejs/kit';
import { handle } from '../../hooks.server';
import { POST as mcpPost, GET as mcpGet } from '../../routes/mcp/+server';
import { POST as tokenPost } from '../../routes/oauth/token/+server';
import { actions as consentActions, load as consentLoad } from '../../routes/oauth/authorize/+page.server';
import { createApiToken } from './api-tokens';
import { getUserByEmail } from './auth';
import { ownerMcpMethods, ownerMcpOrigin } from './owner-access';
import { getClient, getUserByOAuthToken, issueAuthorizationCode, issueGrant, registerClient, revokeToken } from './oauth';
import { createTestDb, insertTestUser } from './test-db';

const origin = 'https://mail.example.com';
const env = {
	ACCESS_TEAM_DOMAIN: 'https://test-team.cloudflareaccess.com',
	ACCESS_AUD: 'owner-audience',
	ACCESS_OWNER_EMAIL: 'owner@example.com',
	APP_URL: origin
};
const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const redirectUri = 'https://chatgpt.com/connector_platform/oauth/callback';

async function fixture() {
	const { db, sqlite } = createTestDb();
	insertTestUser(sqlite, 'owner');
	insertTestUser(sqlite, 'stranger');
	sqlite.query('UPDATE users SET is_admin = 1').run();
	const client = await registerClient(db, { client_name: 'ChatGPT', redirect_uris: [redirectUri] });
	function event(path = '/mcp', options: { method?: string; headers?: HeadersInit; body?: string; overrides?: Record<string, unknown>; urlOrigin?: string } = {}) {
		const url = new URL(path, options.urlOrigin ?? origin);
		return {
			url,
			request: new Request(url, { method: options.method ?? 'POST', headers: options.headers, body: options.body }),
			platform: { env: { ...env, DB: db, ATTACHMENTS: {}, ...options.overrides } },
			locals: {},
			cookies: { get: () => undefined },
			getClientAddress: () => '192.0.2.1',
			fetch,
			setHeaders() {}
		} as unknown as RequestEvent;
	}
	async function grant(userId = 'owner', resource = `${origin}/mcp`) {
		return issueGrant(db, { clientId: client.client_id, userId, scope: ['mail:read', 'mail:send'], resource });
	}
	return { db, sqlite, client, event, grant };
}

describe('owner hosted MCP boundary', () => {
	test('metadata clients negotiate public PKCE and use Workers-compatible non-following fetch', async () => {
		const { db } = await fixture();
		const clientId = 'https://client.example/oauth/client.json';
		const metadata = { client_id: clientId, client_name: 'ChatGPT',
			redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
			token_endpoint_auth_method: 'private_key_jwt',
			token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'] };
		const fetchMetadata = (async (input, init) => {
			assert.equal(input, clientId);
			if (init?.redirect === 'error') throw new TypeError('Unsupported redirect mode in Workers');
			assert.equal(init?.redirect, 'manual');
			return Response.json(metadata);
		}) as typeof fetch;
		const client = await getClient(db, clientId, fetchMetadata);
		assert.deepEqual(client?.redirect_uris, metadata.redirect_uris);
		await assert.rejects(registerClient(db, metadata), /Only public clients are supported/);
	});

	test('metadata clients reject redirects, mismatched documents and unsupported authentication', async () => {
		for (const kind of ['redirect', 'mismatch', 'private-only']) {
			const { db } = await fixture();
			const clientId = `https://${kind}.example/client.json`;
			let calls = 0;
			const fetchMetadata = (async (_input, init) => {
				calls++;
				assert.equal(init?.redirect, 'manual');
				if (kind === 'redirect') return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } });
				return Response.json({ client_id: kind === 'mismatch' ? 'https://other.example/client.json' : clientId,
					redirect_uris: ['https://client.example/callback'], token_endpoint_auth_method: 'private_key_jwt',
					token_endpoint_auth_methods_supported: kind === 'private-only' ? ['private_key_jwt'] : ['none'] });
			}) as typeof fetch;
			await assert.rejects(getClient(db, clientId, fetchMetadata));
			assert.equal(calls, 1);
		}
	});

	test('models exact machine routes and methods, with complete canonical configuration', () => {
		assert.deepEqual(ownerMcpMethods('/mcp'), ['GET', 'POST', 'OPTIONS']);
		assert.deepEqual(ownerMcpMethods('/oauth/token'), ['POST', 'OPTIONS']);
		assert.deepEqual(ownerMcpMethods('/.well-known/oauth-protected-resource/mcp'), ['GET', 'OPTIONS']);
		for (const path of ['/mcp/', '/mcp/admin', '/mcpevil', '/oauth/token/extra', '/oauth/authorize',
			'/api/mail', '/api/oauth/grants', '/.well-known/oauth-unexpected', '/%6dcp']) {
			assert.equal(ownerMcpMethods(path), null, path);
		}
		assert.equal(ownerMcpOrigin(env), origin);
		for (const overrides of [{ ACCESS_AUD: '' }, { ACCESS_OWNER_EMAIL: '' }, { ACCESS_TEAM_DOMAIN: 'https://evil.example' },
			{ APP_URL: '' }, { APP_URL: 'http://mail.example.com' }, { APP_URL: `${origin}/inbox` },
			{ APP_URL: `https://user:password@mail.example.com` }, { APP_URL: `${origin}?other=1` }]) {
			assert.equal(ownerMcpOrigin({ ...env, ...overrides }), null);
		}
	});

	test('without Access only exact machine routes can reach a handler', async () => {
		const { event } = await fixture();
		let reached = 0;
		const resolve = async () => { reached++; return Response.json({ reached: true }); };
		for (const [path, method] of [['/mcp', 'POST'], ['/oauth/token', 'POST'], ['/oauth/register', 'POST'],
			['/oauth/revoke', 'POST'], ['/.well-known/oauth-authorization-server', 'GET'],
			['/.well-known/oauth-protected-resource', 'GET'], ['/.well-known/oauth-protected-resource/mcp', 'GET']]) {
			assert.equal((await handle({ event: event(path, { method }), resolve })).status, 200, path);
		}
		assert.equal(reached, 7);
		for (const path of ['/api/mail', '/inbox', '/oauth/authorize', '/api/oauth/grants', '/mcp/', '/mcp/admin', '/oauth/token/extra']) {
			assert.equal((await handle({ event: event(path, { method: 'GET' }), resolve })).status, 403, path);
		}
		assert.equal(reached, 7);
		assert.equal((await handle({ event: event('/oauth/token', { method: 'GET' }), resolve })).status, 405);
		assert.equal((await handle({ event: event('/mcp', { method: 'OPTIONS' }), resolve })).status, 204);
		assert.equal((await handle({ event: event('/mcp', { overrides: { ACCESS_AUD: undefined } }), resolve })).status, 503);
		assert.equal((await handle({ event: event('/mcp', { urlOrigin: 'https://alternate.example' }), resolve })).status, 403);
		assert.equal(reached, 7);
	});

	test('MCP does not accept a cookie, Access assertion, or an API key', async () => {
		const { event, db } = await fixture();
		const apiKey = await createApiToken(db, 'owner', { scopes: ['mail:read', 'mail:send'] });
		const credentials: HeadersInit[] = [{ cookie: 'session=anything' }, { 'cf-access-jwt-assertion': 'anything' },
			{ authorization: `Bearer ${apiKey.token}` }, {}];
		for (const headers of credentials) {
			const response = await mcpPost(event('/mcp', { headers }));
			assert.equal(response.status, 401);
			assert.match(response.headers.get('www-authenticate') ?? '', /oauth-protected-resource\/mcp/);
		}
		assert.equal((await mcpGet(event('/mcp', { method: 'GET' }))).status, 401);
	});

	test('only a current owner grant for this exact MCP resource reaches the server', async () => {
		const { event, grant, db, sqlite, client } = await fixture();
		const owner = await grant();
		const initialization = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
			protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' }
		} });
		const request = (token: string) => event('/mcp', { headers: {
			authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json'
		}, body: initialization });
		const response = await mcpPost(request(owner.access_token));
		assert.equal(response.status, 200);
		const initialized = await response.json();
		assert.equal(initialized.result.serverInfo.name, 'quickinbox');
		assert.match(initialized.result.instructions, /Never automatically reply/);
		const toolsFor = async (token: string, enabled = true) => {
			const response = await mcpPost(event('/mcp', { headers: {
				authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json'
			}, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), overrides: { API_SEND_ENABLED: String(enabled) } }));
			assert.equal(response.status, 200);
			return (await response.json()).result.tools.map((tool: { name: string }) => tool.name) as string[];
		};
		assert((await toolsFor(owner.access_token)).includes('send_message'));
		assert(!(await toolsFor(owner.access_token, false)).includes('send_message'));
		const readOnly = await issueGrant(db, { clientId: client.client_id,
			userId: 'owner', scope: ['mail:read'], resource: `${origin}/mcp` });
		assert(!(await toolsFor(readOnly.access_token)).includes('send_message'));
		assert.equal((await mcpGet(event('/mcp', { method: 'GET', headers: { authorization: `Bearer ${owner.access_token}` } }))).status, 405);
		assert.equal((await mcpPost(request((await grant('stranger')).access_token))).status, 401);
		const wrongResource = await grant('owner', 'https://other.example/mcp');
		assert.equal(await getUserByOAuthToken(db, wrongResource.access_token, `${origin}/mcp`), null);
		assert.equal((await mcpPost(request(wrongResource.access_token))).status, 401);
		await revokeToken(db, owner.access_token);
		assert.equal((await mcpPost(request(owner.access_token))).status, 401);
		const expired = await grant();
		sqlite.query("UPDATE oauth_grants SET access_expires_at = '2000-01-01T00:00:00.000Z'").run();
		assert.equal((await mcpPost(request(expired.access_token))).status, 401);
		const nonAdmin = await grant();
		sqlite.query('UPDATE users SET is_admin = 0 WHERE id = ?').run('owner');
		assert.equal((await mcpPost(request(nonAdmin.access_token))).status, 401);
		assert.equal((await mcpPost(event('/mcp', { overrides: { APP_URL: undefined } }))).status, 503);
	});

	test('token exchange binds authorization codes and refreshes to the owner and resource', async () => {
		const { event, client, db, grant } = await fixture();
		const exchange = (params: Record<string, string>) => tokenPost(event('/oauth/token', {
			headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString()
		}));
		const codeFor = (user_id: string, resource: string) => issueAuthorizationCode(db, {
			client_id: client.client_id, user_id, resource, scope: ['mail:read'], redirect_uri: redirectUri, code_challenge: challenge
		});
		for (const [user, resource] of [['stranger', `${origin}/mcp`], ['owner', 'https://other.example/mcp']]) {
			assert.equal((await exchange({ grant_type: 'authorization_code', client_id: client.client_id,
				code: await codeFor(user, resource), code_verifier: verifier, redirect_uri: redirectUri })).status, 400);
		}
		const valid = await exchange({ grant_type: 'authorization_code', client_id: client.client_id,
			code: await codeFor('owner', `${origin}/mcp`), code_verifier: verifier, redirect_uri: redirectUri });
		assert.equal(valid.status, 200);
		const tokens = await valid.json();
		assert.equal((await getUserByOAuthToken(db, tokens.access_token, `${origin}/mcp`))?.user.id, 'owner');
		for (const wrong of [await grant('stranger'), await grant('owner', 'https://other.example/mcp')]) {
			assert.equal((await exchange({ grant_type: 'refresh_token', client_id: client.client_id,
				refresh_token: wrong.refresh_token })).status, 400);
		}
		const refreshed = await exchange({ grant_type: 'refresh_token', client_id: client.client_id,
			refresh_token: tokens.refresh_token, resource: `${origin}/mcp` });
		assert.equal(refreshed.status, 200);
		assert.equal(await getUserByOAuthToken(db, tokens.access_token, `${origin}/mcp`), null);
	});

	test('consent never exposes a self-declared logo or mismatched website', async () => {
		const { event, db } = await fixture();
		const redirectUri = 'https://foreign.example/callback';
		const client = await registerClient(db, { client_name: 'ChatGPT', redirect_uris: [redirectUri],
			client_uri: 'https://chatgpt.com', logo_uri: 'https://foreign.example/openai.png' });
		const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri,
			response_type: 'code', scope: 'mail:read', resource: `${origin}/mcp`, code_challenge: challenge,
			code_challenge_method: 'S256' });
		const request = event(`/oauth/authorize?${params}`, { method: 'GET' });
		request.locals.user = (await getUserByEmail(db, 'owner@example.com'))!;
		const result = await consentLoad(request as never) as { request: { client: { logo_uri: string | null; client_uri: string | null } } };
		assert.equal(result.request.client.logo_uri, null);
		assert.equal(result.request.client.client_uri, null);
	});

	test('consent rejects a different submitted account before issuing a code', async () => {
		const { event, client, db } = await fixture();
		const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri,
			response_type: 'code', scope: 'mail:read', resource: `${origin}/mcp`, code_challenge: challenge,
			code_challenge_method: 'S256', decision: 'allow', user_id: 'stranger' });
		const request = event('/oauth/authorize', { headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString() });
		request.locals.user = (await getUserByEmail(db, 'owner@example.com'))!;
		const response = await consentActions.default!(request as never);
		assert.equal((response as { status: number }).status, 400);
		const codes = await db.prepare('SELECT COUNT(*) AS count FROM oauth_codes').first<{ count: number }>();
		assert.equal(codes?.count, 0);
	});
});
