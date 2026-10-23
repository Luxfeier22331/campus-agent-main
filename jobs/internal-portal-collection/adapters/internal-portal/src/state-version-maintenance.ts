import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectVersionsCommand,
	type S3Client,
	type ObjectVersion,
	type DeleteMarkerEntry,
} from "@aws-sdk/client-s3";
import { createNoticeDatabasePool } from "@campus-agent/notice-database";

import { createSourceObjectStoreConnection } from "../../../src/source-object-store.ts";

export const INTERNAL_PORTAL_STATE_KEY = "internal_portal/notices/_state.json";

const NOTICE_MAINTENANCE_LOCK_NAMESPACE = 1_315_928_137;
const NOTICE_MAINTENANCE_LOCK_ID = 1;

type VersionEntry = {
	key: string;
	lastModified: string | null;
	isLatest: boolean;
	size: number;
	versionId: string;
	isDeleteMarker: boolean;
};

export type StateVersionReport = {
	bucket: string;
	key: string;
	currentVersionId: string | null;
	currentETag: string | null;
	currentSha256: string | null;
	currentBytes: number;
	versions: VersionEntry[];
};

type StateVersionMaintenanceOptions = {
	env?: Record<string, string | undefined>;
	apply?: boolean;
	backupFile?: string;
};

export async function inspectStateVersions(
	env: Record<string, string | undefined> = process.env,
): Promise<StateVersionReport> {
	const { bucket, client } = createSourceObjectStoreConnection(env);
	try {
		const versions = await listStateVersions(client, bucket);
		const current = versions.find((entry) => entry.isLatest && !entry.isDeleteMarker) ?? null;
		if (!current) {
			throw new Error(`current object version not found for s3://${bucket}/${INTERNAL_PORTAL_STATE_KEY}`);
		}
		const head = await client.send(
			new HeadObjectCommand({
				Bucket: bucket,
				Key: INTERNAL_PORTAL_STATE_KEY,
				...(current.versionId !== "null" ? { VersionId: current.versionId } : {}),
			}),
		);
		const body = await client.send(
			new GetObjectCommand({
				Bucket: bucket,
				Key: INTERNAL_PORTAL_STATE_KEY,
				...(current.versionId !== "null" ? { VersionId: current.versionId } : {}),
			}),
		);
		if (!body.Body) {
			throw new Error("current state object body is missing");
		}
		const bytes = await body.Body.transformToByteArray();
		return {
			bucket,
			key: INTERNAL_PORTAL_STATE_KEY,
			currentVersionId: current.versionId === "null" ? null : current.versionId,
			currentETag: head.ETag ?? null,
			currentSha256: createHash("sha256").update(bytes).digest("hex"),
			currentBytes: bytes.byteLength,
			versions,
		};
	} finally {
		client.destroy();
	}
}

export async function pruneStateVersions(
	env: Record<string, string | undefined> = process.env,
	keepVersionId: string,
): Promise<number> {
	const normalizedKeepVersionId = keepVersionId.trim();
	if (!normalizedKeepVersionId || normalizedKeepVersionId === "null") {
		throw new Error("a concrete current version id is required for state cleanup");
	}
	const { bucket, client } = createSourceObjectStoreConnection(env);
	let deleted = 0;
	try {
		const versions = await listStateVersions(client, bucket);
		for (const version of versions) {
			if (version.versionId === normalizedKeepVersionId) {
				continue;
			}
			await client.send(
				new DeleteObjectCommand({
					Bucket: bucket,
					Key: INTERNAL_PORTAL_STATE_KEY,
					VersionId: version.versionId,
				}),
			);
			deleted += 1;
		}
		return deleted;
	} finally {
		client.destroy();
	}
}

