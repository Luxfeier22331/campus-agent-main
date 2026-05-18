import { captureDynamicShellNetwork } from "./dynamic-shell-discovery-network.ts";
import { resolvePromotedUrlsWithHtmlRedirects } from "./dynamic-shell-discovery-redirects.ts";
import type {
	OfficialWebDynamicShellDiscovererInput,
	OfficialWebDynamicShellDiscoveryAudit,
	OfficialWebDynamicShellDiscoveryResult,
} from "./dynamic-shell-discovery-types.ts";
import {
	compilePatterns,
	extractPromotedUrlsFromNetworkCaptures,
	matchesAny,
} from "./dynamic-shell-discovery-url-extraction.ts";
import { admitOfficialWebUrl } from "./official-web-core.ts";

export { resolvePromotedUrlsWithHtmlRedirects } from "./dynamic-shell-discovery-redirects.ts";
export type {
	DynamicShellNetworkCapture,
	OfficialWebDynamicShellDiscoverer,
	OfficialWebDynamicShellDiscovererInput,
	OfficialWebDynamicShellDiscovererOutput,
	OfficialWebDynamicShellDiscoveryAudit,
	OfficialWebDynamicShellDiscoveryPolicy,
	OfficialWebDynamicShellDiscoveryResult,
} from "./dynamic-shell-discovery-types.ts";
export { extractPromotedUrlsFromNetworkCaptures } from "./dynamic-shell-discovery-url-extraction.ts";

export async function discoverDynamicShellPromotedUrls(
	input: OfficialWebDynamicShellDiscovererInput,
): Promise<OfficialWebDynamicShellDiscoveryResult> {
	const policy = input.hostPolicy.dynamicShellDiscovery;
	if (!policy?.enabled) {
		return {
			promotedUrls: [],
			audit: {
				sourceUrl: input.page.pageManifest.finalUrl,
				host: input.hostPolicy.host,
				wait: {
					waitAfterLoadMs: 0,
					networkObservationTimeoutMs: 0,
					matchedResponseUrl: null,
					matchedSelector: null,
					usedNetworkIdleWait: false,
					usedFixedDelayWait: false,
				},
				captures: [],
				extractedUrls: [],
				resolvedUrls: [],
				admissions: [],
				promotedUrls: [],
			},
		};
	}

	const captureResult = await captureDynamicShellNetwork({
		policy,
		url: input.page.pageManifest.finalUrl,
	});
	const captures = captureResult.captures;
	const ignoredRequestMatchers = compilePatterns(policy.ignoredRequestUrlPatterns);
	const allowedRequestMatchers = compilePatterns(policy.allowedRequestUrlPatterns);
	const extractedUrls = extractPromotedUrlsFromNetworkCaptures({
		baseUrl: input.page.pageManifest.finalUrl,
		captures,
		policy,
	});
	const resolvedUrls = await resolvePromotedUrlsWithHtmlRedirects({
		urls: extractedUrls,
		userAgent: input.bundle.site.userAgent,
	});
	const promotedUrls = new Set<string>();
	const admissions: OfficialWebDynamicShellDiscoveryAudit["admissions"] = [];

	for (const url of resolvedUrls) {
		const admission = admitOfficialWebUrl(input.bundle, {
			url,
			discoveryMethod: "manual_requeue",
		});
		admissions.push({
			url,
			admitted: admission.admitted,
			normalizedUrl: admission.normalizedUrl,
			reason: admission.reason,
			host: admission.host,
		});
		if (!admission.admitted || admission.normalizedUrl == null) {
			continue;
		}

		const admittedHost = new URL(admission.normalizedUrl).hostname.toLowerCase();
		if (admittedHost !== input.hostPolicy.host) {
			continue;
		}

		promotedUrls.add(admission.normalizedUrl);
		if (promotedUrls.size >= policy.maxPromotedUrls) {
			break;
		}
	}

	return {
		promotedUrls: [...promotedUrls],
		audit: {
			sourceUrl: input.page.pageManifest.finalUrl,
			host: input.hostPolicy.host,
			wait: captureResult.wait,
			captures: captures.map((capture) => ({
				url: capture.url,
				status: capture.status,
				contentType: capture.contentType,
				ignored: matchesAny(capture.url, ignoredRequestMatchers),
				allowed:
					allowedRequestMatchers.length === 0 || matchesAny(capture.url, allowedRequestMatchers),
			})),
			extractedUrls,
			resolvedUrls,
			admissions,
			promotedUrls: [...promotedUrls],
		},
	};
}
