import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync('bun', ['test', 'scripts/hosted-mcp-built.test.ts'], {
	cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit'
});
if (result.error) console.error('Could not run built hosted MCP tests. Build the app and install Bun first.');
process.exitCode = result.status ?? 1;
