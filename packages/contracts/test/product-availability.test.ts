import { describe, expect, it } from "vitest";
import {
	ChatAvailabilityResponseSchema,
	PRODUCT_AVAILABILITY_SCHEMA_VERSION,
	ProductAvailabilitySnapshotSchema,
} from "../src/product-availability";

const VALID_SERVICES = [
	{
		checkedAt: "2026-08-07T00:05:00Z",
		id: "campus.qa",
		name: "校园问答",
		status: "operational",
		timeline: [{ day: "2026-08-07", status: "operational" }],
	},
	{
		checkedAt: "2026-08-07T00:05:00Z",
		id: "campus.services",
		name: "其他服务",
		status: "degraded",
		timeline: [{ day: "2026-08-07", status: "degraded" }],
	},
] as const;

const VALID_SNAPSHOT = {
	environment: "staging",
	expiresAt: "2026-08-07T00:15:00Z",
	generatedAt: "2026-08-07T00:05:00Z",
	schemaVersion: PRODUCT_AVAILABILITY_SCHEMA_VERSION,
	services: VALID_SERVICES,
} as const;

describe("product availability contract", () => {
	it.each(["operational", "outage", "unknown"])(
		"accepts the public chat availability status %s",
		(status) => {
			expect(ChatAvailabilityResponseSchema.safeParse({ status }).success).toBe(true);
		},
	);

	it.each([{}, { status: "degraded" }, { status: "operational", requestId: "req_01HQ" }])(
		"rejects an invalid public chat availability response %#",
		(response) => {
			expect(ChatAvailabilityResponseSchema.safeParse(response).success).toBe(false);
		},
	);

	it("parses the exact ordered public service set", () => {
		expect(ProductAvailabilitySnapshotSchema.safeParse(VALID_SNAPSHOT).success).toBe(true);
	});

	it.each([
		["an empty service set", []],
		["a missing service", [VALID_SERVICES[0]]],
		["reversed services", [VALID_SERVICES[1], VALID_SERVICES[0]]],
		["a duplicate service", [VALID_SERVICES[0], VALID_SERVICES[0]]],
		[
			"an extra service ID",
			[VALID_SERVICES[0], { ...VALID_SERVICES[1], id: "school.portal", name: "校级门户" }],
		],
		[
			"an extra service row",
			[...VALID_SERVICES, { ...VALID_SERVICES[1], id: "school.portal", name: "校级门户" }],
		],
		["a changed service name", [{ ...VALID_SERVICES[0], name: "问答服务" }, VALID_SERVICES[1]]],
		["an unsupported status", [{ ...VALID_SERVICES[0], status: "maintenance" }, VALID_SERVICES[1]]],
	])("rejects %s", (_case, services) => {
		expect(
			ProductAvailabilitySnapshotSchema.safeParse({ ...VALID_SNAPSHOT, services }).success,
		).toBe(false);
	});

	it("rejects a missing services field and unknown fields", () => {
		const { services: _services, ...withoutServices } = VALID_SNAPSHOT;
		expect(ProductAvailabilitySnapshotSchema.safeParse(withoutServices).success).toBe(false);
		expect(
			ProductAvailabilitySnapshotSchema.safeParse({ ...VALID_SNAPSHOT, incident: null }).success,
		).toBe(false);
	});
});
