import {
	authCookiePrefix,
	ENVIRONMENT_LANES,
	type EnvironmentLane,
	LANE_COOKIE_NAME,
	LEGACY_AUTH_COOKIE_PREFIX,
} from "campus-contracts/environment-lanes";

const SECURE_COOKIE_PREFIX = "__Secure-";

export function readCookie(header: string | null, name: string): string | null {
	for (const pair of splitCookieHeader(header)) {
		if (cookieName(pair) === name) {
			return pair.slice(name.length + 1);
		}
	}
	return null;
}

// Removes the lane cookie, other lanes' auth cookies and pre-lane Better Auth cookies,
// so a lane backend never receives another environment's session.
export function isolateLaneCookies(header: string | null, target: EnvironmentLane): string | null {
	const foreignPrefixes = [
		LEGACY_AUTH_COOKIE_PREFIX,
		...ENVIRONMENT_LANES.filter((lane) => lane !== target).map(authCookiePrefix),
	].map((prefix) => `${prefix}.`);
	const kept = splitCookieHeader(header).filter((pair) => {
		const name = cookieName(pair);
		if (name === LANE_COOKIE_NAME) {
			return false;
		}
		const unprefixed = name.startsWith(SECURE_COOKIE_PREFIX)
			? name.slice(SECURE_COOKIE_PREFIX.length)
			: name;
		return !foreignPrefixes.some((prefix) => unprefixed.startsWith(prefix));
	});
	return kept.length > 0 ? kept.join("; ") : null;
}

function splitCookieHeader(header: string | null): string[] {
	if (!header) {
		return [];
	}
	return header
		.split(";")
		.map((pair) => pair.trim())
		.filter((pair) => pair.length > 0);
}

function cookieName(pair: string): string {
	const separator = pair.indexOf("=");
	return (separator === -1 ? pair : pair.slice(0, separator)).trim();
}
