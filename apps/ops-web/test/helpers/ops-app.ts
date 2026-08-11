import { createOpsApp } from "../../src/server/app";
import { createFixtureOpsStatusStore } from "../../src/server/ops-status-store";

type TestOpsAppOptions = NonNullable<Parameters<typeof createOpsApp>[0]>;

export function createTestOpsApp(options: TestOpsAppOptions = {}) {
	return createOpsApp({
		staticRoot: "test/fixtures/static",
		store: createFixtureOpsStatusStore(),
		...options,
	});
}
