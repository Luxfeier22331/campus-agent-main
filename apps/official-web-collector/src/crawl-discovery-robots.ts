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
		const response = await fetch(robotsUrl, {
			headers: {
				"user-agent": bundle.site.userAgent,
			},
			redirect: "follow",
		});
		if (response.status === 429) {
			return {
				robots: null,
				blocked: true,
				failure: buildOfficialWebFailureRecord({
					siteId: plan.siteId,
					crawlRunId: plan.crawlRunId,
					host: hostPolicy.host,
					url: robotsUrl,
					phase: "robots",
					reason: "robots_rate_limited",
					message: `robots.txt returned ${response.status}`,
					retryable: true,
				}),
			};
		}
		if (response.status >= 500) {
			return {
				robots: null,
				blocked: true,
				failure: buildOfficialWebFailureRecord({
					siteId: plan.siteId,
					crawlRunId: plan.crawlRunId,
					host: hostPolicy.host,
					url: robotsUrl,
					phase: "robots",
					reason: "robots_server_error",
					message: `robots.txt returned ${response.status}`,
					retryable: true,
				}),
			};
		}
		if (response.status >= 400) {
			return {
				robots: null,
				blocked: false,
				failure: null,
			};
		}

		const robotsContent = await response.text();
		const robots = RobotsTxtFile.from(robotsUrl, robotsContent);
		return {
			robots,
			blocked: false,
			failure: null,
		};
	} catch (error) {
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
