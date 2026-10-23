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
	/** Binary object keys (images/attachments) for the batch copier. */
	binaryKeys: string[];
	/** JSON metadata already read and validated during planning; written from these bytes. */
	jsonObjects: Map<string, Uint8Array>;
}

/** Resolve the source closure per notice row: validate refs and enumerate binary objects. */
async function planNoticeSourceClosure(input: {
	rows: NoticeSourceRows;
	read: (key: string) => Promise<Uint8Array>;
}): Promise<ClosurePlan> {
	const binaryKeys = new Set<string>();
	const jsonObjects = new Map<string, Uint8Array>([
		["internal_portal/meta.json", await input.read("internal_portal/meta.json")],
	]);
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
				const entries = await Promise.all(
					[...refs].map(async (key) => {
						const body = await input.read(key);
						const value = JSON.parse(Buffer.from(body).toString("utf8"));
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
						return { key, body, source };
					}),
				);
				return { row, entries };
			}),
		);
		for (const { row, entries } of sourcesPerRow) {
			for (const { key, body, source } of entries) {
				if (source.resources) {
					for (const resource of source.resources) {
						if (resource.object_key) {
							binaryKeys.add(resource.object_key);
						}
					}
				} else if (!source.is_external) {
					const content = normalizeNoticeContent({
						html: source.notice_content_html,
						title: source.notice_title,
						portalHost: new URL(portal.portal_base_url).hostname,
					});
					for (const image of content.images) {
						binaryKeys.add(
							`internal_portal/notices/${row.notice_id}/images/${image.sourceOrdinal}`,
						);
					}
					for (const [ordinal] of source.attachments.entries()) {
						binaryKeys.add(`internal_portal/notices/${row.notice_id}/attachments/${ordinal}`);
					}
				}
				jsonObjects.set(key, body);
			}
		}
	}
	return { binaryKeys: [...binaryKeys], jsonObjects };
}

/**
 * Copy only the selected rows' current and published source closures before importing
 * their refs. Binary objects go through the batch copier (rclone by default), whose
 * `--checksum` transfer already verifies each copy; JSON metadata is written from the
 * bytes read and validated while planning.
 */
export async function copyNoticeSourceClosure(input: {
	rows: NoticeSourceRows;
	read: (key: string) => Promise<Uint8Array>;
	write: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
	source: RcloneEndpoint;
	target: RcloneEndpoint;
	copier?: RcloneCopier;
}) {
	if (input.rows["notices.notices"].length === 0) {
		return { objects: 0 };
	}
	const plan = await planNoticeSourceClosure({ rows: input.rows, read: input.read });
	let objects = await (input.copier ?? rcloneCopier)({
		keys: plan.binaryKeys,
		source: input.source,
		target: input.target,
	});
	for (const [key, body] of plan.jsonObjects) {
		await input.write(key, body, "application/json");
		objects += 1;
	}
	return { objects };
}
