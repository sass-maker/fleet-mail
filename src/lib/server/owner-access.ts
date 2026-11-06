import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { User } from '../types';

export type OwnerAccessEnv = {
	ACCESS_TEAM_DOMAIN?: string;
	ACCESS_AUD?: string;
	ACCESS_OWNER_EMAIL?: string;
	APP_URL?: string;
};

let cachedKeys: { issuer: string; resolve: JWTVerifyGetKey } | undefined;

function ownerAccessConfiguration(env: OwnerAccessEnv) {
	const issuer = env.ACCESS_TEAM_DOMAIN;
	const audience = env.ACCESS_AUD?.trim();
	const owner = env.ACCESS_OWNER_EMAIL?.trim().toLowerCase();
	if (!issuer || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) ||
		!audience || !owner || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner)) return null;
	return { issuer, audience, owner };
}

const OWNER_MCP_ROUTES: Record<string, readonly string[]> = {
	'/mcp': ['GET', 'POST', 'OPTIONS'],
	'/oauth/register': ['POST', 'OPTIONS'],
	'/oauth/token': ['POST', 'OPTIONS'],
	'/oauth/revoke': ['POST', 'OPTIONS'],
	'/.well-known/oauth-authorization-server': ['GET', 'OPTIONS'],
	'/.well-known/oauth-protected-resource': ['GET', 'OPTIONS'],
	'/.well-known/oauth-protected-resource/mcp': ['GET', 'OPTIONS']
};

export function ownerMcpMethods(pathname: string): readonly string[] | null {
	return Object.hasOwn(OWNER_MCP_ROUTES, pathname) ? OWNER_MCP_ROUTES[pathname] : null;
}

export function ownerMcpOrigin(env: OwnerAccessEnv): string | null {
	if (!ownerAccessConfiguration(env) || !env.APP_URL) return null;
	try {
		const url = new URL(env.APP_URL);
		return url.protocol === 'https:' && !url.username && !url.password &&
			url.pathname === '/' && !url.search && !url.hash ? url.origin : null;
	} catch { return null; }
}

export function isOwnerMcpUser(user: User, env: OwnerAccessEnv): boolean {
	const configuration = ownerAccessConfiguration(env);
	return Boolean(configuration && user.is_admin && !user.must_change_password &&
		user.email.trim().toLowerCase() === configuration.owner);
}

/** Access is also enforced at the edge. Verify its signed assertion in the app. */
export async function verifyOwnerAccess(
	request: Request,
	env: OwnerAccessEnv,
	resolveKey?: JWTVerifyGetKey
): Promise<string | null> {
	const configuration = ownerAccessConfiguration(env);
	const token = request.headers.get('cf-access-jwt-assertion');
	if (!configuration || !token || token.length > 16384) return null;
	const { issuer, audience, owner } = configuration;

	try {
		if (!resolveKey) {
			if (cachedKeys?.issuer !== issuer) {
				cachedKeys = {
					issuer,
					resolve: createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
						timeoutDuration: 5000
					})
				};
			}
			resolveKey = cachedKeys.resolve;
		}
		const { payload } = await jwtVerify(token, resolveKey, {
			issuer,
			audience,
			algorithms: ['RS256'],
			requiredClaims: ['sub', 'iat', 'exp', 'email']
		});
		return typeof payload.email === 'string' && payload.email.trim().toLowerCase() === owner
			? owner : null;
	} catch {
		return null;
	}
}

/** The single-owner deployment does not expose alternate account/login paths. */
export function ownerAccessRouteBlocked(pathname: string, method: string): boolean {
	try { pathname = decodeURIComponent(pathname); } catch { return true; }
	if (pathname === '/api/auth/me' && method === 'GET') return false;
	if (pathname === '/api/auth/login' && method === 'DELETE') return false;
	if (pathname === '/oauth/authorize' && ['GET', 'POST'].includes(method)) return false;
	if (pathname === '/api/oauth/grants' && ['GET', 'DELETE'].includes(method)) return false;
	if ((pathname === '/api/admin/users' || pathname.startsWith('/api/admin/users/')) && method !== 'GET') return true;
	return ['/setup', '/api/setup', '/api/auth', '/api/apikeys', '/api/oauth',
		'/mcp', '/oauth', '/.well-known/oauth-'].some(prefix =>
			pathname === prefix || pathname.startsWith(`${prefix}/`) ||
			(prefix.endsWith('-') && pathname.startsWith(prefix)));
}

export function ownerAccessOriginAllowed(request: Request): boolean {
	if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
	const origin = request.headers.get('origin');
	return !origin || origin === new URL(request.url).origin;
}
