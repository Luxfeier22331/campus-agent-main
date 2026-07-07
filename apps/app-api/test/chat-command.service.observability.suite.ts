import { registerChatCommandServiceObservabilityDiagnosticsSuite } from "./chat-command.service.observability.diagnostics.suite";
import { registerChatCommandServiceObservabilityRuntimeFactsSuite } from "./chat-command.service.observability.runtime-facts.suite";
import { registerChatCommandServiceObservabilityStatusSuite } from "./chat-command.service.observability.status.suite";

export function registerChatCommandServiceObservabilitySuite(): void {
	registerChatCommandServiceObservabilityStatusSuite();
	registerChatCommandServiceObservabilityDiagnosticsSuite();
	registerChatCommandServiceObservabilityRuntimeFactsSuite();
}
