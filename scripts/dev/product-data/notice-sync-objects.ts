import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeNoticeContent } from "@campus-agent/notices";
import {
	type InternalPortalNoticeSource,
	validateInternalPortalNoticeSource,
} from "ingestion-contracts";
import { noticeSourceRef } from "ingestion-contracts/notice-source-ref";
import portal from "../../../configs/sources/internal-portal.json" with { type: "json" };
import type { NoticeSourceRows } from "./notice-sync.ts";

export interface RcloneEndpoint {
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
}

/** Executed with execFile-style (command, args) so no shell parses the connection string. */
export type ExecFile = (
	command: string,
	args: string[],
	options: { maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;

/**
 * Batch-copy binary objects with rclone instead of the per-object read/write loop:
 * concurrent transfers, per-object retries and skip-existing resume come from rclone,
 * while closure resolution and digest validation stay here. Remote configuration is
 * passed via RCLONE_CONFIG_* environment variables — the inline `:s3,...` connection
 * string cannot carry `http://` endpoints, and env vars keep credentials off disk.
 */
export type RcloneCopier = (input: {
	keys: string[];
	source: RcloneEndpoint;
	target: RcloneEndpoint;
}) => Promise<number>;

export async function rcloneCopier(
	input: Parameters<RcloneCopier>[0],
	options: { rclonePath?: string; execFile?: ExecFile } = {},
): Promise<number> {
	if (input.keys.length === 0) {
		return 0;
	}
	const remoteEnv = (name: string, endpoint: RcloneEndpoint) => ({
		[`RCLONE_CONFIG_${name}_TYPE`]: "s3",
		[`RCLONE_CONFIG_${name}_PROVIDER`]: "Minio",
		[`RCLONE_CONFIG_${name}_ENDPOINT`]: endpoint.endpoint,
		[`RCLONE_CONFIG_${name}_ACCESS_KEY_ID`]: endpoint.accessKeyId,
		[`RCLONE_CONFIG_${name}_SECRET_ACCESS_KEY`]: endpoint.secretAccessKey,
	});
	const directory = await mkdtemp(join(tmpdir(), "notice-sync-rclone-"));
	try {
		const list = join(directory, "files-from");
		await writeFile(list, `${input.keys.join("\n")}\n`, "utf8");
		const run =
			options.execFile ??
			(async (
				command: string,
				args: string[],
				execOptions: { maxBuffer: number; env: Record<string, string> },
			) => {
				const { promisify } = await import("node:util");
				const execFile = promisify((await import("node:child_process")).execFile);
				return await execFile(command, args, execOptions);
			});
		await run(
			options.rclonePath ?? "rclone",
			[
				"copy",
				`syncsource:${input.source.bucket}`,
				`synctarget:${input.target.bucket}`,
				"--files-from",
				list,
				"--transfers",
				"8",
				"--checkers",
				"8",
				"--retries",
				"3",
				"--checksum",
			],
			{
				maxBuffer: 16 * 1024 * 1024,
				env: {
					...process.env,
					...remoteEnv("SYNCSOURCE", input.source),
					...remoteEnv("SYNCTARGET", input.target),
				} as Record<string, string>,
			},
		);
		return input.keys.length;
	} catch (error) {
		const detail = (error as { stderr?: string; message?: string }).stderr ?? "";
		throw new Error(
			`rclone object copy failed (is rclone available via nix develop?): ${detail || (error as Error).message}`,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

interface ClosurePlan {
	/** Binary object keys (images/attachments) to batch-copy via the copier. */
	binaryKeys: Array<{ key: string; sha256?: string | null }>;
	/** JSON metadata objects copied through the read/write path (they need parse+validate). */
	jsonKeys: string[];
}

/** Resolve the source closure per notice row: validate refs and enumerate binary objects. */
async function planNoticeSourceClosure(input: {
	rows: NoticeSourceRows;
	read: (key: string) => Promise<Uint8Array>;
}): Promise<ClosurePlan> {
	const plan: ClosurePlan = { binaryKeys: [], jsonKeys: [] };
	const seen = new Set<string>();
	const addBinary = (key: string, sha256?: string | null) => {
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		plan.binaryKeys.push({ key, sha256 });
	};
	const addJson = (key: string) => {
		if (!seen.has(key)) {
			seen.add(key);
			plan.jsonKeys.push(key);
		}
	};
	addJson("internal_portal/meta.json");
	// Ref JSONs are small and independent; bounded concurrency hides per-object latency.
	const CONCURRENCY = 8;
	const notices = input.rows["notices.notices"];
	for (let offset = 0; offset < notices.length; offset += CONCURRENCY) {
		const batch = notices.slice(offset, offset + CONCURRENCY);
		const sourcesPerRow = await Promise.all(
			batch.map(async (row) => {
				const refs = new Set(
					[
						row.source_ref ?? `internal_portal/notices/${row.notice_id}.json`,
						row.published_source_ref,
					]
						.filter(Boolean)
						.map(String),
				);
				const parsed = [...refs].map((key) => {
					const body = input.read(key);
					return { key, body };
				});
				const entries = await Promise.all(
					parsed.map(async ({ key, body }) => {
						const value = JSON.parse(Buffer.from(await body).toString("utf8"));
						if (
							!validateInternalPortalNoticeSource(value).ok ||
							String(value.notice_id) !== String(row.notice_id)
						) {
							throw new Error(`Invalid notice source: ${key}`);
						}
						const source = value as InternalPortalNoticeSource;
						if (
							(key === row.source_ref || key === row.published_source_ref) &&
							noticeSourceRef(source) !== key
						) {
							throw new Error(`Notice source ref mismatch: ${key}`);
						}
						return { key, source };
					}),
				);
				return { row, entries };
			}),
		);
		for (const { row, entries } of sourcesPerRow) {
			for (const { key, source } of entries) {
				if (source.resources) {
					for (const resource of source.resources) {
						if (resource.object_key) {
							addBinary(resource.object_key, resource.sha256);
						}
					}
				} else if (!source.is_external) {
					const content = normalizeNoticeContent({
						html: source.notice_content_html,
						title: source.notice_title,
						portalHost: new URL(portal.portal_base_url).hostname,
					});
					for (const image of content.images) {
						addBinary(`internal_portal/notices/${row.notice_id}/images/${image.sourceOrdinal}`);
					}
					for (const [ordinal] of source.attachments.entries()) {
						addBinary(`internal_portal/notices/${row.notice_id}/attachments/${ordinal}`);
					}
				}
				addJson(key);
			}
		}
	}
	return plan;
}

/**
 * Copy only the selected rows' current and published source closures before importing
 * their refs. Binary objects go through the batch copier (rclone by default); JSON
 * metadata keeps the read/write path because it is parsed and validated here.
 */
export async function copyNoticeSourceClosure(input: {
	rows: NoticeSourceRows;
	read: (key: string) => Promise<Uint8Array>;
	write: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
	/**
	 * Optional rclone endpoints; without them all objects use the read/write path.
	 * readLocal must fetch the copied bytes from the target store so digest
	 * validation checks the local copy instead of re-reading the remote source.
	 */
	batchCopy?: {
		source: RcloneEndpoint;
		target: RcloneEndpoint;
		readLocal: (key: string) => Promise<Uint8Array | undefined>;
		copier?: RcloneCopier;
	};
}) {
	let objects = 0;
	if (input.rows["notices.notices"].length === 0) {
		return { objects };
	}
	const plan = await planNoticeSourceClosure({ rows: input.rows, read: input.read });
	if (input.batchCopy) {
		const { source, target, readLocal, copier = rcloneCopier } = input.batchCopy;
		objects += await copier({ keys: plan.binaryKeys.map((entry) => entry.key), source, target });
		// Digest validation stays local: verify the copied bytes, not the remote source.
		for (const entry of plan.binaryKeys) {
			if (!entry.sha256) {
				continue;
			}
			const body = await readLocal(entry.key);
			if (!body) {
				throw new Error(`Notice resource missing after batch copy: ${entry.key}`);
			}
			if (createHash("sha256").update(body).digest("hex") !== entry.sha256) {
				throw new Error(`Notice resource digest mismatch: ${entry.key}`);
			}
		}
	} else {
		for (const entry of plan.binaryKeys) {
			const body = await input.read(entry.key);
			if (entry.sha256 && createHash("sha256").update(body).digest("hex") !== entry.sha256) {
				throw new Error(`Notice resource digest mismatch: ${entry.key}`);
			}
			await input.write(entry.key, body, "application/octet-stream");
			objects += 1;
		}
	}
	for (const key of plan.jsonKeys) {
		const body = await input.read(key);
		await input.write(key, body, "application/json");
		objects += 1;
	}
	return { objects };
}
