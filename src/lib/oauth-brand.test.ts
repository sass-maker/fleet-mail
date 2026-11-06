import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientBrand, clientWebsite } from './oauth-brand';

test('self-declared client websites cannot supply a consent brand', () => {
	const client = { client_name: 'ChatGPT', client_id: 'registered-client',
		client_uri: 'https://chatgpt.com',
		redirect_uris: ['https://chatgpt.com/connector_platform/oauth/callback', 'https://foreign.example/callback'],
		redirect_uri: 'https://foreign.example/callback' };
	assert.equal(clientBrand(client), null);
	assert.equal(clientBrand({ ...client, redirect_uri: client.redirect_uris[0] })?.label, 'ChatGPT');
});

test('the actual redirect governs branding even when metadata names another host', () => {
	assert.equal(clientBrand({ client_name: 'Client', client_id: 'https://chatgpt.com/oauth/client.json',
		redirect_uri: 'https://foreign.example/callback' }), null);
	assert.equal(clientBrand({ client_name: 'Client', client_uri: 'https://foreign.example',
		redirect_uri: 'https://chatgpt.com/connector_platform/oauth/callback' })?.label, 'ChatGPT');
});

test('metadata and names alone do not claim a verified callback brand', () => {
	assert.equal(clientBrand({ client_name: 'ChatGPT', client_id: 'https://chatgpt.com/oauth/client.json',
		client_uri: 'https://chatgpt.com' }), null);
	assert.equal(clientBrand({ client_name: 'ChatGPT', redirect_uri: 'https://chatgpt.com.foreign.example/callback' }), null);
	assert.equal(clientBrand({ client_name: 'ChatGPT', redirect_uri: 'chatgpt.com:callback' }), null);
	assert.equal(clientBrand({ client_name: 'Cursor', redirect_uri: 'cursor://anysphere.cursor-retrieval/callback' })?.label, 'Cursor');
});

test('a consent website must share the actual callback origin', () => {
	assert.equal(clientWebsite({ client_name: 'ChatGPT', client_uri: 'https://chatgpt.com',
		redirect_uri: 'https://foreign.example/callback' }), null);
	assert.equal(clientWebsite({ client_name: 'ChatGPT', client_uri: 'https://chatgpt.com',
		redirect_uri: 'https://chatgpt.com/connector_platform/oauth/callback' }), 'https://chatgpt.com/');
});
