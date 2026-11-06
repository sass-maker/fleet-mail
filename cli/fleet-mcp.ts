import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { QuickInboxClient, QuickInboxError, type ClientAuthentication } from './client.ts';
import { startMcpServer } from './mcp.ts';

export const FLEET_MAIL_ORIGIN = 'https://mail.significanthobbies.com';
const execute = promisify(execFile);

class FleetMcpConfigurationError extends Error {}

export function fleetMailOrigin(value: string): string {
	let url: URL;
	try { url = new URL(value); } catch { throw new FleetMcpConfigurationError('Fleet Mail URL must be an HTTPS origin.'); }
	if (url.protocol !== 'https:' || url.username || url.password ||
		url.pathname !== '/' || url.search || url.hash) {
		throw new FleetMcpConfigurationError('Fleet Mail URL must be an HTTPS origin without credentials, path, query, or fragment.');
	}
	return url.origin;
}

async function readAccessToken(origin: string): Promise<string> {
	const { stdout } = await execute(process.env.FLEET_MAIL_CLOUDFLARED || 'cloudflared', ['access', 'token', '--app', origin], {
		encoding: 'utf8', timeout: 15_000, maxBuffer: 32_768, windowsHide: true
	});
	return stdout.trim();
}

export function cloudflareAccessAuthentication(
	origin: string,
	readToken: (origin: string) => Promise<string> = readAccessToken
): Exclude<ClientAuthentication, string> {
	origin = fleetMailOrigin(origin);
	return {
		kind: 'cloudflare-access',
		async headers() {
			try {
				const token = await readToken(origin);
				if (token.length > 16_384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
					throw new Error('Invalid token');
				}
				const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { exp?: unknown };
				if (typeof payload.exp !== 'number' || payload.exp <= Date.now() / 1000) throw new Error('Expired token');
				return { 'cf-access-token': token };
			} catch {
				// Subprocess errors include captured output, which may contain the token.
				throw new QuickInboxError(401,
					`Cloudflare Access session unavailable. Run: cloudflared access login --quiet ${origin}`);
			}
		}
	};
}

export async function startFleetMcp(args = process.argv.slice(2)): Promise<void> {
	if (args.length !== 0 && (args.length !== 2 || args[0] !== '--url')) {
		throw new FleetMcpConfigurationError('Usage: bun cli/fleet-mcp.ts [--url https://your-mail-origin]');
	}
	const origin = fleetMailOrigin(args[1] ?? FLEET_MAIL_ORIGIN);
	await startMcpServer({
		accounts: [{ name: 'fleet', client: new QuickInboxClient(origin, cloudflareAccessAuthentication(origin)) }],
		defaultName: 'fleet'
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	startFleetMcp().catch((error: unknown) => {
		console.error(error instanceof FleetMcpConfigurationError
			? error.message
			: 'Fleet Mail MCP failed to start. Check the command and installed dependencies.');
		process.exitCode = 1;
	});
}
