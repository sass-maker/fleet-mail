import assert from 'node:assert/strict';
import { test } from 'node:test';
import { domainFilterHref } from './domain-filter.ts';

test('domain selection includes unregistered recipients by removing stale address scope', () => {
	const current = new URL('https://mail.example/inbox?address=team-id&thread=old&page=4&q=invoice&unread=1');
	assert.equal(domainFilterHref(current), '/inbox?q=invoice&unread=1');
	assert.equal(current.searchParams.get('address'), 'team-id');
});

test('all domains can reset a mailbox without losing its other filters', () => {
	assert.equal(domainFilterHref(new URL('https://mail.example/sent?address=team-id&starred=1')), '/sent?starred=1');
	assert.equal(domainFilterHref(new URL('https://mail.example/inbox')), '/inbox');
});
