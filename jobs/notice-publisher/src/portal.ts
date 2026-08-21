import descriptor from "../../../configs/sources/internal-portal.json" with { type: "json" };

export function internalPortalHost(
	value: unknown = descriptor,
): string {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("internal portal descriptor must be a JSON object");
	}
	const portalBaseUrl = (value as Record<string, unknown>).portal_base_url;
	if (typeof portalBaseUrl !== "string" || !portalBaseUrl.trim()) {
		throw new Error("portal_base_url is required in the internal portal descriptor");
	}
	let url: URL;
	try {
		url = new URL(portalBaseUrl);
	} catch {
		throw new Error("portal_base_url must be a valid HTTPS URL");
	}
	if (url.protocol !== "https:" || url.username || url.password || url.hostname === "") {
		throw new Error("portal_base_url must be a credential-free HTTPS URL");
	}
	return url.hostname.toLowerCase();
}
