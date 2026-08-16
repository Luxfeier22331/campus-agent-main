import { registerChatCommandServiceObservabilityRuntimeFactsSuite } from "./chat-command.service.observability.runtime-facts.suite";
import { registerChatCommandServiceObservabilityStatusSuite } from "./chat-command.service.observability.status.suite";
import { registerChatCommandServiceObservabilitySupportingSourcesSuite } from "./chat-command.service.observability.targets.suite";

export function registerChatCommandServiceObservabilitySuite(): void {
	registerChatCommandServiceObservabilityStatusSuite();
	registerChatCommandServiceObservabilitySupportingSourcesSuite();
	registerChatCommandServiceObservabilityRuntimeFactsSuite();
}
