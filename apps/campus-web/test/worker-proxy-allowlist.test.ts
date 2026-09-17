import { describe, expect, it } from "vitest";

import { isAllowedCampusAppApiRequest } from "../src/platform/worker-proxy/allowlist";

describe("campus worker app-api proxy allowlist", () => {
	it("does not proxy campus map static assets to app-api", () => {
		expect(isAllowedCampusAppApiRequest("/api/campus-map/manifest")).toBe(false);
		expect(isAllowedCampusAppApiRequest(`/api/campus-map/assets/${"a".repeat(64)}.geojson`)).toBe(
			false,
		);
		expect(isAllowedCampusAppApiRequest("/campus-map/manifest.json")).toBe(false);
	});

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

	it("allows submission and current photo paths without exposing moderation or history", () => {
		for (const path of [
			"/api/dining/windows/hall:floor:window/submissions",
			"/api/dining/submissions/submission_1",
			"/api/dining/submissions/submission_1/reviews",
			"/api/dining/submissions/submission_1/reports",
			"/api/dining/submissions/submission_1/photos/photo_1",
			"/api/dining/me/submissions",
			"/api/dining/me/submissions/submission_1",
			"/api/dining/me/submissions/submission_1/photos/photo_1",
		]) {
			expect(isAllowedCampusAppApiRequest(path)).toBe(true);
		}
		for (const path of [
			"/api/dining/submissions/submission_1/history",
			"/api/dining/submissions/submission_1/restore",
			"/api/ops/dining/submissions/submission_1",
			"/api/dining/me/submissions/submission_1/photos/photo_1/extra",
		]) {
			expect(isAllowedCampusAppApiRequest(path)).toBe(false);
		}
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

	it("allows the run steps route used by the chat status surface", () => {
		expect(isAllowedCampusAppApiRequest("/api/chat/requests/req_01HQ/steps")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/chat/requests/req_01HQ/steps/raw")).toBe(false);
	});

	it("allows only the public campus groups catalog", () => {
		expect(isAllowedCampusAppApiRequest("/api/campus-groups/catalog")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/internal/ops/campus-groups/state")).toBe(false);
	});

	it("allows only the explicit federation browser contract", () => {
		for (const path of [
			"/api/federation/client",
			"/api/federation/authorize",
			"/api/federation/consent",
			"/api/federation/token",
			"/api/federation/userinfo",
			"/api/federation/jwks",
			"/api/federation/logout",
		]) {
			expect(isAllowedCampusAppApiRequest(path)).toBe(true);
		}
		expect(isAllowedCampusAppApiRequest("/api/federation/admin")).toBe(false);
	});

	it("allows chat run status and step routes", () => {
		expect(isAllowedCampusAppApiRequest("/api/chat/requests/req_01")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/chat/requests/req_01/events")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/chat/requests/req_01/steps")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/chat/requests/req_01/steps/extra")).toBe(false);
	});

	it("allows only the notice catalog, decimal details, and image ordinals", () => {
		expect(isAllowedCampusAppApiRequest("/api/notices")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/notices/358159")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/notices/358159/images/0")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/notices/latest")).toBe(false);
		expect(isAllowedCampusAppApiRequest("/api/notices/358159/attachments/0")).toBe(false);
	});

	it("allows the public transport schedule route without broadening transport paths", () => {
		expect(isAllowedCampusAppApiRequest("/api/transport/schedule")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/transport/schedule-range")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/transport/admin")).toBe(false);
		expect(isAllowedCampusAppApiRequest("/api/transport/schedule/items")).toBe(false);
	});
});
