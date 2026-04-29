// @vitest-environment node

import { describe } from "vitest";

import { registerOfficialWebE2EDispatchedProjectionSuite } from "./official-web-e2e-dispatched-projection.suite";
import { registerOfficialWebE2ENotModifiedSuite } from "./official-web-e2e-not-modified.suite";

describe("official web app-api e2e", () => {
	registerOfficialWebE2EDispatchedProjectionSuite();
	registerOfficialWebE2ENotModifiedSuite();
});
