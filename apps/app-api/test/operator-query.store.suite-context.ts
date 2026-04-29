import type { vi } from "vitest";

import type { encodeBase64UrlJson } from "../src/base64url";
import type { createPgOperatorQueryStore } from "../src/modules/operator-query/store";
import type { summarizeSafetyAnomaly } from "../src/modules/operator-query/store/safety";

export interface OperatorQueryStoreSuiteContext {
	createPgOperatorQueryStore: typeof createPgOperatorQueryStore;
	createRuntimeDatabase: ReturnType<typeof vi.fn>;
	encodeBase64UrlJson: typeof encodeBase64UrlJson;
	resetOperatorQueryStoreMocks: () => void;
	summarizeSafetyAnomaly: typeof summarizeSafetyAnomaly;
}
