import { describe, expect, it, vi } from "vitest";

const s3 = vi.hoisted(() => ({
	clients: [] as Array<{
		accessKeyId: string;
		commands: Array<{ input: Record<string, unknown>; name: string }>;
		destroyed: boolean;
		endpoint: string | undefined;
		forcePathStyle: boolean | undefined;
		region: string | undefined;
	}>,
}));

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
	class MockS3Client {
		readonly record: (typeof s3.clients)[number];

		constructor(config: {
			credentials: { accessKeyId: string };
			endpoint?: string;
			forcePathStyle?: boolean;
			region?: string;
		}) {
			this.record = {
				accessKeyId: config.credentials.accessKeyId,
				commands: [],
				destroyed: false,
				endpoint: config.endpoint,
				forcePathStyle: config.forcePathStyle,
				region: config.region,
			};
			s3.clients.push(this.record);
		}

		async send(command: {
			input: Record<string, unknown>;
			constructor: { name: string };
		}) {
			this.record.commands.push({ input: command.input, name: command.constructor.name });
			if (command instanceof actual.GetObjectCommand) {
				if (command.input.Bucket === "derived-bucket") {
					throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
				}
				return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
			}
			if (command instanceof actual.ListObjectsV2Command) {
				return command.input.ContinuationToken === undefined
					? {
						Contents: [{ Key: "internal_portal/notices/1.json" }],
						IsTruncated: true,
						NextContinuationToken: "page-2",
					}
					: {
						Contents: [{ Key: "internal_portal/notices/2.json" }],
						IsTruncated: false,
					};
			}
			return {};
		}

		destroy() {
			this.record.destroyed = true;
		}
	}

	return { ...actual, S3Client: MockS3Client };
});

import { createNoticeClassifierObjectStoreFromEnv } from "../src/object-store.ts";

const environment: NodeJS.ProcessEnv = {
	OBJECT_STORE_BUCKET_DERIVED: "derived-bucket",
	OBJECT_STORE_BUCKET_SOURCE: "source-bucket",
	OBJECT_STORE_DERIVED_ACCESS_KEY: "derived-access",
	OBJECT_STORE_DERIVED_SECRET_KEY: "derived-secret",
	OBJECT_STORE_ENDPOINT: "http://object-store.test",
	OBJECT_STORE_REGION: "local-region",
	OBJECT_STORE_SOURCE_ACCESS_KEY: "source-access",
	OBJECT_STORE_SOURCE_SECRET_KEY: "source-secret",
};

describe("notice classifier object store", () => {
	it.each([
		"OBJECT_STORE_ENDPOINT",
		"OBJECT_STORE_BUCKET_DERIVED",
		"OBJECT_STORE_SOURCE_ACCESS_KEY",
		"OBJECT_STORE_SOURCE_SECRET_KEY",
		"OBJECT_STORE_DERIVED_ACCESS_KEY",
		"OBJECT_STORE_DERIVED_SECRET_KEY",
	])("requires %s", (key) => {
		s3.clients.length = 0;
		const input = { ...environment };
		delete input[key];
		expect(() => createNoticeClassifierObjectStoreFromEnv(input)).toThrow(`${key} is required`);
	});

	it("uses isolated source and derived clients with paginated reads", async () => {
		s3.clients.length = 0;
		const store = createNoticeClassifierObjectStoreFromEnv(environment);

		await expect(store.getSource("internal_portal/notices/1.json")).resolves.toEqual(
			new Uint8Array([1, 2, 3]),
		);
		await expect(store.listSource("internal_portal/notices/")).resolves.toEqual([
			"internal_portal/notices/1.json",
			"internal_portal/notices/2.json",
		]);
		await expect(store.getDerived("notices/classifications/1.json")).resolves.toBeNull();
		await store.putDerived(
			"notices/classifications/1.json",
			new TextEncoder().encode("{}"),
		);
		store.close();

		const source = s3.clients.find((client) => client.accessKeyId === "source-access");
		const derived = s3.clients.find((client) => client.accessKeyId === "derived-access");
		expect(source?.endpoint).toBe("http://object-store.test");
		expect(source?.forcePathStyle).toBe(true);
		expect(source?.region).toBe("local-region");
		expect(derived?.commands.map((command) => command.name)).toEqual([
			"GetObjectCommand",
			"PutObjectCommand",
		]);
		expect(source?.commands.map((command) => command.name)).toEqual([
			"GetObjectCommand",
			"ListObjectsV2Command",
			"ListObjectsV2Command",
		]);
		expect(
		source?.commands.every((command) => command.input.Bucket === "source-bucket"),
		).toBe(true);
		expect(
		derived?.commands.every((command) => command.input.Bucket === "derived-bucket"),
		).toBe(true);
		expect(derived?.commands.at(-1)?.input.ContentType).toBe("application/json");
		expect(source?.destroyed).toBe(true);
		expect(derived?.destroyed).toBe(true);
	});
});
