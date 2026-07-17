import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import { assertApplicationLogOnlyObservability } from "../../../scripts/deploy/worker-observability-config";
import { buildAppApiStagingUploadConfig } from "../scripts/staging-upload-config";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(appDir, "wrangler.toml"), "utf8");
const resources = {
	freshHyperdriveId: "22222222222222222222222222222222",
	hyperdriveId: "11111111111111111111111111111111",
	vpcServiceId: "33333333-3333-4333-8333-333333333333",
};

describe("app-api staging upload config", () => {
	it("injects Terraform-owned resource ids into an ephemeral config", () => {
		const generated = parse(buildAppApiStagingUploadConfig(source, appDir, resources)) as Record<
			string,
			unknown
		>;
		const staging = (generated.env as Record<string, Record<string, unknown>>).staging;
		expect(generated.main).toBe(resolve(appDir, "src/index.ts"));
		assertApplicationLogOnlyObservability(generated.observability, {
			destinations: [],
			surface: "app-api generated default",
		});
		assertApplicationLogOnlyObservability(staging.observability, {
			destinations: ["axiom-staging-logs"],
			surface: "app-api generated staging",
		});
		expect(staging.vpc_services).toEqual([
			expect.objectContaining({
				binding: "EXECUTION_CONTROL_PRIVATE",
				service_id: resources.vpcServiceId,
			}),
		]);
		expect(staging.hyperdrive).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					binding: "APP_API_DB",
					id: resources.hyperdriveId,
				}),
				expect.objectContaining({
					binding: "APP_API_DB_FRESH",
					id: resources.freshHyperdriveId,
				}),
			]),
		);
	});

	it("rejects native invocation logs or traces in an upload config", () => {
		const generated = parse(buildAppApiStagingUploadConfig(source, appDir, resources)) as Record<
			string,
			unknown
		>;
		const staging = (generated.env as Record<string, Record<string, unknown>>).staging;
		const observability = staging.observability as Record<string, Record<string, unknown>>;
		observability.logs.invocation_logs = true;

		expect(() =>
			assertApplicationLogOnlyObservability(observability, {
				destinations: ["axiom-staging-logs"],
				surface: "app-api generated staging",
			}),
		).toThrow("observability.logs.invocation_logs must be false");

		observability.logs.invocation_logs = false;
		observability.traces.enabled = true;
		expect(() =>
			assertApplicationLogOnlyObservability(observability, {
				destinations: ["axiom-staging-logs"],
				surface: "app-api generated staging",
			}),
		).toThrow("observability.traces.enabled must be false");
	});

	it("rejects an invalid Hyperdrive configuration id", () => {
		expect(() =>
			buildAppApiStagingUploadConfig(source, appDir, {
				...resources,
				freshHyperdriveId: "invalid",
			}),
		).toThrow(
			"STAGING_APP_API_DB_FRESH_HYPERDRIVE_ID must contain a 32-character lowercase hexadecimal Cloudflare Hyperdrive configuration ID.",
		);
	});

	it("rejects an invalid VPC service id", () => {
		expect(() =>
			buildAppApiStagingUploadConfig(source, appDir, {
				...resources,
				vpcServiceId: "invalid",
			}),
		).toThrow("STAGING_EXECUTION_CONTROL_VPC_SERVICE_ID must contain a Cloudflare resource UUID.");
	});
});
