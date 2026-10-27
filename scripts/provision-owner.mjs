import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const quote = (value) => `'${value.replaceAll("'", "''")}'`;

/** Insert missing owner/domain rows without replacing existing identities or mail. */
export function provisioningSQL(email, domains) {
	const owner = `SELECT id FROM users WHERE email = ${quote(email)} AND is_admin = 1 AND must_change_password = 0`;
	const statements = [
		`INSERT OR IGNORE INTO users (id,email,name,password_hash,is_admin,must_change_password)
		 SELECT 'fleet-owner',${quote(email)},'Sarthak','access-only',1,0 WHERE NOT EXISTS (SELECT 1 FROM users)`
	];
	const ordered = domains.includes('sassmaker.com')
		? ['sassmaker.com', ...domains.filter(domain => domain !== 'sassmaker.com')] : domains;
	for (const domain of ordered) {
		statements.push(`INSERT OR IGNORE INTO domains
		 (id,name,status,sending_enabled,receiving_enabled,catchall_user_id,synced_at)
		 SELECT ${quote(domain)},${quote(domain)},'verified',1,1,id,datetime('now') FROM users WHERE id IN (${owner})`);
		statements.push(`UPDATE domains SET catchall_user_id = (${owner})
		 WHERE name = ${quote(domain)} AND catchall_user_id IS NULL AND EXISTS (${owner})`);
		statements.push(`INSERT OR IGNORE INTO addresses (id,user_id,domain_id,address,is_default)
		 SELECT ${quote(`fleet-team-${domain}`)},u.id,d.id,${quote(`team@${domain}`)},
		 CASE WHEN NOT EXISTS (SELECT 1 FROM addresses WHERE user_id = u.id AND is_default = 1) THEN 1 ELSE 0 END
		 FROM users u JOIN domains d ON d.catchall_user_id = u.id
		 WHERE u.id IN (${owner}) AND d.name = ${quote(domain)}`);
	}
	return `${statements.join(';\n')};`;
}

function main() {
	const scope = process.argv[2];
	if (!['--local', '--remote'].includes(scope) || process.argv.length !== 3) {
		throw new Error('Choose exactly one target: --local or --remote. Apply D1 migrations first.');
	}
	const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
	const email = config.vars.ACCESS_OWNER_EMAIL?.trim().toLowerCase();
	const domains = [...new Set(config.vars.CLOUDFLARE_MAIL_DOMAINS.split(',').map(value => value.trim().toLowerCase()))];
	if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !domains.length ||
		!domains.every(domain => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain))) {
		throw new Error('Configure a valid owner email and mail domains before provisioning.');
	}
	function query(sql) {
		const result = spawnSync(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'),
			'd1', 'execute', 'DB', scope, '--command', sql, '--json'], { cwd: root, encoding: 'utf8' });
		if (result.status !== 0) throw new Error(result.stderr || 'D1 command failed');
		const batches = JSON.parse(result.stdout);
		if (batches.some(batch => !batch.success)) throw new Error('D1 rejected provisioning');
		return batches.flatMap(batch => batch.results ?? []);
	}
	const users = query('SELECT id,email,is_admin,must_change_password FROM users');
	if (users.length > 1 || (users.length === 1 &&
		(users[0].email.toLowerCase() !== email || users[0].is_admin !== 1 || users[0].must_change_password !== 0))) {
		throw new Error('Existing account differs from the configured sole owner; no rows changed.');
	}
	query(provisioningSQL(email, domains));
	const owned = query(`SELECT name FROM domains WHERE catchall_user_id IN
		(SELECT id FROM users WHERE email = ${quote(email)})`);
	const addresses = query(`SELECT address FROM addresses WHERE user_id IN
		(SELECT id FROM users WHERE email = ${quote(email)})`);
	if (!domains.every(domain => owned.some(row => row.name === domain) &&
		addresses.some(row => row.address === `team@${domain}`))) {
		throw new Error('Owner/domain verification failed; existing rows were preserved. Do not switch routing.');
	}
	console.log(`Verified one Access-only owner and ${domains.length} catch-all domains (${scope.slice(2)}).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
