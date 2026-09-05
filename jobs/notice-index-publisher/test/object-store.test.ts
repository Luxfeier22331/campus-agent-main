import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { sha256 } from "../src/encoding.ts";
import { describe, expect, it, vi } from "vitest";

const s3 = vi.hoisted(() => ({
	clients: [] as Array<{
		accessKeyId: string;
		commands: Array<Record<string, unknown>>;
	}>,
	responses: [] as unknown[],
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
			input: Record<string, unknown>;
			constructor: { name: string };
		}) {
			const entry: Record<string, unknown> = {
				bucket: command.input.Bucket,
				key: command.input.Key,
				name: command.constructor.name,
			};
			if (command.input.Prefix !== undefined) entry.prefix = command.input.Prefix;
			if (command.input.ContinuationToken !== undefined) {
				entry.continuationToken = command.input.ContinuationToken;
			}
			if (command.input.ContentLength !== undefined) {
				entry.contentLength = command.input.ContentLength;
				if (command.input.Body !== undefined) entry.body = command.input.Body;
			}
			this.record.commands.push(entry);
			if (command.constructor.name === "ListObjectsV2Command") {
				return s3.responses.shift() ?? {};
			}
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
		s3.responses.length = 0;
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

	it("lists cache objects across paginated responses", async () => {
		s3.clients.length = 0;
		s3.responses = [
			{
				Contents: [{ Key: "notices/rag/embedding-cache/a/sha256/one.json" }],
				IsTruncated: true,
				NextContinuationToken: "next-page",
			},
			{
				Contents: [{ Key: "notices/rag/embedding-cache/a/sha256/two.json" }],
				IsTruncated: false,
			},
		];
		const store = createNoticeS3ArtifactStore(environment);

		expect(await store.list("notices/rag/embedding-cache/a/sha256")).toEqual([
			"notices/rag/embedding-cache/a/sha256/one.json",
			"notices/rag/embedding-cache/a/sha256/two.json",
		]);
		expect(s3.clients[0]?.commands).toEqual([
			{
				bucket: "campus-agent-derived",
				key: undefined,
				name: "ListObjectsV2Command",
				prefix: "notices/rag/embedding-cache/a/sha256",
			},
			{
				bucket: "campus-agent-derived",
				continuationToken: "next-page",
				key: undefined,
				name: "ListObjectsV2Command",
				prefix: "notices/rag/embedding-cache/a/sha256",
			},
		]);
	});

	it("uploads a file stream with an explicit content length", async () => {
		s3.clients.length = 0;
		s3.responses.length = 0;
		const root = await mkdtemp(join(tmpdir(), "notice-object-store-"));
		try {
			const path = join(root, "embeddings.ndjson");
			const body = new TextEncoder().encode("{}\n");
			await writeFile(path, body);
			const store = createNoticeS3ArtifactStore(environment);

			await store.writeImmutableFile("notices/rag/embeddings.ndjson", {
				byteSize: body.byteLength,
				path,
				sha256: sha256(body),
			});

			expect(s3.clients[0]?.commands[0]).toMatchObject({
				contentLength: body.byteLength,
				name: "PutObjectCommand",
			});
			expect(s3.clients[0]?.commands[0]?.body).toEqual(expect.anything());
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});
