import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const s3 = vi.hoisted(() => ({
	clients: [] as Array<{
		accessKeyId: string;
		commands: Array<{ input: Record<string, unknown>; name: string }>;
		destroyed: boolean;
	}>,
	derivedPutFailures: [] as unknown[],
}));

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
	class MockS3Client {
		readonly record: (typeof s3.clients)[number];

		constructor(config: { credentials: { accessKeyId: string } }) {
			this.record = {
				accessKeyId: config.credentials.accessKeyId,
				commands: [],
				destroyed: false,
			};
			s3.clients.push(this.record);
		}

		async send(command: {
			input: Record<string, unknown>;
			constructor: { name: string };
		}) {
			this.record.commands.push({ input: command.input, name: command.constructor.name });
			if (command instanceof actual.GetObjectCommand) {
				if (String(command.input.Key).endsWith("/attachments/0")) {
					throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
				}
				if (String(command.input.Key).endsWith("/attachments/1")) {
					throw Object.assign(new Error("forbidden"), {
						$metadata: { httpStatusCode: 403 },
						name: "AccessDenied",
					});
				}
				return {
					Body: {
						transformToByteArray: async () =>
							command.input.Bucket === "campus-agent-derived"
								? new Uint8Array([4, 5, 6])
								: new Uint8Array([1, 2, 3]),
					},
					ContentType: "application/json",
				};
			}
			if (command instanceof actual.ListObjectsV2Command) {
				return {
					Contents: [
						{
							Key:
								command.input.Bucket === "campus-agent-derived"
									? "notices/assets/sha256/missing"
									: "internal_portal/meta.json",
						},
					],
					IsTruncated: false,
				};
			}
			if (
				command instanceof actual.PutObjectCommand &&
				command.input.Bucket === "campus-agent-derived"
			) {
				const failure = s3.derivedPutFailures.shift();
				if (failure) {
					throw failure;
				}
				return {};
			}
			return {};
		}

		destroy() {
			this.record.destroyed = true;
		}
	}

	return { ...actual, S3Client: MockS3Client };
});

import { createPublisherObjectStoreFromEnv } from "../src/store";

const environment: NodeJS.ProcessEnv = {
	OBJECT_STORE_BUCKET_DERIVED: "campus-agent-derived",
	OBJECT_STORE_BUCKET_SOURCE: "campus-agent-source",
	OBJECT_STORE_DERIVED_ACCESS_KEY: "derived-access",
	OBJECT_STORE_DERIVED_SECRET_KEY: "derived-secret",
	OBJECT_STORE_ENDPOINT: "http://object-store.test",
	OBJECT_STORE_SOURCE_ACCESS_KEY: "source-access",
	OBJECT_STORE_SOURCE_SECRET_KEY: "source-secret",
};

describe("publisher object store identities", () => {
	it.each([
		"OBJECT_STORE_SOURCE_ACCESS_KEY",
		"OBJECT_STORE_SOURCE_SECRET_KEY",
		"OBJECT_STORE_DERIVED_ACCESS_KEY",
		"OBJECT_STORE_DERIVED_SECRET_KEY",
	])("requires %s", (key) => {
		const input = { ...environment };
		delete input[key];
		expect(() => createPublisherObjectStoreFromEnv(input)).toThrow(`${key} is required`);
	});

		it("routes source reads and derived writes through their own clients", async () => {
		s3.clients.length = 0;
		const store = createPublisherObjectStoreFromEnv(environment);
		const body = new Uint8Array([1, 2, 3]);
		const digest = createHash("sha256").update(body).digest("hex");

		await expect(store.getSource("internal_portal/meta.json")).resolves.toEqual({
			body,
			contentType: "application/json",
		});
		await expect(
			store.getSourceIfExists("internal_portal/notices/358159/attachments/0"),
		).resolves.toBeNull();
		await expect(
			store.getSourceIfExists("internal_portal/notices/358159/attachments/1"),
		).rejects.toThrow("forbidden");
		await store.createDerivedAsset({ body, contentType: "image/png", digest });
		store.close();

		const source = s3.clients.find((client) => client.accessKeyId === "source-access");
		const derived = s3.clients.find((client) => client.accessKeyId === "derived-access");
		expect(source?.commands.map((command) => command.name)).toEqual([
			"GetObjectCommand",
			"GetObjectCommand",
			"GetObjectCommand",
		]);
		expect(derived?.commands.map((command) => command.name)).toEqual(["PutObjectCommand"]);
		expect(derived?.commands[0]?.input.Key).toBe(`notices/assets/sha256/${digest}`);
		expect(
			source?.commands.every((command) => command.input.Bucket === "campus-agent-source"),
		).toBe(true);
		expect(
			derived?.commands.every((command) => command.input.Bucket === "campus-agent-derived"),
		).toBe(true);
		expect(source?.destroyed).toBe(true);
		expect(derived?.destroyed).toBe(true);
	});
});

describe("derived asset writes", () => {
	const body = new Uint8Array([1, 2, 3]);
	const digest = createHash("sha256").update(body).digest("hex");

	beforeEach(() => {
		s3.clients.length = 0;
		s3.derivedPutFailures.length = 0;
	});

	it("accepts an existing content-addressed asset without reading it back", async () => {
		s3.derivedPutFailures.push(preconditionFailure());
		const store = createPublisherObjectStoreFromEnv(environment);

		await expect(
			store.createDerivedAsset({ body, contentType: "image/png", digest }),
		).resolves.toBeUndefined();
		store.close();

		const derived = s3.clients.find((client) => client.accessKeyId === "derived-access");
		expect(derived?.commands.map((command) => command.name)).toEqual(["PutObjectCommand"]);
	});

	it("propagates put failures that are not precondition failures", async () => {
		s3.derivedPutFailures.push(
			Object.assign(new Error("store unavailable"), {
				$metadata: { httpStatusCode: 503 },
				name: "ServiceUnavailable",
			}),
		);
		const store = createPublisherObjectStoreFromEnv(environment);

		await expect(
			store.createDerivedAsset({ body, contentType: "image/png", digest }),
		).rejects.toThrow("store unavailable");
		store.close();
	});
});

function preconditionFailure() {
	return Object.assign(new Error("condition failed"), {
		$metadata: { httpStatusCode: 412 },
		name: "PreconditionFailed",
	});
}
