import { afterEach, beforeEach, describe, vi } from "vitest";
import { registerDataProviderAuthenticatedNoticeProcessingSuite } from "./data-provider.authenticated-notice-processing.suite";
import { registerDataProviderObservabilityAndOperatorSuite } from "./data-provider.observability-and-operator.suite";
import { registerDataProviderOfficialWebSuite } from "./data-provider.official-web.suite";
import { registerDataProviderRequestsSuite } from "./data-provider.requests.suite";
import { registerDataProviderSafetyAuditSuite } from "./data-provider.safety-audit.suite";

describe("protected panel data provider", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	registerDataProviderRequestsSuite();
	registerDataProviderAuthenticatedNoticeProcessingSuite();
	registerDataProviderObservabilityAndOperatorSuite();
	registerDataProviderSafetyAuditSuite();
	registerDataProviderOfficialWebSuite();
});
