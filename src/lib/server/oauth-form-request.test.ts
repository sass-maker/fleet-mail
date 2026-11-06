import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareOAuthFormRequest } from './oauth-form-request';

const origin = 'https://mail.example.com';
test('OAuth form normalization preserves parameters, request identity and caller headers', async () => {
	const request = new Request(`${origin}/oauth/token?client=1`, {
		method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
			'content-length': '50', origin: 'https://caller.example', 'x-request-id': 'trace-id' },
		body: new URLSearchParams([['code', 'a+b&c'], ['client_id', 'first'], ['client_id', 'last']]).toString()
	});
	const prepared = await prepareOAuthFormRequest(request);
	assert(prepared instanceof Request);
	assert.equal(prepared.url, request.url);
	assert.equal(prepared.method, 'POST');
	assert.equal(prepared.headers.get('origin'), 'https://caller.example');
	assert.equal(prepared.headers.get('x-request-id'), 'trace-id');
	assert.equal(prepared.headers.get('content-type'), 'application/json');
	assert.equal(prepared.headers.get('content-length'), null);
	assert.deepEqual(await prepared.json(), { code: 'a+b&c', client_id: 'last' });
});

test('other paths, methods and content types retain their original request', async () => {
	for (const [path, method, type] of [
		['/oauth/authorize', 'POST', 'application/x-www-form-urlencoded'],
		['/api/mail', 'POST', 'application/x-www-form-urlencoded'],
		['/oauth/token/', 'POST', 'application/x-www-form-urlencoded'],
		['/oauth/%74oken', 'POST', 'application/x-www-form-urlencoded'],
		['/oauth/token', 'PUT', 'application/x-www-form-urlencoded'],
		['/oauth/token', 'POST', 'application/json']
	]) {
		const request = new Request(origin + path, { method, headers: { 'content-type': type }, body: 'client_id=client' });
		assert.equal(await prepareOAuthFormRequest(request), request);
		assert.equal(request.bodyUsed, false);
	}
});

test('the byte limit applies to streaming forms without trusting content-length', async () => {
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) { controller.enqueue(new Uint8Array(9_000)); },
		cancel() { cancelled = true; }
	});
	const prepared = await prepareOAuthFormRequest(new Request(`${origin}/oauth/revoke`, {
		method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': '1' }, body
	}));
	assert(prepared instanceof Response);
	assert.equal(prepared.status, 413);
	assert.equal(cancelled, true);
});

test('unreadable forms fail without exposing stream errors', async () => {
	const body = new ReadableStream({ start(controller) { controller.error(new Error('private-input')); } });
	const prepared = await prepareOAuthFormRequest(new Request(`${origin}/oauth/token`, {
		method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body
	}));
	assert(prepared instanceof Response);
	assert.equal(prepared.status, 400);
	assert(!JSON.stringify(await prepared.json()).includes('private-input'));
});
