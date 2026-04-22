// @vitest-environment node

import { describe } from "vitest";

import { registerChatCommandServiceCoreSuite } from "./chat-command.service.core.suite";
import { registerChatCommandServiceCurriculumSuite } from "./chat-command.service.curriculum.suite";
import { registerChatCommandServiceIdempotencySuite } from "./chat-command.service.idempotency.suite";
import { registerChatCommandServiceObservabilitySuite } from "./chat-command.service.observability.suite";

describe("chat command service", () => {
	registerChatCommandServiceCoreSuite();
	registerChatCommandServiceCurriculumSuite();
	registerChatCommandServiceObservabilitySuite();
	registerChatCommandServiceIdempotencySuite();
});
