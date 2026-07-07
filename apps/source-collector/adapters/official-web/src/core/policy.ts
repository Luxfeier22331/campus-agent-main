import type {
	OfficialWebConfigBundle,
	OfficialWebDiscoveryMethod,
	OfficialWebHostPolicy,
} from "./config.ts";

export const OFFICIAL_WEB_URL_IDENTITY_BASES = [
	"declared_canonical",
	"final_url",
	"requested_url",
] as const;
export const OFFICIAL_WEB_TRACKING_QUERY_PARAM_KEYS = [
	"spm",
	"from",
	"source",
	"sourceid",
	"session",
	"sid",
	"token",
] as const;
const OFFICIAL_WEB_DEFAULT_INDEX_FILENAMES = new Set(["index.html", "index.htm"]);

export type OfficialWebUrlIdentityBasis = (typeof OFFICIAL_WEB_URL_IDENTITY_BASES)[number];
export type OfficialWebAdmissionReason =
	| "admitted"
	| "invalid_url"
	| "scheme_not_allowed"
	| "host_not_allowlisted"
	| "cross_host_navigation_not_allowed"
	| "host_disabled"
	| "path_not_allowed"
	| "path_denied"
	| "query_params_not_allowed";

export interface OfficialWebNormalizedUrl {
	originalUrl: string;
	normalizedUrl: string;
	host: string;
	path: string;
	retainedQueryParams: string[];
	removedTrackingQueryParams: string[];
	removedDisallowedQueryParams: string[];
}

export interface OfficialWebAdmissionResult {
	admitted: boolean;
	reason: OfficialWebAdmissionReason;
	normalizedUrl: string | null;
	host: string | null;
	hostPolicy: OfficialWebHostPolicy | null;
	retainedQueryParams: string[];
	removedTrackingQueryParams: string[];
	removedDisallowedQueryParams: string[];
}

export interface OfficialWebUrlIdentity {
	requestedUrl: string;
	finalUrl: string | null;
	declaredCanonicalUrl: string | null;
	normalizedCanonicalUrl: string;
	urlIdentityBasis: OfficialWebUrlIdentityBasis;
}

export function findOfficialWebHostPolicy(
	bundle: OfficialWebConfigBundle,
	host: string,
): OfficialWebHostPolicy | null {
	const normalizedHost = host.toLowerCase();
	return bundle.hosts.hosts.find((item) => item.host.toLowerCase() === normalizedHost) ?? null;
}

export function normalizeOfficialWebUrl(
	url: string,
	options: { allowedQueryParams?: string[] } = {},
): OfficialWebNormalizedUrl | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}

	parsed.protocol = parsed.protocol.toLowerCase();
	parsed.hostname = parsed.hostname.toLowerCase();
	parsed.hash = "";
	if (
		(parsed.protocol === "https:" && parsed.port === "443") ||
		(parsed.protocol === "http:" && parsed.port === "80")
	) {
		parsed.port = "";
	}
	parsed.pathname = normalizeCanonicalPath(parsed.pathname);

	const allowedQueryParams = new Set(
		(options.allowedQueryParams ?? []).map((item) => item.toLowerCase()),
	);
	const retainedEntries: [string, string][] = [];
	const retainedQueryParams = new Set<string>();
	const removedTrackingQueryParams = new Set<string>();
	const removedDisallowedQueryParams = new Set<string>();

	for (const [key, value] of parsed.searchParams.entries()) {
		const normalizedKey = key.toLowerCase();
		if (isTrackingQueryParam(normalizedKey)) {
			removedTrackingQueryParams.add(normalizedKey);
			continue;
		}
		if (allowedQueryParams.has(normalizedKey)) {
			retainedEntries.push([normalizedKey, value]);
			retainedQueryParams.add(normalizedKey);
			continue;
		}
		removedDisallowedQueryParams.add(normalizedKey);
	}

	parsed.search = "";
	const searchParams = new URLSearchParams();
	for (const [key, value] of retainedEntries) {
		searchParams.append(key, value);
	}
	searchParams.sort();
	const normalizedSearch = searchParams.toString();
	if (normalizedSearch.length > 0) {
		parsed.search = `?${normalizedSearch}`;
	}

	return {
		originalUrl: url,
		normalizedUrl: parsed.toString(),
		host: parsed.hostname,
		path: parsed.pathname,
		retainedQueryParams: [...retainedQueryParams],
		removedTrackingQueryParams: [...removedTrackingQueryParams],
		removedDisallowedQueryParams: [...removedDisallowedQueryParams],
	};
}

