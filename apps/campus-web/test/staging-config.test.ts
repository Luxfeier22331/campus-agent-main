import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import wranglerConfig from "../wrangler.toml?raw";

const parsedWranglerConfig = parse(wranglerConfig) as {
	env?: {
		staging?: {
			observability?: unknown;
			routes?: unknown;
			secrets?: unknown;
			services?: Array<{ binding?: string; service?: string }>;
			vars?: Record<string, string>;
		};
	};
	observability?: unknown;
	preview_urls?: boolean;
	upload_source_maps?: boolean;
	workers_dev?: boolean;
};

describe("campus web staging config", () => {
	it("leaves Worker observability ownership to GitOps", () => {
		expect(parsedWranglerConfig.observability).toBeUndefined();
		expect(parsedWranglerConfig.env?.staging).not.toHaveProperty("observability");
	});

	it("keeps traffic ownership out of Wrangler and declares the staging service contract", () => {
		const staging = parsedWranglerConfig.env?.staging;
		expect(staging).toBeDefined();
		expect(parsedWranglerConfig.workers_dev).toBe(false);
		expect(parsedWranglerConfig.preview_urls).toBe(false);
		expect(parsedWranglerConfig.upload_source_maps).toBe(true);
		expect(staging).not.toHaveProperty("routes");
		expect(staging).not.toHaveProperty("secrets");
		expect(staging?.vars).toEqual({
			APP_API_BASE_URL: "https://app-api.internal",
			DEPLOYMENT_ENVIRONMENT: "staging",
		});
		expect(staging?.services).toEqual([
			expect.objectContaining({ binding: "APP_API", service: "app-api-staging" }),
		]);
	});
});
