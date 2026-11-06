import type { D1Database } from '@cloudflare/workers-types';
import type { RequestHandler } from '@sveltejs/kit';
import { readBearerToken } from '$lib/server/api-tokens';
import { getEmailProvider } from '$lib/server/context';
import { handleMcpRequest } from '$lib/server/mcp';
import { bearerChallenge, getUserByOAuthToken, mcpResourceUri } from '$lib/server/oauth';
import { isOwnerMcpUser, ownerMcpOrigin } from '$lib/server/owner-access';
import { apiSendPolicy } from '$lib/server/send-policy';
import type { User } from '$lib/types';

function rpcError(status: number, message: string, headers: Record<string, string> = {}): Response {
	return new Response(
		JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }),
		{ status, headers: { 'Content-Type': 'application/json', ...headers } }
	);
}

type AuthorizedMcp = { db: D1Database; user: User; scopes: readonly string[]; origin: string };

async function authenticate({ request, platform, url }: Parameters<RequestHandler>[0]): Promise<AuthorizedMcp | Response> {
	const db = platform?.env.DB;
	const origin = platform?.env && ownerMcpOrigin(platform.env);
	if (!db || !origin) return rpcError(503, 'Owner MCP is not configured');
	if (url.origin !== origin) return rpcError(403, 'Invalid MCP origin');

	const bearer = readBearerToken(request);
	if (!bearer) {
		return rpcError(401, 'Authorization required', { 'WWW-Authenticate': bearerChallenge(origin) });
	}
	const auth = await getUserByOAuthToken(db, bearer, mcpResourceUri(origin));
	if (!auth || !isOwnerMcpUser(auth.user, platform!.env)) {
		return rpcError(401, 'Invalid or expired token', {
			'WWW-Authenticate': bearerChallenge(origin, {
				error: 'invalid_token',
				description: 'The access token is invalid, expired, or revoked'
			})
		});
	}
	return { db, user: auth.user, scopes: auth.scopes, origin };
}

export const POST: RequestHandler = async (event) => {
	const auth = await authenticate(event);
	if (auth instanceof Response) return auth;
	const { request, platform } = event;

	return handleMcpRequest(request, {
		db: auth.db,
		bucket: platform?.env.ATTACHMENTS,
		provider: () => getEmailProvider(platform),
		user: auth.user,
		scopes: auth.scopes,
		origin: auth.origin,
		sendPolicy: apiSendPolicy(platform?.env)
	});
};

/** Stateless server: no SSE stream to open and no session to end. */
const methodNotAllowed: RequestHandler = async (event) => {
	const auth = await authenticate(event);
	return auth instanceof Response ? auth :
		rpcError(405, 'This MCP server is stateless; send JSON-RPC requests with POST', { Allow: 'POST, OPTIONS' });
};

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
