import { registerChatCommandServiceCoreIdentitySuite } from "./chat-command.service.core.identity.suite";
import { registerChatCommandServiceCoreLifecycleSuite } from "./chat-command.service.core.lifecycle.suite";
import { registerChatCommandServiceCoreStructuredSuite } from "./chat-command.service.core.structured.suite";

export function registerChatCommandServiceCoreSuite(): void {
	registerChatCommandServiceCoreIdentitySuite();
	registerChatCommandServiceCoreLifecycleSuite();
	registerChatCommandServiceCoreStructuredSuite();
}
