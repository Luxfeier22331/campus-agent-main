import type { SupervisorExecutionResponse } from "../../app-api/src/modules/integration";

export type CampusServicesTool =
	| "contact_directory_lookup"
	| "service_guide_lookup"
	| "service_status_lookup"
	| "transport_schedule_lookup";

export interface CampusServicesRoutingCase {
	expectedAnswerFragment: string;
	expectedTool: CampusServicesTool;
	prompt: string;
	toolResult: Record<string, unknown>;
}

export interface CampusServicesGuardrailCase {
	expectedResultKind: "answer" | "clarification" | "no_answer" | "error";
	expectedStatus: SupervisorExecutionResponse["status"];
	expectedTextFragments: string[];
	expectedTool: CampusServicesTool;
	forbiddenTextFragments: string[];
	name: string;
	prompt: string;
	responseAnswerText: string;
	responseFollowUpQuestion: string;
	toolResult: Record<string, unknown>;
}
