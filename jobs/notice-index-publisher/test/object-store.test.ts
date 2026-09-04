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
			if (command.constructor.name === "GetObjectCommand") {
				return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
			}
			return {};
		}
	}

	return { ...actual, S3Client: MockS3Client };
});

import {
	createNoticeS3ArtifactStore,
	type NoticeObjectStoreEnv,
} from "../src/object-store.ts";

const environment: NoticeObjectStoreEnv = {
	OBJECT_STORE_DERIVED_ACCESS_KEY: "derived-access",
	OBJECT_STORE_DERIVED_SECRET_KEY: "derived-secret",
	OBJECT_STORE_ENDPOINT: "http://object-store.test",
};

describe("notice object store", () => {
	it.each([
		"OBJECT_STORE_DERIVED_ACCESS_KEY",
		"OBJECT_STORE_DERIVED_SECRET_KEY",
		"OBJECT_STORE_ENDPOINT",
	] as const)("requires %s", (key) => {
		const input = { ...environment };
		delete input[key];
		expect(() => createNoticeS3ArtifactStore(input)).toThrow(`${key} is required`);
	});

	it("uses the existing derived writer identity", async () => {
		s3.clients.length = 0;
		const store = createNoticeS3ArtifactStore(environment);

		await store.writeImmutable("notices/rag/test.json", new Uint8Array([1, 2, 3]));
		await store.read("notices/rag/test.json");

		expect(s3.clients).toEqual([
			{
				accessKeyId: "derived-access",
				commands: [
					{
						bucket: "campus-agent-derived",
						key: "notices/rag/test.json",
						name: "PutObjectCommand",
					},
					{
						bucket: "campus-agent-derived",
						key: "notices/rag/test.json",
						name: "GetObjectCommand",
					},
				],
			},
		]);
	});
});
