import { registerChatCommandServiceObservabilityRuntimeFactsSuite } from "./chat-command.service.observability.runtime-facts.suite";
import { registerChatCommandServiceObservabilityStatusSuite } from "./chat-command.service.observability.status.suite";
import { registerChatCommandServiceObservabilityTargetsSuite } from "./chat-command.service.observability.targets.suite";

export function registerChatCommandServiceObservabilitySuite(): void {
	registerChatCommandServiceObservabilityStatusSuite();
	registerChatCommandServiceObservabilityTargetsSuite();
	registerChatCommandServiceObservabilityRuntimeFactsSuite();
}
