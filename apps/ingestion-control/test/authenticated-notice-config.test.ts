import { describe, expect, it } from "vitest";
import { loadAuthenticatedNoticeFamilyConfigFromRegistryRoot } from "../src/authenticated-notice-config.ts";

describe("authenticated notice runtime config", () => {
	it("loads the notice-family routing config from the ingestion registry root", () => {
		const config = loadAuthenticatedNoticeFamilyConfigFromRegistryRoot(
			new URL("../../../configs/ingestion", import.meta.url).pathname,
		);

		expect(config).toMatchObject({
			collection: "internal_notice",
			corpus: "campus_notices",
			defaultFamily: "other",
			sourceChannel: "internal_portal",
		});
		expect(config.routingPolicy.familyPolicies.transport_commute_status).toMatchObject({
			consumptionRoute: "service_status_candidate",
		});
	});

	it("fails closed when the registry root is missing", () => {
		expect(() => loadAuthenticatedNoticeFamilyConfigFromRegistryRoot("")).toThrow(
			"INGESTION_TASK_REGISTRY_ROOT is required for authenticated notice config",
		);
	});
});
