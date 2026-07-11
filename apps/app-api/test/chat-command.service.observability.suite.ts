import { registerChatCommandServiceObservabilityRuntimeFactsSuite } from "./chat-command.service.observability.runtime-facts.suite";
import { registerChatCommandServiceObservabilityScopeSuite } from "./chat-command.service.observability.scope.suite";
import { registerChatCommandServiceObservabilityStatusSuite } from "./chat-command.service.observability.status.suite";

export function registerChatCommandServiceObservabilitySuite(): void {
	registerChatCommandServiceObservabilityStatusSuite();
	registerChatCommandServiceObservabilityScopeSuite();
	registerChatCommandServiceObservabilityRuntimeFactsSuite();
}
