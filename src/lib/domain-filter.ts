/** Retire an address filter without closing an already-open conversation. */
export function clearAddressFilterHref(current: URL): string {
	const url = new URL(current);
	url.searchParams.delete('address');
	return `${url.pathname}${url.search}${url.hash}`;
}

/** Switching domains resets the selection and includes every recipient. */
export function domainFilterHref(current: URL): string {
	const url = new URL(clearAddressFilterHref(current), current);
	for (const key of ['thread', 'page']) url.searchParams.delete(key);
	return `${url.pathname}${url.search}${url.hash}`;
}
