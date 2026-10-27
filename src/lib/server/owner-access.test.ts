import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { ownerAccessOriginAllowed, ownerAccessRouteBlocked, verifyOwnerAccess } from './owner-access.ts';

const keys = await generateKeyPair('RS256');
const env = {
	ACCESS_TEAM_DOMAIN: 'https://test-team.cloudflareaccess.com',
	ACCESS_AUD: 'fleet-mail-audience',
	ACCESS_OWNER_EMAIL: 'owner@example.com'
};
const claims: JWTPayload = {
	iss: env.ACCESS_TEAM_DOMAIN,
	aud: env.ACCESS_AUD,
	sub: 'owner-id',
	email: 'owner@example.com',
	iat: Math.floor(Date.now() / 1000),
	exp: Math.floor(Date.now() / 1000) + 300
};
async function requestFor(overrides: JWTPayload = {}, signingKey = keys.privateKey) {
	const token = await new SignJWT({ ...claims, ...overrides })
		.setProtectedHeader({ alg: 'RS256' }).sign(signingKey);
	return new Request('https://mail.example.com/inbox', {
		headers: { 'cf-access-jwt-assertion': token }
	});
}
const resolveKey = async () => keys.publicKey;

test('accepts a signed, current assertion for the exact owner and app', async () => {
	assert.equal(await verifyOwnerAccess(await requestFor(), env, resolveKey), 'owner@example.com');
});

test('does not trust an email header or a missing assertion', async () => {
	const request = new Request('https://mail.example.com', {
		headers: { 'cf-access-authenticated-user-email': 'owner@example.com' }
	});
	assert.equal(await verifyOwnerAccess(request, env, resolveKey), null);
});

for (const [name, overrides] of Object.entries({
	'other user': { email: 'stranger@example.com' },
	'other application': { aud: 'other-app' },
	'other issuer': { iss: 'https://other-team.cloudflareaccess.com' },
	expired: { exp: Math.floor(Date.now() / 1000) - 1 },
	'not yet valid': { nbf: Math.floor(Date.now() / 1000) + 300 },
	'no expiry': { exp: undefined },
	'no subject': { sub: undefined }
})) {
	test(`rejects ${name}`, async () => {
		assert.equal(await verifyOwnerAccess(await requestFor(overrides), env, resolveKey), null);
	});
}

test('rejects an untrusted signing key', async () => {
	const other = await generateKeyPair('RS256');
	assert.equal(await verifyOwnerAccess(await requestFor({}, other.privateKey), env, resolveKey), null);
});

test('rejects incomplete or untrusted configuration', async () => {
	const request = await requestFor();
	assert.equal(await verifyOwnerAccess(request, { ...env, ACCESS_AUD: '' }, resolveKey), null);
	assert.equal(await verifyOwnerAccess(request, { ...env, ACCESS_TEAM_DOMAIN: 'https://attacker.example' }, resolveKey), null);
});

test('closes alternate setup, password, pairing and agent authentication routes', () => {
	for (const path of ['/setup', '/api/setup', '/api/auth/login', '/api/auth/pair',
		'/api/auth/pair/start', '/onboarding', '/mcp', '/mcp/', '/oauth/authorize',
		'/.well-known/oauth-authorization-server']) {
		assert.equal(ownerAccessRouteBlocked(path, 'POST'), true, path);
	}
	assert.equal(ownerAccessRouteBlocked('/api/auth/login', 'DELETE'), false);
	assert.equal(ownerAccessRouteBlocked('/api/reply', 'POST'), false);
	assert.equal(ownerAccessRouteBlocked('/inbox', 'GET'), false);
});

test('rejects cross-origin writes while permitting same-origin use and scripts', () => {
	assert.equal(ownerAccessOriginAllowed(new Request('https://mail.example.com/api/reply', {
		method: 'POST', headers: { origin: 'https://attacker.example' }
	})), false);
	assert.equal(ownerAccessOriginAllowed(new Request('https://mail.example.com/api/reply', {
		method: 'POST', headers: { origin: 'https://mail.example.com' }
	})), true);
	assert.equal(ownerAccessOriginAllowed(new Request('https://mail.example.com/api/reply', { method: 'POST' })), true);
});
