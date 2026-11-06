import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
for (const [command, args] of [['pnpm', ['run', 'build']], ['bun', ['test', 'scripts/hosted-mcp-built.test.ts']]]) {
	const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
	if (result.error) console.error('Could not run built hosted MCP checks. Install pinned dependencies and Bun first.');
	if (result.status !== 0) {
		process.exitCode = result.status ?? 1;
		break;
	}
}
