import { describe, expect, it } from "vitest";
import {
	parseS3Uri,
	sha256Hex,
	writeCanonicalJsonArtifact,
	writeCanonicalJsonLinesArtifact,
} from "../src/index.ts";

describe("canonical artifact writers", () => {
	it("writes canonical JSON artifacts and returns object-store refs", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");

		const ref = await writeCanonicalJsonArtifact({
			bucket: "campus-agent-source",
			key: "runs/source-truth/manifest.json",
			objectStore,
			value: { b: 2, a: 1 },
		});

		expect(ref).toEqual({
			kind: "object_store",
			uri: "s3://campus-agent-source/runs/source-truth/manifest.json",
			digest: `sha256:${sha256Hex(new TextEncoder().encode('{"a":1,"b":2}'))}`,
		});
		expect(objectStore.textFor("runs/source-truth/manifest.json")).toBe('{"a":1,"b":2}');
		expect(objectStore.contentTypeFor("runs/source-truth/manifest.json")).toBe("application/json");
		expect(parseS3Uri(ref)).toEqual({
			bucket: "campus-agent-source",
			key: "runs/source-truth/manifest.json",
		});
	});

	it("writes canonical JSON lines artifacts and fails on checksum mismatch", async () => {
		const objectStore = new InMemoryObjectStore("campus-agent-source");

		const ref = await writeCanonicalJsonLinesArtifact({
			bucket: "campus-agent-source",
			key: "runs/source-truth/content-blocks.jsonl",
			objectStore,
			rows: [{ b: 2, a: 1 }, { value: "x" }],
		});

		expect(objectStore.textFor("runs/source-truth/content-blocks.jsonl")).toBe(
			'{"a":1,"b":2}\n{"value":"x"}\n',
		);
		expect(objectStore.contentTypeFor("runs/source-truth/content-blocks.jsonl")).toBe(
			"application/x-ndjson",
		);
		expect(ref.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);

		objectStore.forceBadSha256 = true;
		await expect(
			writeCanonicalJsonArtifact({
				bucket: "campus-agent-source",
				key: "runs/source-truth/bad.json",
				objectStore,
				value: { ok: true },
			}),
		).rejects.toThrow("artifact writer checksum mismatch");
	});
});

class InMemoryObjectStore {
	readonly bucket: string;
	readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
	forceBadSha256 = false;

	constructor(bucket: string) {
		this.bucket = bucket;
	}

	async getObject(input: { bucket: string; key: string }): Promise<Uint8Array> {
		if (input.bucket !== this.bucket) {
			throw new Error(`unexpected bucket: ${input.bucket}`);
		}
		const object = this.objects.get(input.key);
		if (!object) {
			throw new Error(`missing object: ${input.key}`);
		}
		return object.body;
	}

	async putObject(input: {
		bucket: string;
		key: string;
		body: Uint8Array;
		contentType: string;
	}): Promise<{ byteSize: number; contentSha256: string }> {
		if (input.bucket !== this.bucket) {
			throw new Error(`unexpected bucket: ${input.bucket}`);
		}
		this.objects.set(input.key, {
			body: input.body,
			contentType: input.contentType,
		});
		return {
			byteSize: input.body.byteLength,
			contentSha256: this.forceBadSha256 ? "0".repeat(64) : sha256Hex(input.body),
		};
	}

	textFor(key: string): string {
		const object = this.objects.get(key);
		if (!object) {
			throw new Error(`missing object: ${key}`);
		}
		return new TextDecoder().decode(object.body);
	}

	contentTypeFor(key: string): string {
		const object = this.objects.get(key);
		if (!object) {
			throw new Error(`missing object: ${key}`);
		}
		return object.contentType;
	}
}
