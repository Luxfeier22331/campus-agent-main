// @vitest-environment node

import { afterEach, describe, vi } from "vitest";

import {
	createSupervisorExecutionClient,
	probeSupervisorApiReady,
	SupervisorTransportError,
} from "../src/modules/integration/supervisor";
import { registerSupervisorAdapterAccessSuite } from "./supervisor-adapter.access.suite";
import { registerSupervisorAdapterErrorsSuite } from "./supervisor-adapter.errors.suite";
import { registerSupervisorAdapterRequestSuite } from "./supervisor-adapter.request.suite";
import { registerSupervisorAdapterResponseSuite } from "./supervisor-adapter.response.suite";
import {
	createActor,
	createAuthorization,
	createContext,
	readMockRequestBody,
} from "./supervisor-adapter.test-support";

describe("supervisor execution adapter", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	const ctx = {
		createActor,
		createAuthorization,
		createContext,
		createSupervisorExecutionClient,
		probeSupervisorApiReady,
		readMockRequestBody,
		SupervisorTransportError,
	};

	registerSupervisorAdapterRequestSuite(ctx);
	registerSupervisorAdapterAccessSuite(ctx);
	registerSupervisorAdapterResponseSuite(ctx);
	registerSupervisorAdapterErrorsSuite(ctx);
});
