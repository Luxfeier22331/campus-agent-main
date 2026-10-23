import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	ListObjectVersionsCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { afterEach, expect, it, vi } from "vitest";
import {
	INTERNAL_PORTAL_STATE_KEY as key,
	inspectStateVersions,
	pruneStateVersions,
	runStateVersionMaintenance,
} from "../src/state-version-maintenance.ts";

const bucket = "campus-agent-source-wt-test";
const env = {
	OBJECT_STORE_ENDPOINT: "http://localhost:9000",
	OBJECT_STORE_SOURCE_ACCESS_KEY: "test",
	OBJECT_STORE_SOURCE_SECRET_KEY: "test",
	OBJECT_STORE_BUCKET_SOURCE: ` ${bucket} `,
};
afterEach(() => vi.restoreAllMocks());

it("inspects, backs up and prunes versions in the configured bucket", async () => {
	const directory = await mkdtemp(join(tmpdir(), "state-versions-"));
	const backupFile = join(directory, "backup.json");
	const deleted: string[] = [];
	vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
		if (command instanceof ListObjectVersionsCommand) {
			expect(command.input.Bucket).toBe(bucket);
			expect(command.input.Prefix).toBe(key);
			return {
				Versions: [
					{ Key: key, VersionId: "current", IsLatest: true, Size: 2 },
					...(!deleted.length ? [{ Key: key, VersionId: "old", Size: 2 }] : []),
				],
			} as never;
		}
		if (command instanceof GetObjectCommand) {
			expect(command.input).toEqual({ Bucket: bucket, Key: key, VersionId: "current" });
			return {
				Body: { transformToByteArray: async () => Buffer.from("{}") },
			} as never;
		}
		expect(command).toBeInstanceOf(DeleteObjectCommand);
		expect((command as DeleteObjectCommand).input).toEqual({ Bucket: bucket, Key: key, VersionId: "old" });
		deleted.push("old");
		return {} as never;
	});
	try {
		const before = await runStateVersionMaintenance({ env });
		expect(before.bucket).toBe(bucket);
		expect(deleted).toEqual([]);
		const after = await runStateVersionMaintenance({ env, apply: true, backupFile });
		expect(after.bucket).toBe(bucket);
		expect(after.versions.map((version) => version.versionId)).toEqual(["current"]);
		expect(deleted).toEqual(["old"]);
		expect(JSON.parse(await readFile(backupFile, "utf8"))).toMatchObject({
			bucket, key, versionId: "current", bodyBase64: Buffer.from("{}").toString("base64"),
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

it.each([undefined, "", "   "])("rejects missing bucket before any storage operation (%s)", async (value) => {
	const send = vi.spyOn(S3Client.prototype, "send");
	const missing = { ...env, OBJECT_STORE_BUCKET_SOURCE: value };
	await expect(inspectStateVersions(missing)).rejects.toThrow("OBJECT_STORE_BUCKET_SOURCE is required");
	await expect(pruneStateVersions(missing, "current")).rejects.toThrow("OBJECT_STORE_BUCKET_SOURCE is required");
	expect(send).not.toHaveBeenCalled();
});

it("reports the configured bucket when the current state is missing", async () => {
	vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
	await expect(inspectStateVersions(env)).rejects.toThrow(`s3://${bucket}/${key}`);
});
