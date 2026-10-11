import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import {
	buildAppApiStagingUploadConfig,
	buildAppApiStagingUploadSecrets,
} from "../scripts/staging-upload-config";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(resolve(appDir, "wrangler.toml"), "utf8");
const resources = {
	hyperdriveId: "11111111111111111111111111111111",
	objectStoreVpcServiceId: "44444444-4444-4444-8444-444444444444",
	vpcServiceId: "33333333-3333-4333-8333-333333333333",
	memoryServiceVpcServiceId: "55555555-5555-4555-8555-555555555555",
};

describe("app-api staging upload config", () => {
	it("injects Terraform-owned resource ids into an ephemeral config", () => {
		const generated = parse(buildAppApiStagingUploadConfig(source, appDir, resources)) as Record<
			string,
			unknown
		>;
		const staging = (generated.env as Record<string, Record<string, unknown>>).staging;
		if (!staging) {
			throw new Error("Generated Wrangler config must contain the staging environment.");
		}
		expect(generated.main).toBe(resolve(appDir, "src/index.ts"));
		expect(generated).not.toHaveProperty("assets");
		expect(generated).not.toHaveProperty("observability");
		expect(staging).not.toHaveProperty("observability");
		expect(staging.vpc_services).toEqual([
			expect.objectContaining({
				binding: "EXECUTION_CONTROL_PRIVATE",
				service_id: resources.vpcServiceId,
			}),
			expect.objectContaining({
				binding: "MEMORY_SERVICE_PRIVATE",
				service_id: resources.memoryServiceVpcServiceId,
			}),
			expect.objectContaining({
				binding: "OBJECT_STORE_PRIVATE",
				service_id: resources.objectStoreVpcServiceId,
			}),
		]);
		expect(staging.hyperdrive).toEqual([
			expect.objectContaining({
				binding: "APP_API_DB",
				id: resources.hyperdriveId,
			}),
		]);
		expect(staging.images).toEqual({ binding: "DINING_IMAGES" });
		expect(staging.secrets).toEqual({
			required: expect.arrayContaining([
				"OBJECT_STORE_DERIVED_ACCESS_KEY",
				"OBJECT_STORE_DERIVED_SECRET_KEY",
			]),
		});
		const local = (generated.env as Record<string, Record<string, unknown>>).local;
		expect(local?.images).toEqual({ binding: "DINING_IMAGES", remote: false });
	});

	it.each([undefined, false, true])(
		"renders maintenance %s into the Worker version",
		(executionMaintenance) => {
			const generated = parse(
				buildAppApiStagingUploadConfig(source, appDir, {
					...resources,
					...(executionMaintenance === undefined ? {} : { executionMaintenance }),
				}),
			);
			expect(generated).toHaveProperty(
				"env.staging.vars.EXECUTION_MAINTENANCE",
				String(executionMaintenance ?? false),
			);
		},
	);

	it("rejects an invalid Hyperdrive configuration id", () => {
		expect(() =>
			buildAppApiStagingUploadConfig(source, appDir, {
				...resources,
				hyperdriveId: "invalid",
			}),
		).toThrow(
			"APP_API_DB_HYPERDRIVE_ID must contain a 32-character lowercase hexadecimal Cloudflare Hyperdrive configuration ID.",
		);
	});

	it("rejects an invalid VPC service id", () => {
		expect(() =>
			buildAppApiStagingUploadConfig(source, appDir, {
				...resources,
				vpcServiceId: "invalid",
			}),
		).toThrow("EXECUTION_CONTROL_VPC_SERVICE_ID must contain a Cloudflare resource UUID.");
	});

	it("rejects an invalid object-store VPC service id", () => {
		expect(() =>
			buildAppApiStagingUploadConfig(source, appDir, {
				...resources,
				objectStoreVpcServiceId: "invalid",
			}),
		).toThrow("OBJECT_STORE_VPC_SERVICE_ID must contain a Cloudflare resource UUID.");
	});

	it("passes through only the Worker object-store identities in the upload secret file", () => {
		const environment = {
			APP_API_EXECUTION_SHARED_SECRET: "execution-test",
			MEMORY_INTERNAL_SHARED_SECRET: "memory-test",
			OBJECT_STORE_DERIVED_ACCESS_KEY: "derived-write-test",
			OBJECT_STORE_DERIVED_SECRET_KEY: "derived-write-secret-test",
			OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "derived-read-test",
			OBJECT_STORE_DERIVED_READ_SECRET_KEY: "derived-read-secret-test",
			OPS_WEB_INTERNAL_TOKEN: "ops-test",
		};
		expect(
			buildAppApiStagingUploadSecrets({
				...environment,
				OBJECT_STORE_SOURCE_ACCESS_KEY: "source-not-for-worker",
			}),
		).toEqual(environment);
		for (const name of ["OBJECT_STORE_DERIVED_ACCESS_KEY", "OBJECT_STORE_DERIVED_SECRET_KEY"]) {
			expect(() => buildAppApiStagingUploadSecrets({ ...environment, [name]: undefined })).toThrow(
				`${name} is required for staging Worker version upload.`,
			);
		}
	});
});
