import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import { buildAppApiStagingUploadConfig } from "../scripts/staging-upload-config";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(appDir, "wrangler.toml"), "utf8");

describe("app-api staging upload config", () => {
	it("injects Terraform-owned resource ids into an ephemeral config", () => {
		const generated = parse(
			buildAppApiStagingUploadConfig(source, appDir, {
				freshHyperdriveId: "22222222-2222-4222-8222-222222222222",
				hyperdriveId: "11111111-1111-4111-8111-111111111111",
				vpcServiceId: "33333333-3333-4333-8333-333333333333",
			}),
		) as Record<string, unknown>;
		const staging = (generated.env as Record<string, Record<string, unknown>>).staging;
		expect(generated.main).toBe(resolve(appDir, "src/index.ts"));
		expect(staging.vpc_services).toEqual([
			expect.objectContaining({
				binding: "EXECUTION_CONTROL_PRIVATE",
				service_id: "33333333-3333-4333-8333-333333333333",
			}),
		]);
		expect(staging.hyperdrive).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					binding: "APP_API_DB",
					id: "11111111-1111-4111-8111-111111111111",
				}),
				expect.objectContaining({
					binding: "APP_API_DB_FRESH",
					id: "22222222-2222-4222-8222-222222222222",
				}),
			]),
		);
	});

	it("rejects invalid Cloudflare resource ids", () => {
		expect(() =>
			buildAppApiStagingUploadConfig(source, appDir, {
				freshHyperdriveId: "invalid",
				hyperdriveId: "11111111-1111-4111-8111-111111111111",
				vpcServiceId: "33333333-3333-4333-8333-333333333333",
			}),
		).toThrow("STAGING_APP_API_DB_FRESH_HYPERDRIVE_ID");
	});
});
