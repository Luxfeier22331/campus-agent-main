import { registerChatConversationRoutes } from "./chat-conversation-routes";
import { registerChatMessageRoutes } from "./chat-message-routes";
import { registerChatRequestRoutes } from "./chat-request-routes";
import { routeChatErrorResponse } from "./chat-route-support";
import type { ChatRouteRegistrationInput } from "./chat-route-types";
import { registerChatRunRoutes } from "./chat-run-routes";

export function registerChatRoutes(input: ChatRouteRegistrationInput) {
	registerChatRequestRoutes(input);
	registerChatRunRoutes({
		app: input.app,
		createRequestScope: input.createRequestScope,
		env: input.env,
		getPrincipal: input.getPrincipal,
		routeChatErrorResponse,
	});
	registerChatConversationRoutes(input);
	registerChatMessageRoutes(input);
}
