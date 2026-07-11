import type { OpsRequestDetailResponse } from "../shared/ops-contract";

export interface OpsObservabilityLinkAllowlist {
	axiom?: string;
	langfuse?: string;
	openobserve?: string;
	sentry?: string;
	temporal?: string;
}

type ExternalLinkSource = OpsRequestDetailResponse["externalLinks"][number]["source"];

export function normalizeDebugTraceLinkSource(value: unknown): "LANGFUSE" | null {
	const normalized = normalizeNullableString(value)?.toUpperCase();
	return normalized?.includes("LANGFUSE") ? "LANGFUSE" : null;
}

export function externalLinkPriority(source: ExternalLinkSource): number {
	return {
		LANGFUSE: 1,
		TEMPORAL: 2,
		SENTRY: 3,
		AXIOM: 4,
		OPENOBSERVE: 5,
	}[source];
}

export function normalizeAllowedExternalHref(
	source: ExternalLinkSource,
	href: string,
	allowlist: OpsObservabilityLinkAllowlist | undefined,
): string | null {
	const base = externalLinkBaseUrl(source, allowlist);
	if (!base) {
		return null;
	}
	let parsedHref: URL;
	let parsedBase: URL;
	try {
		parsedHref = new URL(href);
		parsedBase = new URL(base);
	} catch {
		return null;
	}
	if (parsedHref.protocol !== "https:" || parsedBase.protocol !== "https:") {
		return null;
	}
	if (parsedHref.origin !== parsedBase.origin) {
		return null;
	}
	if (!pathnameStartsWith(parsedHref.pathname, parsedBase.pathname)) {
		return null;
	}
	return parsedHref.toString();
}

export function toTemporalExternalLink(
	workflowId: string | null,
	allowlist: OpsObservabilityLinkAllowlist | undefined,
): OpsRequestDetailResponse["externalLinks"][number] | null {
	if (!workflowId) {
		return null;
	}
	const base = externalLinkBaseUrl("TEMPORAL", allowlist);
	if (!base) {
		return null;
	}
	let url: URL;
	try {
		url = new URL(base);
	} catch {
		return null;
	}
	if (url.protocol !== "https:") {
		return null;
	}
	const normalizedBasePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
	const namespacePath = normalizedBasePath.includes("/namespaces/")
		? normalizedBasePath
		: `${normalizedBasePath}/namespaces/default`;
	url.pathname = `${namespacePath}/workflows/${encodeURIComponent(workflowId)}`;
	return {
		href: url.toString(),
		isAvailable: true,
		label: "Temporal 工作流",
		source: "TEMPORAL",
	};
}

function externalLinkBaseUrl(
	source: ExternalLinkSource,
	allowlist: OpsObservabilityLinkAllowlist | undefined,
): string | null {
	if (!allowlist) {
		return null;
	}
	return (
		{
			AXIOM: allowlist.axiom,
			LANGFUSE: allowlist.langfuse,
			OPENOBSERVE: allowlist.openobserve,
			SENTRY: allowlist.sentry,
			TEMPORAL: allowlist.temporal,
		}[source]?.trim() || null
	);
}

function pathnameStartsWith(pathname: string, basePathname: string): boolean {
	const normalizedBase = basePathname.endsWith("/") ? basePathname.slice(0, -1) : basePathname;
	return (
		!normalizedBase || pathname === normalizedBase || pathname.startsWith(`${normalizedBase}/`)
	);
}

function normalizeNullableString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}
