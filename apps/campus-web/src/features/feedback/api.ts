import { requestJson } from "@/platform/api/client";
import type { SubmitFeedbackInput, SubmitFeedbackResponse } from "./model";

export async function submitFeedback(input: SubmitFeedbackInput): Promise<SubmitFeedbackResponse> {
	return requestJson<SubmitFeedbackResponse>({
		body: JSON.stringify(input),
		headers: { "content-type": "application/json" },
		method: "POST",
		path: "/api/feedback",
	});
}