export function admitOfficialWebUrl(
	bundle: OfficialWebConfigBundle,
	input: {
		url: string;
		discoveryMethod: OfficialWebDiscoveryMethod;
		sourceHost?: string | null;
	},
): OfficialWebAdmissionResult {
	const parsed = normalizeOfficialWebUrl(input.url, {
		allowedQueryParams: bundle.crawlPolicy.defaultQueryParamAllowlist,
	});
	if (!parsed) {
		return rejectedAdmission("invalid_url");
	}
	if (
		!bundle.crawlPolicy.schemeAllowlist.includes(
			new URL(parsed.normalizedUrl).protocol.replace(/:$/, ""),
		)
	) {
		return rejectedAdmission("scheme_not_allowed");
	}

	const hostPolicy = findOfficialWebHostPolicy(bundle, parsed.host);
	if (!(hostPolicy && bundle.site.allowedHosts.includes(parsed.host))) {
		return rejectedAdmission("host_not_allowlisted");
	}
	if (
		input.discoveryMethod === "navigation" &&
		bundle.crawlPolicy.expandWithinSameHostnameOnly &&
		input.sourceHost != null &&
		input.sourceHost.length > 0 &&
		input.sourceHost.toLowerCase() !== parsed.host
	) {
		return rejectedAdmission("cross_host_navigation_not_allowed", hostPolicy);
	}
	if (!hostPolicy.enabled) {
		return rejectedAdmission("host_disabled", hostPolicy);
	}

	const normalized = normalizeOfficialWebUrl(input.url, {
		allowedQueryParams: [
			...bundle.crawlPolicy.defaultQueryParamAllowlist,
			...hostPolicy.queryParamAllowlist,
		],
	});
	if (!normalized) {
		return rejectedAdmission("invalid_url");
	}
	if (normalized.removedDisallowedQueryParams.length > 0) {
		return {
			admitted: false,
			reason: "query_params_not_allowed",
			normalizedUrl: null,
			host: hostPolicy.host,
			hostPolicy,
			retainedQueryParams: normalized.retainedQueryParams,
			removedTrackingQueryParams: normalized.removedTrackingQueryParams,
			removedDisallowedQueryParams: normalized.removedDisallowedQueryParams,
		};
	}
	if (
		!hostPolicy.allowedPathPrefixes.some((prefix) =>
			prefix === "/" ? true : normalized.path.startsWith(prefix),
		)
	) {
		return rejectedAdmission("path_not_allowed", hostPolicy);
	}

	const deniedPatterns = [
		...bundle.crawlPolicy.defaultDeniedPathPatterns,
		...hostPolicy.deniedPathPatterns,
	];
	if (deniedPatterns.some((pattern) => new RegExp(pattern, "i").test(normalized.path))) {
		return rejectedAdmission("path_denied", hostPolicy);
	}

	return {
		admitted: true,
		reason: "admitted",
		normalizedUrl: normalized.normalizedUrl,
		host: hostPolicy.host,
		hostPolicy,
		retainedQueryParams: normalized.retainedQueryParams,
		removedTrackingQueryParams: normalized.removedTrackingQueryParams,
		removedDisallowedQueryParams: normalized.removedDisallowedQueryParams,
	};
}

export function buildOfficialWebUrlIdentity(
	bundle: OfficialWebConfigBundle,
	input: {
		requestedUrl: string;
		finalUrl?: string | null;
		declaredCanonicalUrl?: string | null;
	},
): OfficialWebUrlIdentity {
	const declaredCanonicalUrl = normalizeOptionalString(input.declaredCanonicalUrl);
	if (declaredCanonicalUrl != null && isAbsoluteUrlString(declaredCanonicalUrl)) {
		const canonicalAdmission = admitOfficialWebUrl(bundle, {
			url: declaredCanonicalUrl,
			discoveryMethod: "navigation",
		});
		if (canonicalAdmission.admitted && canonicalAdmission.normalizedUrl != null) {
			return {
				requestedUrl: input.requestedUrl,
				finalUrl: normalizeOptionalString(input.finalUrl),
				declaredCanonicalUrl,
				normalizedCanonicalUrl: canonicalAdmission.normalizedUrl,
				urlIdentityBasis: "declared_canonical",
			};
		}
	}

	const finalUrl = normalizeOptionalString(input.finalUrl);
	if (finalUrl != null) {
		const finalAdmission = admitOfficialWebUrl(bundle, {
			url: finalUrl,
			discoveryMethod: "navigation",
		});
		if (finalAdmission.admitted && finalAdmission.normalizedUrl != null) {
			return {
				requestedUrl: input.requestedUrl,
				finalUrl,
				declaredCanonicalUrl,
				normalizedCanonicalUrl: finalAdmission.normalizedUrl,
				urlIdentityBasis: "final_url",
			};
		}
	}

	const requestedAdmission = admitOfficialWebUrl(bundle, {
		url: input.requestedUrl,
		discoveryMethod: "navigation",
	});
	if (!requestedAdmission.admitted || requestedAdmission.normalizedUrl == null) {
		throw new Error(`unable to derive URL identity from ${input.requestedUrl}`);
	}

	return {
		requestedUrl: input.requestedUrl,
		finalUrl,
		declaredCanonicalUrl,
		normalizedCanonicalUrl: requestedAdmission.normalizedUrl,
		urlIdentityBasis: "requested_url",
	};
}

function normalizeCanonicalPath(pathname: string): string {
	if (!pathname || pathname === "/") {
		return "/";
	}

	const segments = pathname.split("/");
	const filename = segments.at(-1)?.toLowerCase() ?? "";
	if (!OFFICIAL_WEB_DEFAULT_INDEX_FILENAMES.has(filename)) {
		return pathname;
	}

	segments.pop();
	const directoryPath = segments.join("/");
	if (!directoryPath) {
		return "/";
	}
	return directoryPath.endsWith("/") ? directoryPath : `${directoryPath}/`;
}

function rejectedAdmission(
	reason: Exclude<OfficialWebAdmissionReason, "admitted">,
	hostPolicy: OfficialWebHostPolicy | null = null,
): OfficialWebAdmissionResult {
	return {
		admitted: false,
		reason,
		normalizedUrl: null,
		host: hostPolicy?.host ?? null,
		hostPolicy,
		retainedQueryParams: [],
		removedTrackingQueryParams: [],
		removedDisallowedQueryParams: [],
	};
}

function isTrackingQueryParam(key: string): boolean {
	return (
		/^utm_/i.test(key) ||
		OFFICIAL_WEB_TRACKING_QUERY_PARAM_KEYS.includes(
			key as (typeof OFFICIAL_WEB_TRACKING_QUERY_PARAM_KEYS)[number],
		)
	);
}

function isAbsoluteUrlString(value: string): boolean {
	return /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value);
}

function normalizeOptionalString(value: string | null | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}
