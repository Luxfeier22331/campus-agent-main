import { describe, expect, it } from "vitest";

import { isAllowedCampusAppApiRequest } from "../src/platform/worker-proxy/allowlist";

describe("campus worker app-api proxy allowlist", () => {
	it("allows profile memory routes used by the student account surface", () => {
		expect(isAllowedCampusAppApiRequest("/api/me/profile-memory")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/me/profile-memory/items")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/me/profile-memory/settings")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/me/profile-memory/items/mem_01HQ")).toBe(true);
	});
});
