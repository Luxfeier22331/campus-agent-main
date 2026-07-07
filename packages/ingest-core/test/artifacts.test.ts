import { describe, expect, it } from "vitest";
import {
	assertObjectStoreSha256Digest,
	assertOptionalSha256Digest,
	assertSha256Digest,
	buildDocumentArtifactKey,
	buildObjectStoreArtifactRef,
	buildS3Uri,
	canonicalJsonSha256Digest,
	canonicalJsonSha256Hex,
	canonicalJsonString,
	encodeCanonicalJson,
	encodeJsonLines,
	parseJsonArrayBytes,
	parseJsonObjectBytes,
	parseJsonObjectLinesBytes,
	parseRequiredScalarText,
	parseRequiredText,
	parseS3Uri,
	parseSourceObjectRef,
	sha256Digest,
	sha256Hex,
} from "../src/index.ts";

describe("ingest artifact helpers", () => {
	it("builds stable sha256 values and encoded JSON payloads", () => {
		const bytes = new TextEncoder().encode("campus-agent");

		expect(sha256Hex(bytes)).toMatch(/^[0-9a-f]{64}$/u);
		expect(sha256Digest(bytes)).toBe(`sha256:${sha256Hex(bytes)}`);
		expect(encodeCanonicalJson({ b: 2, a: 1 })).toEqual(new TextEncoder().encode('{"a":1,"b":2}'));
		expect(encodeJsonLines([{ b: 2, a: 1 }, { value: "x" }])).toEqual(
			new TextEncoder().encode('{"a":1,"b":2}\n{"value":"x"}\n'),
		);
	});

	it("canonicalizes JSON through RFC 8785 JCS helpers", () => {
		expect(canonicalJsonString({ b: 2, a: { d: -0, c: [3, { y: 1, x: 2 }] } })).toBe(
			'{"a":{"c":[3,{"x":2,"y":1}],"d":0},"b":2}',
		);
		expect(encodeCanonicalJson({ b: 2, a: 1 })).toEqual(new TextEncoder().encode('{"a":1,"b":2}'));
		expect(canonicalJsonSha256Hex({ b: 2, a: 1 })).toMatch(/^[0-9a-f]{64}$/u);
		expect(canonicalJsonSha256Digest({ b: 2, a: 1 })).toBe(
			`sha256:${canonicalJsonSha256Hex({ a: 1, b: 2 })}`,
		);
		expect(() => canonicalJsonString(undefined)).toThrow(
			"canonical JSON value is not serializable",
		);
	});

	it("parses JSON bytes and source object refs with Zod-backed boundary helpers", () => {
		expect(parseJsonObjectBytes(new TextEncoder().encode('{"b":2,"a":1}'), "payload")).toEqual({
			a: 1,
			b: 2,
		});
		expect(parseJsonArrayBytes(new TextEncoder().encode('[{"a":1}]'), "rows")).toEqual([{ a: 1 }]);
		expect(
			parseJsonObjectLinesBytes(new TextEncoder().encode('{"a":1}\n{"b":2}\n'), "rows"),
		).toEqual([{ a: 1 }, { b: 2 }]);
		expect(parseSourceObjectRef({ bucket: "source", key: "path/file.json" }, "bundle_ref")).toEqual(
			{
				bucket: "source",
				byteSize: null,
				contentSha256: null,
				key: "path/file.json",
			},
		);
		expect(
			parseSourceObjectRef(
				{
					bucket: "source",
					key: "path/file.json",
					content_sha256: `sha256:${"0".repeat(64)}`,
					byte_size: 10,
				},
				"bundle_ref",
			),
		).toEqual({
			bucket: "source",
			byteSize: 10,
			contentSha256: "0".repeat(64),
			key: "path/file.json",
		});
		expect(() => parseSourceObjectRef({ bucket: "source", key: "../bad" }, "bundle_ref")).toThrow(
			"bundle_ref.key",
		);
		expect(() =>
			parseSourceObjectRef(
				{ bucket: "source", key: "path/file.json", byte_size: -1 },
				"bundle_ref",
			),
		).toThrow("bundle_ref.byte_size");
		expect(() => parseJsonObjectLinesBytes(new TextEncoder().encode("[1]\n"), "rows")).toThrow(
			"rows line 1 must be a JSON object",
		);
	});

	it("keeps string text parsing strict and uses scalar parsing only for explicit identifiers", () => {
		expect(parseRequiredText("  title  ", "title")).toBe("title");
		expect(() => parseRequiredText(355119, "title")).toThrow("title is required");
		expect(parseRequiredScalarText(355119, "notice_id")).toBe("355119");
	});

	it("parses and builds object-store artifact refs", () => {
		const uri = buildS3Uri({
			bucket: "campus-agent-source",
			key: "official_web/run/source-truth-bundle.json",
		});
		const artifactRef = buildObjectStoreArtifactRef({
			bucket: "campus-agent-source",
			key: "official_web/run/source-truth-bundle.json",
			contentSha256: "0".repeat(64),
		});

		expect(uri).toBe("s3://campus-agent-source/official_web/run/source-truth-bundle.json");
		expect(artifactRef).toEqual({
			kind: "object_store",
			uri,
			digest: `sha256:${"0".repeat(64)}`,
		});
		expect(parseS3Uri(artifactRef)).toEqual({
			bucket: "campus-agent-source",
			key: "official_web/run/source-truth-bundle.json",
		});
		expect(parseS3Uri(uri)).toEqual({
			bucket: "campus-agent-source",
			key: "official_web/run/source-truth-bundle.json",
		});
	});

	it("builds document artifact keys under the shared title and document id prefix", () => {
		expect(
			buildDocumentArtifactKey({
				collection: "curriculum_plan",
				corpus: "curriculum",
				documentId: "curriculum:law-ethnic-class-program",
				filename: "reader-assets/reader.json",
				revisionTrack: "current-effective",
				title: "法学（民族班）培养方案",
				versionId: "ver_2026_01",
				year: "2026-02-15",
			}),
		).toBe(
			"curriculum/documents/curriculum_plan/法学-民族班-培养方案--law-ethnic-class-program/current-effective/2026/reader-assets/reader.json",
		);
		expect(
			buildDocumentArtifactKey({
				collection: "institutional_rules",
				corpus: "regulations",
				documentId: "institutional_regulation:example:示例大学采购工作管理办法:219ecb636aaf",
				filename: "canonical.md",
				revisionTrack: "source-faithful",
				title: "示例大学采购工作管理办法",
				versionId: "sha256:c55cc6f8:effective-2021年3月1日:revision-修订",
				year: "2021",
			}),
		).toBe(
			"regulations/documents/institutional_rules/示例大学采购工作管理办法--219ecb63/source-faithful/2021/canonical.md",
		);
	});

	it("fails closed for invalid refs and digest mismatches", () => {
		expect(() => parseS3Uri("https://example.edu/object.json")).toThrow(
			"object-store uri must use s3://",
		);
		expect(() => parseS3Uri({ kind: "inline", uri: "s3://bucket/key" })).toThrow(
			"input_ref must be object_store",
		);
		expect(() =>
			assertSha256Digest({
				label: "capture release",
				digest: "md5:deadbeef",
				actualSha256: "0".repeat(64),
			}),
		).toThrow("capture release digest must use sha256");
		expect(() =>
			assertObjectStoreSha256Digest({
				label: "capture release",
				ref: { kind: "object_store", uri: "s3://bucket/key", digest: `sha256:${"1".repeat(64)}` },
				actualSha256: "0".repeat(64),
			}),
		).toThrow("capture release digest mismatch");
		expect(() =>
			assertOptionalSha256Digest({
				label: "capture release",
				digest: undefined,
				actualSha256: "0".repeat(64),
			}),
		).not.toThrow();
		expect(() => parseS3Uri("s3://bucket")).toThrow("invalid s3 uri: s3://bucket");
	});
});
