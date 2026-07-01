import { normalizeOptionalString } from "./normalize-record-utils";

export function normalizedAllowedPublicNoticeHosts(
	allowedHosts: readonly string[] | undefined,
): Set<string> {
	return new Set(
		(allowedHosts ?? [])
			.map((item) => item.trim().toLowerCase())
			.filter(Boolean)
			.map((item) => item.replace(/^https?:\/\//u, "").replace(/\/.*$/u, "")),
	);
}

export function normalizePublicNoticeUrl(value: unknown, allowedHosts: Set<string>): string | null {
	const rawUrl = normalizeOptionalString(value);
	if (!rawUrl) {
		return null;
	}
	try {
		const url = new URL(rawUrl);
		const hostname = url.hostname.toLowerCase();
		if (url.protocol !== "https:" || !publicNoticeHostAllowed(hostname, allowedHosts)) {
			return null;
		}
		return url.toString();
	} catch {
		return null;
	}
}

function publicNoticeHostAllowed(hostname: string, allowedHosts: Set<string>): boolean {
	if (hostname === "mp.weixin.qq.com") {
		return true;
	}
	return allowedHosts.has(hostname);
}
