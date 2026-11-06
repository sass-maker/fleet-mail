import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { QuickInboxClient } from './client.ts';
import { cloudflareAccessAuthentication, fleetMailOrigin } from './fleet-mcp.ts';
import { createMcpServer } from './mcp.ts';

const origin = 'https://mail.example.com';
const token = (exp: number) => `e30.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`;

describe('Fleet Mail Access authentication', () => {
	test('accepts only an HTTPS origin', () => {
		assert.equal(fleetMailOrigin(`${origin}/`), origin);
		for (const value of ['http://mail.example.com', `${origin}/api`, `${origin}?token=bad`,
			`${origin}#fragment`, 'https://user:password@mail.example.com', 'not a url']) {
			assert.throws(() => fleetMailOrigin(value), /HTTPS origin/);
		}
	});

	test('loads a current session lazily and never exposes subprocess failures', async () => {
		let calls = 0;
		const jwt = token(Date.now() / 1000 + 300);
		const auth = cloudflareAccessAuthentication(origin, async (url) => {
			calls++;
			assert.equal(url, origin);
			return jwt;
		});
		assert.equal(calls, 0);
		assert.equal(new Headers(await auth.headers()).get('cf-access-token'), jwt);
		assert.equal(calls, 1);
		for (const read of [async () => '', async () => token(1), async () => 'invalid',
			async () => { throw new Error(`stdout=${jwt} stderr=private`); }]) {
			await assert.rejects(cloudflareAccessAuthentication(origin, read).headers(), (error: unknown) => {
				assert(error instanceof Error);
				assert.match(error.message, /cloudflared access login --quiet/);
				assert(!error.message.includes(jwt));
				assert(!error.message.includes('private'));
				return true;
			});
		}
	});

	test('authenticates JSON and binary requests, preserves bearer clients, and refuses login redirects', async () => {
		const calls: { url: string; headers: Headers; redirect?: RequestRedirect }[] = [];
		let response = Response.json({ user: { id: 'owner' } });
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), headers: new Headers(init?.headers), redirect: init?.redirect });
			return response;
		};
		try {
			const client = new QuickInboxClient(origin, { kind: 'cloudflare-access', headers: async () => ({ 'cf-access-token': 'access-session' }) });
			await client.whoami();
			assert.equal(calls[0].headers.get('cf-access-token'), 'access-session');
			assert.equal(calls[0].headers.get('authorization'), null);
			assert.equal(calls[0].redirect, 'manual');
			response = new Response('file bytes', { headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="invoice.pdf"' } });
			const attachment = await client.downloadAttachment('message/id', 'attachment/id');
			assert.equal(new TextDecoder().decode(attachment.bytes), 'file bytes');
			assert.equal(attachment.filename, 'invoice.pdf');
			assert(calls[1].url.includes('message%2Fid/attachments/attachment%2Fid'));
			assert.equal(calls[1].headers.get('cf-access-token'), 'access-session');
			response = Response.json({ user: { id: 'owner' } });
			await new QuickInboxClient(origin, 'upstream-token').whoami();
			assert.equal(calls[2].headers.get('authorization'), 'Bearer upstream-token');
			for (const denied of [new Response(null, { status: 302, headers: { location: 'https://elsewhere.example.com/' } }),
				new Response(null, { status: 403 }), new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } })]) {
				response = denied;
				await assert.rejects(client.whoami(), /Access|JSON response/);
			}
			response = new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } });
			await assert.rejects(client.downloadAttachment('id', 'file'), /Access/);
			const beforeMissing = calls.length;
			const missing = new QuickInboxClient(origin, { kind: 'cloudflare-access', headers: async () => ({}) });
			await assert.rejects(missing.whoami(), /Access/);
			assert.equal(calls.length, beforeMissing);
			response = new Response('private response', { headers: { 'content-type': 'application/json' } });
			await assert.rejects(client.whoami(), /Invalid JSON response from Fleet Mail/);
		} finally { globalThis.fetch = originalFetch; }
	});

	test('does not retry a failed send or expose network error details', async () => {
		const originalFetch = globalThis.fetch;
		let attempts = 0;
		globalThis.fetch = async () => {
			attempts++;
			throw new Error('private-session-token');
		};
		try {
			const client = new QuickInboxClient(origin, { kind: 'cloudflare-access', headers: async () => ({ 'cf-access-token': 'session' }) });
			await assert.rejects(client.sendMessage({ to: 'someone@example.com', subject: 'Test', text: 'Test', idempotencyKey: 'send-once' }),
				(error: unknown) => error instanceof Error && /Fleet Mail request failed/.test(error.message) && !error.message.includes('private-session-token'));
			assert.equal(attempts, 1);
		} finally { globalThis.fetch = originalFetch; }
	});
});