export async function runStateVersionMaintenance(
	options: StateVersionMaintenanceOptions = {},
): Promise<StateVersionReport> {
	const env = options.env ?? process.env;
	const before = await inspectStateVersions(env);
	if (!options.apply) {
		return before;
	}
	if (!options.backupFile) {
		throw new Error("--backup-file is required with --apply");
	}
	if (!before.currentVersionId) {
		throw new Error("refusing to apply cleanup to an unversioned state object");
	}
	await writeBackup(options.backupFile, env, before);
	const afterBackup = await inspectStateVersions(env);
	if (afterBackup.currentVersionId !== before.currentVersionId || afterBackup.currentSha256 !== before.currentSha256) {
		throw new Error("state object changed after backup; refusing to delete versions");
	}
	await pruneStateVersions(env, before.currentVersionId);
	const after = await inspectStateVersions(env);
	if (after.versions.length !== 1 || after.currentVersionId !== before.currentVersionId) {
		throw new Error("state object version cleanup did not converge to the preserved current version");
	}
	return after;
}

export async function withNoticeMaintenanceLock<T>(
	env: Record<string, string | undefined>,
	operation: () => Promise<T>,
): Promise<T> {
	const pool = createNoticeDatabasePool(env, { max: 1 });
	const client = await pool.connect();
	let acquired = false;
	try {
		const result = await client.query<{ acquired: boolean }>(
			"SELECT pg_try_advisory_lock($1, $2) AS acquired",
			[NOTICE_MAINTENANCE_LOCK_NAMESPACE, NOTICE_MAINTENANCE_LOCK_ID],
		);
		acquired = result.rows[0]?.acquired === true;
		if (!acquired) {
			throw new Error("another notice maintenance collection is already running");
		}
		return await operation();
	} finally {
		if (acquired) {
			await client.query("SELECT pg_advisory_unlock($1, $2)", [
				NOTICE_MAINTENANCE_LOCK_NAMESPACE,
				NOTICE_MAINTENANCE_LOCK_ID,
			]);
		}
		client.release();
		await pool.end();
	}
}

async function writeBackup(path: string, env: Record<string, string | undefined>, report: StateVersionReport): Promise<void> {
	const { client } = createSourceObjectStoreConnection(env);
	try {
		const response = await client.send(
			new GetObjectCommand({
				Bucket: report.bucket,
				Key: report.key,
				...(report.currentVersionId ? { VersionId: report.currentVersionId } : {}),
			}),
		);
		if (!response.Body) {
			throw new Error("current state object body is missing during backup");
		}
		const body = await response.Body.transformToByteArray();
		await writeFile(
			path,
			JSON.stringify(
				{
					bucket: report.bucket,
					key: report.key,
					versionId: report.currentVersionId,
					etag: report.currentETag,
					sha256: report.currentSha256,
					bodyBase64: Buffer.from(body).toString("base64"),
				},
				null,
				2,
			),
			"utf8",
		);
	} finally {
		client.destroy();
	}
}

async function listStateVersions(client: S3Client, bucket: string): Promise<VersionEntry[]> {
	const entries: VersionEntry[] = [];
	let keyMarker: string | undefined;
	let versionIdMarker: string | undefined;
	do {
		const page = await client.send(
			new ListObjectVersionsCommand({
				Bucket: bucket,
				Prefix: INTERNAL_PORTAL_STATE_KEY,
				KeyMarker: keyMarker,
				VersionIdMarker: versionIdMarker,
			}),
		);
		for (const entry of [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])]) {
			if (entry.Key !== INTERNAL_PORTAL_STATE_KEY || !entry.VersionId) {
				continue;
			}
			entries.push(versionEntry(entry));
		}
		keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
		versionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
	} while (keyMarker || versionIdMarker);
	return entries;
}

function versionEntry(entry: ObjectVersion | DeleteMarkerEntry): VersionEntry {
	return {
		key: entry.Key ?? INTERNAL_PORTAL_STATE_KEY,
		lastModified: entry.LastModified?.toISOString() ?? null,
		isLatest: entry.IsLatest === true,
		size: "Size" in entry && typeof entry.Size === "number" ? entry.Size : 0,
		versionId: entry.VersionId ?? "",
		isDeleteMarker: "IsLatest" in entry && "Size" in entry === false,
	};
}
