export type FeedbackCategory =
	| "content_issue"
	| "dining_issue"
	| "experience_issue"
	| "map_issue"
	| "other";

export interface SubmitFeedbackInput {
	body: string;
	category: FeedbackCategory;
	contact: string | null;
	routeContext: string;
}

export interface SubmitFeedbackResponse {
	feedback: {
		category: FeedbackCategory;
		feedbackId: string;
		receivedAt: string;
		routeContext: string;
		status: "received";
	};
}

export interface CampusExperienceService {
	submitFeedback(input: SubmitFeedbackInput): Promise<SubmitFeedbackResponse>;
}
