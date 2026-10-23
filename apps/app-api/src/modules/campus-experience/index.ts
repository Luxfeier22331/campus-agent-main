import { AppApiRouteError } from "../../http";
import type { CampusExperienceService, FeedbackCategory, SubmitFeedbackInput } from "./types";

export type {
	CampusExperienceService,
	FeedbackCategory,
	SubmitFeedbackInput,
	SubmitFeedbackResponse,
} from "./types";

export function buildCampusExperienceService(): CampusExperienceService {
	return {
		async submitFeedback(input) {
			return {
				feedback: {
					category: input.category,
					feedbackId: createFeedbackId(input),
					receivedAt: new Date().toISOString(),
					routeContext: input.routeContext,
					status: "received",
				},
			};
		},
	};
}

export function parseFeedbackCategory(value: unknown): FeedbackCategory {
	if (
		value === "content_issue" ||
		value === "dining_issue" ||
		value === "experience_issue" ||
		value === "map_issue" ||
		value === "other"
	) {
		return value;
	}

	throw new AppApiRouteError({
		code: "validation_failed",
		details: { field: "category" },
		message: "category must be a supported feedback category.",
		retryable: false,
		status: 400,
	});
}

function createFeedbackId(input: SubmitFeedbackInput): string {
	const material = `${input.category}:${input.routeContext}:${input.body}`;
	let hash = 0;
	for (let index = 0; index < material.length; index += 1) {
		hash = (hash * 31 + material.charCodeAt(index)) >>> 0;
	}
	return `fb_${hash.toString(36).padStart(8, "0")}`;
}
