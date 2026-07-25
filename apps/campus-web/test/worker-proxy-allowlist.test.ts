import { describe, expect, it } from "vitest";

import { isAllowedCampusAppApiRequest } from "../src/platform/worker-proxy/allowlist";

describe("campus worker app-api proxy allowlist", () => {
	it("allows student dining read routes", () => {
		expect(isAllowedCampusAppApiRequest("/api/dining")).toBe(true);
		expect(isAllowedCampusAppApiRequest(`/api/dining/floorplans/${"a".repeat(64)}.svg`)).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/dining/floorplans/not-a-digest.svg")).toBe(false);
		expect(isAllowedCampusAppApiRequest("/api/dining/publication")).toBe(false);
		expect(isAllowedCampusAppApiRequest("/api/dining/search")).toBe(false);
		expect(isAllowedCampusAppApiRequest("/api/dining/windows/hall:floor:window-01/menu")).toBe(
			true,
		);
		expect(isAllowedCampusAppApiRequest("/api/dining/menu-items/menu-1/reviews")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/dining/reviews/review-1")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/dining/reviews/review-1/reports")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/dining/windows//menu")).toBe(false);
		expect(isAllowedCampusAppApiRequest("/api/dining/reviews/review-1/edit")).toBe(false);
	});

	it("allows profile memory routes used by the student account surface", () => {
		expect(isAllowedCampusAppApiRequest("/api/me/profile-memory")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/me/profile-memory/items")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/me/profile-memory/settings")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/me/profile-memory/items/mem_01HQ")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/me/profile-memory/export")).toBe(false);
		expect(isAllowedCampusAppApiRequest("/api/me/security/sessions")).toBe(false);
		expect(isAllowedCampusAppApiRequest("/api/me/authorized-apps")).toBe(false);
	});

	it("allows the public campus services transport schedule projection", () => {
		expect(isAllowedCampusAppApiRequest("/api/campus-services/transport-schedule/status")).toBe(
			true,
		);
	});
});
