import { resolve } from "node:path";

import type { CheerioCrawlingContext } from "crawlee";
import {
	defaultRepoRoot,
	type OfficialWebConfigBundle,
	type OfficialWebCrawlPlan,
	type OfficialWebRunIntent,
	type OfficialWebUrlResultOutcome,
} from "./core/index.ts";

export function buildSelectedHosts(
	plan: OfficialWebCrawlPlan,
	hostFilter?: string[],
): OfficialWebCrawlPlan["enabledHosts"] {
	if (hostFilter == null || hostFilter.length === 0) {
		return plan.enabledHosts;
	}

	const normalizedFilter = hostFilter.map((item) => item.toLowerCase());
	const enabledHostSet = new Set(plan.enabledHosts.map((item) => item.host.toLowerCase()));
	const unknownHosts = normalizedFilter.filter((item, index) => {
		if (!enabledHostSet.has(item)) {
			return normalizedFilter.indexOf(item) === index;
		}
		return false;
	});

	if (unknownHosts.length > 0) {
		throw new Error(`hostFilter references unknown or disabled hosts: ${unknownHosts.join(", ")}`);
	}

	const requestedHosts = new Set(normalizedFilter);
	return plan.enabledHosts.filter((item) => requestedHosts.has(item.host.toLowerCase()));
}

export function buildHostRequestQueueName(crawlRunId: string, host: string): string {
	const normalizedHost = host.toLowerCase().replace(/[^a-z0-9]+/g, "-");
	return `official-web-${crawlRunId}-${normalizedHost}`;
}

export function defaultCollectorOutputDir(siteId: string, crawlRunId: string): string {
	return resolve(defaultRepoRoot(), ".tmp", "official-web", siteId, crawlRunId);
}

export function buildRobotsUserAgent(bundle: OfficialWebConfigBundle): string {
	return bundle.site.userAgent.split(/[ /]/, 1)[0] ?? bundle.site.userAgent;
}

export function extractDeclaredCanonicalUrl(context: CheerioCrawlingContext): string | null {
	const cheerioRoot = (context as CheerioCrawlingContext & { $?: CheerioCrawlingContext["$"] }).$;
	if (typeof cheerioRoot === "function") {
		const htmlCanonical = cheerioRoot("link[rel='canonical']").first().attr("href");
		if (typeof htmlCanonical === "string" && htmlCanonical.trim().length > 0) {
			return htmlCanonical.trim();
		}
	}

	const linkHeader = context.response.headers.link;
	const candidate =
		typeof linkHeader === "string" ? linkHeader : Array.isArray(linkHeader) ? linkHeader[0] : null;
	if (typeof candidate !== "string") {
		return null;
	}

	const match = candidate.match(/<([^>]+)>\s*;\s*rel="?canonical"?/i);
	return match?.[1] ?? null;
}

export function resolveUrlOutcome(
	statusCode: number | null,
	contentType: string,
): OfficialWebUrlResultOutcome {
	if (statusCode === 304) {
		return "not_modified";
	}
	if (statusCode === 404 || statusCode === 410) {
		return "deleted";
	}
	if (statusCode != null && statusCode >= 400) {
		return "http_error";
	}
	if (contentType !== "text/html") {
		return "unsupported_content_type";
	}
	return "fetched";
}

export function resolveResponseBody(context: CheerioCrawlingContext): string {
	const maybeBody = (context as unknown as { body?: unknown }).body;
	if (typeof maybeBody === "string") {
		return maybeBody;
	}
	if (maybeBody instanceof Buffer) {
		return maybeBody.toString("utf-8");
	}
	const html = context.$.html();
	return typeof html === "string" ? html : "";
}

export function uniqueStrings(values: string[]): string[] {
	return [...new Set(values)];
}

export function parseOptionalInt(raw: string | undefined): number | undefined {
	if (typeof raw !== "string" || raw.length === 0) {
		return;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export function firstNonEmptyString(...values: Array<string | undefined>): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim();
		}
	}

	return;
}

export function parseRunIntent(value: string | undefined): OfficialWebRunIntent | undefined {
	if (!value) {
		return;
	}
	if (value === "baseline" || value === "hot" || value === "repair") {
		return value;
	}

	throw new Error("--run-intent must be one of: baseline, hot, repair");
}
