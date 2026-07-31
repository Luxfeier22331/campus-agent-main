import type { ChatMessageStructuredPart } from "../../chat";
import type { ToolExecutionResponse } from "../../integration";
import { normalizeSourceItemsPart } from "./normalize-source-items";

export { normalizeSourceItemsPart } from "./normalize-source-items";

export function normalizeChatResponseStructuredParts(input: {
	allowedPublicNoticeHosts?: readonly string[];
	status: ToolExecutionResponse["status"];
	result: unknown;
}): ChatMessageStructuredPart[] {
	return normalizeSourceItemsPart({
		...input,
		allowedPublicNoticeHosts: input.allowedPublicNoticeHosts,
	});
}
