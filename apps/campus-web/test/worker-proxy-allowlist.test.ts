import { describe, expect, it } from "vitest";

import { isAllowedCampusAppApiRequest } from "../src/platform/worker-proxy/allowlist";

describe("campus worker app-api proxy allowlist", () => {
	it("allows student dining read routes", () => {
		expect(isAllowedCampusAppApiRequest("/api/dining/bootstrap")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/dining/halls")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/dining/publication")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/dining/halls/haidian-canteen-1/floors/1f")).toBe(
			true,
		);
		expect(isAllowedCampusAppApiRequest("/api/dining/search")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/dining/offerings/offering-1/reviews")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/dining/offerings/offering-1/reviews/raw")).toBe(
			false,
		);
	});

	it("allows profile memory routes used by the student account surface", () => {
		expect(isAllowedCampusAppApiRequest("/api/me/profile-memory")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/me/profile-memory/items")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/me/profile-memory/settings")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/me/profile-memory/items/mem_01HQ")).toBe(true);
	});

	it("allows the public campus services transport schedule projection", () => {
		expect(isAllowedCampusAppApiRequest("/api/campus-services/transport-schedule/status")).toBe(
			true,
		);
	});

	it("allows only the bounded browser performance ingest route", () => {
		expect(isAllowedCampusAppApiRequest("/api/telemetry/web-performance")).toBe(true);
		expect(isAllowedCampusAppApiRequest("/api/telemetry/raw-performance")).toBe(false);
	});
});
