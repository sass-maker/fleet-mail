import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { provisioningSQL } from './provision-owner.mjs';

test('provisioning is repeatable against the real schema and preserves stored mail', () => {
	const db = new DatabaseSync(':memory:');
	for (const file of readdirSync(new URL('../migrations/', import.meta.url)).sort()) {
		db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
	}
	const domains = ['first.example', 'second.example'];
	const sql = provisioningSQL('owner@example.com', domains);
	db.exec(sql);
	db.exec("INSERT INTO emails (id,user_id,direction,from_addr,to_addr,subject) VALUES ('retained','fleet-owner','inbound','sender@example.com','any@first.example','Retain this message')");
	db.exec(sql);
	assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
	assert.equal(db.prepare('SELECT COUNT(*) AS count FROM domains').get().count, 2);
	assert.equal(db.prepare('SELECT COUNT(*) AS count FROM addresses').get().count, 2);
	assert.equal(db.prepare('SELECT subject FROM emails WHERE id = ?').get('retained').subject, 'Retain this message');
	assert.equal(db.prepare('SELECT password_hash FROM users').get().password_hash, 'access-only');
	db.exec(provisioningSQL('different@example.com', domains));
	assert.equal(db.prepare('SELECT email FROM users').get().email, 'owner@example.com');
	assert.equal(db.prepare('SELECT catchall_user_id FROM domains').get().catchall_user_id, 'fleet-owner');
	db.close();
});
