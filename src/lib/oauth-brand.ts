/**
 * Real logos for the MCP clients people actually connect. Dynamic registration
 * rarely ships a `logo_uri`, so without this the consent screen would show a
 * grey square with two letters in it. Icons are Remix Icon brand glyphs, which
 * the app already bundles.
 */

export type ClientBrand = {
	/** Remix Icon name (without the `ri-` prefix). */
	icon: string;
	/** Canonical product name, used when the registered name is a slug. */
	label: string;
	/** Tile background; the glyph is drawn in white on top. */
	color: string;
};

const BRANDS: Array<ClientBrand & { match: RegExp }> = [
	{ match: /(^|\.)claude\.ai$|(^|\.)anthropic\.com$/, icon: 'claude-fill', label: 'Claude', color: '#d97757' },
	{ match: /(^|\.)cursor\.com$|(^|\.)cursor\.sh$|cursor-retrieval$|^cursor$/, icon: 'cursor-ai-fill', label: 'Cursor', color: '#111111' },
	{ match: /(^|\.)chatgpt\.com$|(^|\.)openai\.com$/, icon: 'openai-fill', label: 'ChatGPT', color: '#111111' },
	{ match: /(^|\.)githubcopilot\.com$|(^|\.)copilot\.github\.com$/, icon: 'copilot-fill', label: 'GitHub Copilot', color: '#24292f' },
	{ match: /(^|\.)github\.com$/, icon: 'github-fill', label: 'GitHub', color: '#24292f' },
	{ match: /(^|\.)google\.com$|(^|\.)gemini\.google$/, icon: 'gemini-fill', label: 'Gemini', color: '#1a73e8' },
	{ match: /(^|\.)perplexity\.ai$/, icon: 'perplexity-fill', label: 'Perplexity', color: '#20808d' },
	{ match: /(^|\.)microsoft\.com$|(^|\.)visualstudio\.com$|(^|\.)vscode\.dev$/, icon: 'microsoft-fill', label: 'Visual Studio Code', color: '#0078d4' },
	{ match: /(^|\.)slack\.com$/, icon: 'slack-fill', label: 'Slack', color: '#4a154b' },
	{ match: /(^|\.)notion\.so$|(^|\.)notion\.com$/, icon: 'notion-fill', label: 'Notion', color: '#111111' },
	{ match: /(^|\.)discord\.com$|(^|\.)discord\.gg$/, icon: 'discord-fill', label: 'Discord', color: '#5865f2' },
	{ match: /^(localhost|127\.0\.0\.1|::1)$/, icon: 'terminal-box-line', label: 'Local client', color: '#4b5563' }
];

export type BrandableClient = {
	client_name: string;
	client_uri?: string | null;
	client_id?: string | null;
	redirect_uri?: string | null;
};

function hostFrom(value: string | null | undefined): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		if (url.protocol === 'http:' || url.protocol === 'https:') return url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
		// Native Cursor callbacks have a known scheme; arbitrary schemes cannot assert a web domain.
		return /^(cursor|cursor-retrieval):$/.test(url.protocol) ? url.protocol.slice(0, -1) : null;
	} catch {
		return null;
	}
}

/** Brand marks follow the selected callback, never a self-declared name or website. */
export function clientBrand(client: BrandableClient): ClientBrand | null {
	const host = hostFrom(client.redirect_uri);
	if (!host) return null;
	for (const brand of BRANDS) {
		if (brand.match.test(host)) {
			const { match: _match, ...rest } = brand;
			return rest;
		}
	}
	return null;
}

export function clientWebsite(client: BrandableClient): string | null {
	if (!client.client_uri || !client.redirect_uri) return null;
	try {
		const website = new URL(client.client_uri);
		return website.protocol === 'https:' && website.origin === new URL(client.redirect_uri).origin
			? website.href : null;
	} catch { return null; }
}

/** Two-letter fallback for clients we do not recognise. */
export function clientInitials(name: string): string {
	const words = name
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.split(/\s+/)
		.filter(Boolean);
	if (words.length === 0) return '?';
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[1][0]).toUpperCase();
}

/** Human-readable host for "you'll be sent back to …". */
export function redirectHost(redirectUri: string): string {
	try {
		const url = new URL(redirectUri);
		if (url.protocol === 'http:' || url.protocol === 'https:') return url.host;
		// cursor://anysphere.cursor-retrieval/… → "cursor"
		return url.protocol.replace(/:$/, '');
	} catch {
		return redirectUri;
	}
}
