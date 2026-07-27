import { sha256Hex } from "ingest-core";
import { describe, expect, it, vi } from "vitest";

import type { SourceCollectorObjectStore } from "../../../src/object-store.js";
import { spoolAttachmentToTemporaryFile } from "../src/attachment-temp-file.js";
import type { InternalPortalConfig } from "../src/config.js";
import { captureInternalPortalFileRelease } from "../src/file-release-capture.js";

const config: InternalPortalConfig = {
	authSsoCookieDomain: ".example.edu",
	authSsoTgc: "TGT-current",
	authSsoTgcFile: null,
	portalBaseUrl: "https://portal.example.edu",
	portalPageUrl: "https://portal.example.edu/page/11#/",
	portalProxyServer: null,
	siteId: "muc_internal_portal",
	sourceHomeUrl: "https://portal.example.edu",
};

describe("internal portal file-release capture", () => {
	it("writes the original file before source.json at fixed source-bucket keys", async () => {
		const objectStore = createMemoryObjectStore();
		const dispose = vi.fn(async () => undefined);
		const downloaded = await spoolAttachmentToTemporaryFile({
			body: bytes("file-bytes"),
			maxBytes: 1024,
			sizeLimitError: () => new Error("too large"),
		});

		const result = await captureInternalPortalFileRelease(
			{ config, fileReleaseId: 646, objectStore },
			{
				createApiContext: async () => ({
					dispose,
					get: async () => {
						throw new Error("unexpected get");
					},
					post: async () => {
						throw new Error("unexpected post");
					},
				}),
				downloadFile: async () => ({
					...downloaded,
					contentDisposition: 'attachment; filename="fallback.pdf"',
					contentType: "application/octet-stream",
				}),
				fetchDetail: async () => ({
					explainDept: "政策法规处",
					filecode: "校发〔2026〕39号",
					filedepartment: "教务处",
					filename: "推免管理办法",
					filetime: "2026-03-31 13:51:11",
					id: 646,
					upfilename: "推免管理办法.pdf",
				}),
				fetchDownloadUrl: async () => ({ state: true, url: "/files/646.pdf" }),
			},
		);

		const prefix = "internal_portal/muc_internal_portal/file-releases/646";
		expect(objectStore.writes).toEqual([`${prefix}/file`, `${prefix}/source.json`]);
		expect(new TextDecoder().decode(objectStore.objects.get(`${prefix}/file`))).toBe("file-bytes");
		expect(
			JSON.parse(new TextDecoder().decode(objectStore.objects.get(`${prefix}/source.json`))),
		).toEqual({
			department: "教务处",
			explanation_department: "政策法规处",
			file: {
				byte_size: 10,
				content_type: "application/pdf",
				digest: `sha256:${sha256Hex(new TextEncoder().encode("file-bytes"))}`,
				object_key: `${prefix}/file`,
				original_filename: "推免管理办法.pdf",
			},
			file_code: "校发〔2026〕39号",
			file_release_id: 646,
			published_at: "2026-03-31 13:51:11",
			schema_version: "internal_portal_file_release_source.v1",
			site_id: "muc_internal_portal",
			title: "推免管理办法",
		});
		expect(result).toMatchObject({
			file_release_id: 646,
			schema_version: "internal_portal_file_release_capture_result.v1",
			source_ref: {
				uri: `s3://campus-agent-source/${prefix}/source.json`,
			},
		});
		expect(dispose).toHaveBeenCalledOnce();
	});

	it("returns an existing valid source.json without opening a portal session", async () => {
		const objectStore = createMemoryObjectStore();
		const sourceKey = "internal_portal/muc_internal_portal/file-releases/646/source.json";
		objectStore.objects.set(
			sourceKey,
			new TextEncoder().encode(
				`${JSON.stringify({
					department: null,
					explanation_department: null,
					file: {
						byte_size: 10,
						content_type: "application/pdf",
						digest: `sha256:${"a".repeat(64)}`,
						object_key: "internal_portal/muc_internal_portal/file-releases/646/file",
						original_filename: "document.pdf",
					},
					file_code: null,
					file_release_id: 646,
					published_at: null,
					schema_version: "internal_portal_file_release_source.v1",
					site_id: "muc_internal_portal",
					title: "Document",
				})}\n`,
			),
		);
		const createApiContext = vi.fn();

		await expect(
			captureInternalPortalFileRelease(
				{ config, fileReleaseId: 646, objectStore },
				{ createApiContext },
			),
		).resolves.toMatchObject({ file_release_id: 646 });
		expect(createApiContext).not.toHaveBeenCalled();
		expect(objectStore.writes).toEqual([]);
	});
});

function createMemoryObjectStore(): SourceCollectorObjectStore & {
	objects: Map<string, Uint8Array>;
	writes: string[];
} {
	const objects = new Map<string, Uint8Array>();
	const writes: string[] = [];
	return {
		objects,
		sourceBucket: "campus-agent-source",
		writes,
		async createOrVerifyObject(input) {
			writes.push(input.key);
			objects.set(input.key, input.body);
			return { byteSize: input.body.byteLength, contentSha256: sha256Hex(input.body) };
		},
		async createOrVerifyStream(input) {
			const chunks: Buffer[] = [];
			for await (const chunk of input.body) {
				chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
			}
			const body = Buffer.concat(chunks);
			writes.push(input.key);
			objects.set(input.key, body);
			return { byteSize: body.byteLength, contentSha256: sha256Hex(body) };
		},
		async getObject(input) {
			const value = objects.get(input.key);
			if (!value) {
				throw new Error(`missing object: ${input.key}`);
			}
			return value;
		},
		async getObjectIfExists(input) {
			return objects.get(input.key) ?? null;
		},
		async putObject(input) {
			writes.push(input.key);
			objects.set(input.key, input.body);
			return { byteSize: input.body.byteLength, contentSha256: sha256Hex(input.body) };
		},
	};
}

async function* bytes(value: string): AsyncIterable<Uint8Array> {
	yield Buffer.from(value);
}
