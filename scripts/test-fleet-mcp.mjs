import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync('bun', ['test', 'cli/client.test.ts', 'cli/fleet-mcp.test.ts'], {
	cwd: fileURLToPath(new URL('..', import.meta.url)),
	stdio: 'inherit'
});
if (result.error) console.error('Could not run Fleet Mail MCP tests. Install Bun and dependencies.');
process.exitCode = result.status ?? 1;
