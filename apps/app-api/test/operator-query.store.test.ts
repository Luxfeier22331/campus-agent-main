// @vitest-environment node

import { describe, vi } from "vitest";

const { createRuntimeDatabase, createRuntimeDbGetter } = vi.hoisted(() => ({
	createRuntimeDatabase: vi.fn(),
	createRuntimeDbGetter: vi.fn(() => () => createRuntimeDatabase()),
}));

vi.mock("../src/db/runtime", () => ({
	createRuntimeDatabase,
	createRuntimeDbGetter,
}));

import { encodeBase64UrlJson } from "../src/base64url";
import { createPgOperatorQueryStore } from "../src/modules/operator-query/store";
import { registerOperatorQueryStoreCursorsSuite } from "./operator-query.store.cursors.suite";
import { registerOperatorQueryStoreOverviewSuite } from "./operator-query.store.overview.suite";
import type { OperatorQueryStoreSuiteContext } from "./operator-query.store.suite-context";

function resetOperatorQueryStoreMocks(): void {
	createRuntimeDatabase.mockReset();
	createRuntimeDbGetter.mockClear();
	createRuntimeDbGetter.mockImplementation(() => () => createRuntimeDatabase());
}

describe("pg operator query store", () => {
	const ctx = {
		createPgOperatorQueryStore,
		createRuntimeDatabase,
		encodeBase64UrlJson,
		resetOperatorQueryStoreMocks,
	} satisfies OperatorQueryStoreSuiteContext;

	registerOperatorQueryStoreOverviewSuite(ctx);
	registerOperatorQueryStoreCursorsSuite(ctx);
});