test('MCP initializes without authentication or sends and carries reviewed mail actions to REST', async () => {
	const requests: { url: URL; init: RequestInit; body: Record<string, unknown> | null }[] = [];
	let authCalls = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
		const url = new URL(String(input));
		requests.push({ url, init, body: init.body ? JSON.parse(String(init.body)) : null });
		if (url.pathname === '/api/addresses') return Response.json({ addresses: [{ id: 'sender-id', address: 'team@example.com' }] });
		if (url.pathname === '/api/mail' && !init.method) return Response.json({ threads: [], total: 0, page: 1, pageCount: 1, pageSize: 25 });
		if (url.pathname === '/api/mail/message-id' && !init.method) return Response.json({ threadId: 'thread-id', subject: 'Hello', messages: [{ id: 'message-id', attachments: [], reply_target: ['sender@example.net'] }] });
		return Response.json({ ok: true, id: 'sent-id' });
	};
	const server = createMcpServer({
		accounts: [{ name: 'fleet', client: new QuickInboxClient(origin, {
			kind: 'cloudflare-access', headers: async () => { authCalls++; return { 'cf-access-token': 'session' }; }
		}) }], defaultName: 'fleet'
	});
	const client = new Client({ name: 'fleet-mcp-test', version: '1' });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	try {
		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
		const tools = await client.listTools();
		assert(tools.tools.some(({ name }) => name === 'send_message'));
		assert(tools.tools.some(({ name }) => name === 'list_addresses'));
		assert.equal(authCalls, 0);
		assert.equal(requests.length, 0);
		const identities = await client.callTool({ name: 'list_addresses', arguments: {} });
		assert.match(JSON.stringify(identities), /sender-id/);
		await client.callTool({ name: 'search_mail', arguments: { q: 'invoice & receipt' } });
		assert.equal(requests.at(-1)?.url.searchParams.get('q'), 'invoice & receipt');
		const thread = await client.callTool({ name: 'get_thread', arguments: { id: 'message-id' } });
		assert.match(JSON.stringify(thread), /reply_target/);
		assert.equal(requests.filter(({ init }) => init.method === 'POST').length, 0);
		await client.callTool({ name: 'send_message', arguments: {
			to: 'recipient@example.net', subject: 'Requested message', text: 'Hello', fromAddressId: 'sender-id', idempotency_key: 'send-once-123'
		} });
		let request = requests.at(-1)!;
		assert.equal(request.init.method, 'POST');
		assert.equal(new Headers(request.init.headers).get('idempotency-key'), 'send-once-123');
		assert.deepEqual(request.body, { to: 'recipient@example.net', subject: 'Requested message', text: 'Hello', fromAddressId: 'sender-id' });
		await client.callTool({ name: 'reply', arguments: {
			id: 'message-id', text: 'Reply', expected_recipients: ['sender@example.net'], idempotency_key: 'reply-once-123'
		} });
		request = requests.at(-1)!;
		assert.equal(request.url.pathname, '/api/mail/message-id');
		assert.equal(new Headers(request.init.headers).get('idempotency-key'), 'reply-once-123');
		assert.deepEqual(request.body, { text: 'Reply', expectedRecipients: ['sender@example.net'] });
		await client.callTool({ name: 'update_thread', arguments: { id: 'message-id', isRead: false, isStarred: false, archived: true } });
		request = requests.at(-1)!;
		assert.equal(request.init.method, 'PATCH');
		assert.deepEqual(request.body, { isRead: false, isStarred: false, archived: true });
		assert(requests.every(({ init }) => new Headers(init.headers).get('cf-access-token') === 'session'));
	} finally {
		globalThis.fetch = originalFetch;
		await client.close();
		await server.close();
	}
});
