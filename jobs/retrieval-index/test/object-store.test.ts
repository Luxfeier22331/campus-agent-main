import { describe, expect, it, vi } from "vitest";

const s3 = vi.hoisted(() => ({
	clients: [] as Array<{
		accessKeyId: string;
		commands: Array<{ bucket: unknown; key: unknown; name: string }>;
	}>,
	responses: [] as unknown[],
	errors: [] as unknown[],
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
			const error = s3.errors.shift();
			if (error) throw error;
			return (
				s3.responses.shift() ?? {
					Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
				}
			);
		}
	}
	return { ...actual, S3Client: MockS3Client };
});

import {
	createS3ReaderStore,
	createS3WriterStore,
	type ObjectStoreEnv,
} from "../src/object-store.ts";

const environment: ObjectStoreEnv = {
	OBJECT_STORE_BUCKET_DERIVED: "campus-agent-derived-wt-1-test",
	OBJECT_STORE_DERIVED_ACCESS_KEY: "derived-write-access",
	OBJECT_STORE_DERIVED_SECRET_KEY: "derived-write-secret",
	OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "derived-read-access",
	OBJECT_STORE_DERIVED_READ_SECRET_KEY: "derived-read-secret",
	OBJECT_STORE_ENDPOINT: "http://object-store.test",
};

describe("Campus RAG object store", () => {
	it("reads from the configured bucket", async () => {
		s3.clients.length = 0;
		s3.responses.length = 0;
		s3.errors.length = 0;
		const store = createS3ReaderStore(environment);
		await store.read("campus-docs/rag/test.json");
		expect(s3.clients[0]?.commands[0]).toEqual({
			bucket: environment.OBJECT_STORE_BUCKET_DERIVED,
			key: "campus-docs/rag/test.json",
			name: "GetObjectCommand",
		});
	});

	it("keeps the production bucket default when no bucket is configured", async () => {
		s3.clients.length = 0;
		const input = { ...environment };
		delete input.OBJECT_STORE_BUCKET_DERIVED;
		await createS3ReaderStore(input).read("notices/rag/test.json");
		expect(s3.clients[0]?.commands[0]?.bucket).toBe("campus-agent-derived");
	});

	it("writes immutable objects with the configured local writer identity", async () => {
		s3.clients.length = 0;
		s3.responses.length = 0;
		s3.errors.length = 0;
		const store = createS3WriterStore(environment);
		await expect(
			store.writeImmutable("notices/rag/test.ndjson", new Uint8Array([1, 2])),
		).resolves.toBe("created");
		expect(s3.clients[0]).toMatchObject({ accessKeyId: "derived-write-access" });
		expect(s3.clients[0]?.commands[0]).toEqual({
			bucket: environment.OBJECT_STORE_BUCKET_DERIVED,
			key: "notices/rag/test.ndjson",
			name: "PutObjectCommand",
		});
	});
});
