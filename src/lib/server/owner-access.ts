import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export type OwnerAccessEnv = {
	ACCESS_AUTH_ENABLED?: string;
	ACCESS_TEAM_DOMAIN?: string;
	ACCESS_AUD?: string;
	ACCESS_OWNER_EMAIL?: string;
};

let cachedKeys: { issuer: string; resolve: JWTVerifyGetKey } | undefined;

/** Access is also enforced at the edge. Verify its signed assertion in the app. */
export async function verifyOwnerAccess(
	request: Request,
	env: OwnerAccessEnv,
	resolveKey?: JWTVerifyGetKey
): Promise<string | null> {
	const issuer = env.ACCESS_TEAM_DOMAIN;
	const audience = env.ACCESS_AUD;
	const owner = env.ACCESS_OWNER_EMAIL?.trim().toLowerCase();
	const token = request.headers.get('cf-access-jwt-assertion');
	if (!issuer || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) ||
		!audience || !owner || !token || token.length > 16384) return null;

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
	return ['/setup', '/api/setup', '/api/auth/pair', '/api/onboarding', '/onboarding',
		'/mcp', '/oauth', '/.well-known/oauth-'].some(prefix =>
			pathname === prefix || pathname.startsWith(`${prefix}/`) ||
			(prefix.endsWith('-') && pathname.startsWith(prefix))) ||
		(pathname === '/api/auth/login' && method !== 'DELETE');
}

export function ownerAccessOriginAllowed(request: Request): boolean {
	if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
	const origin = request.headers.get('origin');
	return !origin || origin === new URL(request.url).origin;
}
