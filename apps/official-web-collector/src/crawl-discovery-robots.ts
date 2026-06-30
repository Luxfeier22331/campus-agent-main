import { RobotsTxtFile } from "crawlee";
import type { CollectorRobotsState } from "./crawl-internal-types.ts";
import {
	buildOfficialWebFailureRecord,
	type OfficialWebConfigBundle,
	type OfficialWebCrawlPlan,
	type OfficialWebHostPolicy,
} from "./official-web-core.ts";

export async function loadRobotsState(
	bundle: OfficialWebConfigBundle,
	plan: OfficialWebCrawlPlan,
	hostPolicy: OfficialWebHostPolicy,
): Promise<CollectorRobotsState> {
	const robotsUrl = `https://${hostPolicy.host}/robots.txt`;

	try {
		const robots = await RobotsTxtFile.find(`https://${hostPolicy.host}/`, undefined, {
			timeoutMillis: bundle.site.requestTimeoutMs,
		});
		return {
			robots,
			blocked: false,
			failure: null,
		};
	} catch (error) {
		const statusCode = resolveHttpStatusCode(error);
		if (statusCode === 429) {
			return buildBlockedRobotsFailure({
				plan,
				hostPolicy,
				robotsUrl,
				reason: "robots_rate_limited",
				message: `robots.txt returned ${statusCode}`,
			});
		}
		if (statusCode != null && statusCode >= 500) {
			return buildBlockedRobotsFailure({
				plan,
				hostPolicy,
				robotsUrl,
				reason: "robots_server_error",
				message: `robots.txt returned ${statusCode}`,
			});
		}
		return {
			robots: null,
			blocked: true,
			failure: buildOfficialWebFailureRecord({
				siteId: plan.siteId,
				crawlRunId: plan.crawlRunId,
				host: hostPolicy.host,
				url: robotsUrl,
				phase: "robots",
				reason: "robots_fetch_failed",
				message: formatErrorWithCauses(error),
				retryable: true,
			}),
		};
	}
}

function buildBlockedRobotsFailure(input: {
	plan: OfficialWebCrawlPlan;
	hostPolicy: OfficialWebHostPolicy;
	robotsUrl: string;
	reason: "robots_rate_limited" | "robots_server_error";
	message: string;
}): CollectorRobotsState {
	return {
		robots: null,
		blocked: true,
		failure: buildOfficialWebFailureRecord({
			siteId: input.plan.siteId,
			crawlRunId: input.plan.crawlRunId,
			host: input.hostPolicy.host,
			url: input.robotsUrl,
			phase: "robots",
			reason: input.reason,
			message: input.message,
			retryable: true,
		}),
	};
}

function resolveHttpStatusCode(error: unknown): number | null {
	if (!(error && typeof error === "object")) {
		return null;
	}
	const response = (error as { response?: { status?: unknown; statusCode?: unknown } }).response;
	const status = response?.statusCode ?? response?.status;
	return typeof status === "number" ? status : null;
}

function formatErrorWithCauses(error: unknown): string {
	if (!(error instanceof Error)) {
		return String(error);
	}

	const parts = [error.message];
	let currentCause = error.cause;
	while (currentCause != null) {
		if (currentCause instanceof Error) {
			parts.push(currentCause.message);
			currentCause = currentCause.cause;
			continue;
		}
		parts.push(String(currentCause));
		break;
	}

	return parts.join(" | caused by: ");
}
