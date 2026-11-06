import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync('bun', ['test', 'src/lib/server/hosted-mcp-access.test.ts', 'src/lib/server/oauth.test.ts',
	'src/lib/server/owner-access.test.ts', 'src/lib/server/oauth-form-request.test.ts', 'src/lib/oauth-brand.test.ts', 'src/lib/server/mcp.test.ts'], {
	cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit'
});
if (result.error) console.error('Could not run hosted MCP tests. Install Bun and dependencies.');
process.exitCode = result.status ?? 1;
