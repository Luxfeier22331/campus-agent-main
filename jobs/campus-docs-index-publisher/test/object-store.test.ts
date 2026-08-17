import { describe, expect, it, vi } from "vitest";

const s3 = vi.hoisted(() => ({
	clients: [] as Array<{
		accessKeyId: string;
		commands: Array<{ bucket: unknown; key: unknown; name: string }>;
	}>,
}));

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
	class MockS3Client {
		readonly record: (typeof s3.clients)[number];

		constructor(config: { credentials: { accessKeyId: string } }) {
			this.record = { accessKeyId: config.credentials.accessKeyId, commands: [] };
			s3.clients.push(this.record);
		}

		async send(command: {
			input: { Bucket?: unknown; Key?: unknown };
			constructor: { name: string };
		}) {
			this.record.commands.push({
				bucket: command.input.Bucket,
				key: command.input.Key,
				name: command.constructor.name,
			});
			return {
				Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
			};
		}
	}

	return { ...actual, S3Client: MockS3Client };
});

import { createS3ReaderStore, type ObjectStoreReaderEnv } from "../src/object-store.ts";

const environment: ObjectStoreReaderEnv = {
	CAMPUS_DOCS_OBJECT_STORE_BUCKET: "campus-agent-derived",
	OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "derived-read-access",
	OBJECT_STORE_DERIVED_READ_SECRET_KEY: "derived-read-secret",
	OBJECT_STORE_ENDPOINT: "http://object-store.test",
};

describe("Campus docs reader object store", () => {
	it.each([
		"OBJECT_STORE_DERIVED_READ_ACCESS_KEY",
		"OBJECT_STORE_DERIVED_READ_SECRET_KEY",
		"OBJECT_STORE_ENDPOINT",
	] as const)("requires %s", (key) => {
		const input = { ...environment };
		delete input[key];
		expect(() => createS3ReaderStore(input)).toThrow(`${key} is required`);
	});

	it("reads with the existing derived read-only identity and exposes no writer", async () => {
		s3.clients.length = 0;
		const store = createS3ReaderStore(environment);

		await expect(store.read("campus-docs/source.json")).resolves.toEqual(
			new Uint8Array([1, 2, 3]),
		);

		expect("writeImmutable" in store).toBe(false);
		expect(s3.clients).toEqual([
			{
				accessKeyId: "derived-read-access",
				commands: [
					{
						bucket: "campus-agent-derived",
						key: "campus-docs/source.json",
						name: "GetObjectCommand",
					},
				],
			},
		]);
	});
});
