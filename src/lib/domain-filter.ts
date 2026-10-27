/** A domain includes every recipient, so discard any old address filter. */
export function domainFilterHref(current: URL): string {
	const url = new URL(current);
	for (const key of ['address', 'thread', 'page']) url.searchParams.delete(key);
	return `${url.pathname}${url.search}${url.hash}`;
}
