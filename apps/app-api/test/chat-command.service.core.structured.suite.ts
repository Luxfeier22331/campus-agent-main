import { registerChatCommandServiceCoreStructuredPart01Suite } from "./chat-command.service.core.structured.part01.suite";
import { registerChatCommandServiceCoreStructuredPart03Suite } from "./chat-command.service.core.structured.part03.suite";
import { registerChatCommandServiceCoreStructuredPart04Suite } from "./chat-command.service.core.structured.part04.suite";

export function registerChatCommandServiceCoreStructuredSuite(): void {
	registerChatCommandServiceCoreStructuredPart01Suite();
	registerChatCommandServiceCoreStructuredPart03Suite();
	registerChatCommandServiceCoreStructuredPart04Suite();
}
