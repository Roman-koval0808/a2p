/**
 * A safe internal redirect target, read from a `?next=` / `?redirect=` query param.
 *
 * Login flows hand the pre-login route back through the URL. That value comes from a query string a
 * client can set, so it must be validated before it is ever used as a redirect target — otherwise it
 * is an open redirect. Rules: must be a root-relative path, must not be protocol-relative, and must
 * not point back at an auth page (which would loop the login redirect).
 */
export function safeNext(value: string | null | undefined): string | null {
	if (!value) return null;
	if (!value.startsWith('/') || value.startsWith('//')) return null;
	if (value.startsWith('/login') || value.startsWith('/logout') || value.startsWith('/signup')) {
		return null;
	}
	return value;
}
