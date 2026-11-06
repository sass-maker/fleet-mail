const OAUTH_FORM_PATHS = new Set(['/oauth/token', '/oauth/revoke']);
const MAX_FORM_BYTES = 16 * 1024;

function invalidForm(status: number, description: string): Response {
	return Response.json({ error: 'invalid_request', error_description: description }, {
		status, headers: { 'Cache-Control': 'no-store' }
	});
}

/** Machine OAuth forms do not use cookies; browser forms retain SvelteKit's CSRF check. */
export async function prepareOAuthFormRequest(request: Request): Promise<Request | Response> {
	const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
	if (request.method !== 'POST' || !OAUTH_FORM_PATHS.has(new URL(request.url).pathname) ||
		type !== 'application/x-www-form-urlencoded') return request;

	const reader = request.body?.getReader();
	const decoder = new TextDecoder();
	let bytes = 0;
	let text = '';
	try {
		if (reader) {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				bytes += value.byteLength;
				if (bytes > MAX_FORM_BYTES) {
					await reader.cancel();
					return invalidForm(413, 'OAuth form body is too large');
				}
				text += decoder.decode(value, { stream: true });
			}
		}
		text += decoder.decode();
	} catch {
		return invalidForm(400, 'OAuth form body could not be read');
	} finally {
		reader?.releaseLock();
	}

	const headers = new Headers(request.headers);
	headers.set('content-type', 'application/json');
	headers.delete('content-length');
	return new Request(request, { headers, body: JSON.stringify(Object.fromEntries(new URLSearchParams(text))) });
}
