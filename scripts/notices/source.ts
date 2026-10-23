import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import type { NoticeClassificationTask } from "notice-classifier-core/batch";
import { mapWithConcurrency } from "notice-classifier-core/concurrency";
import {
	NOTICE_SOURCE_PREFIX,
	type NoticeClassificationSource,
	noticeSourceIdFromKey,
	noticeSourceKey,
	parseNoticeClassificationSourceJson,
	validateNoticeIds,
} from "notice-classifier-core/source";
import { Pool } from "pg";

export interface NoticeSourceObjectStore {
	close(): void;
	listNoticeIds?(): Promise<number[]>;
	getNoticeKey?(noticeId: number): Promise<string>;
	getObject(key: string): Promise<string>;
	listObjectKeys(prefix: string): Promise<string[]>;
}

export interface NoticeObjectListPage {
	isTruncated: boolean;
	keys: string[];
	nextContinuationToken?: string;
}

export interface NoticeInputLoadOptions {
	concurrency?: number;
}

export function loadLocalNoticeSourceEnvironment(repositoryRoot: string): void {
	const path = resolve(
		repositoryRoot,
		"jobs/internal-portal-collection/adapters/internal-portal/.env.local",
	);
	if (existsSync(path)) {
		process.loadEnvFile(path);
	}
}

export function createNoticeSourceObjectStoreFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): NoticeSourceObjectStore {
	const bucket = requiredEnv(env, "OBJECT_STORE_BUCKET_SOURCE");
	const database = new Pool({ connectionString: requiredEnv(env, "NOTICES_DATABASE_URL"), max: 1 });
	const client = new S3Client({
		credentials: {
			accessKeyId: requiredEnv(env, "OBJECT_STORE_SOURCE_ACCESS_KEY"),
			secretAccessKey: requiredEnv(env, "OBJECT_STORE_SOURCE_SECRET_KEY"),
		},
		endpoint: requiredEnv(env, "OBJECT_STORE_ENDPOINT"),
		forcePathStyle: true,
		maxAttempts: 1,
		region: env.OBJECT_STORE_REGION?.trim() || "us-east-1",
	});
	return {
		close() {
			client.destroy();
			void database.end();
		},
		async listNoticeIds() {
			const result = await database.query(
				"SELECT notice_id FROM notices.notices ORDER BY notice_id",
			);
			return result.rows.map((row) => Number(row.notice_id));
		},
		async getNoticeKey(noticeId) {
			const result = await database.query(
				"SELECT source_ref FROM notices.notices WHERE notice_id=$1",
				[noticeId],
			);
			if (!result.rows[0]) {
				throw new Error(`notice does not exist: ${noticeId}`);
			}
			return result.rows[0].source_ref ?? noticeSourceKey(noticeId);
		},
		async getObject(key) {
			const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
			if (!response.Body) {
				throw new Error(`object body is missing: ${key}`);
			}
			return response.Body.transformToString();
		},
		async listObjectKeys(prefix) {
			return collectObjectKeys(async (continuationToken) => {
				const response = await client.send(
					new ListObjectsV2Command({
						Bucket: bucket,
						ContinuationToken: continuationToken,
						Prefix: prefix,
					}),
				);
				return {
					isTruncated: response.IsTruncated === true,
					keys: (response.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : [])),
					nextContinuationToken: response.NextContinuationToken,
				};
			});
		},
	};
}

export async function collectObjectKeys(
	fetchPage: (continuationToken?: string) => Promise<NoticeObjectListPage>,
): Promise<string[]> {
	const keys: string[] = [];
	let continuationToken: string | undefined;
	do {
		const page = await fetchPage(continuationToken);
		keys.push(...page.keys);
		if (page.isTruncated && !page.nextContinuationToken) {
			throw new Error("object listing is truncated without a continuation token");
		}
		continuationToken = page.isTruncated ? page.nextContinuationToken : undefined;
	} while (continuationToken);
	return keys;
}

export async function loadNoticeClassificationInputs(
	objectStore: NoticeSourceObjectStore,
	noticeIds?: readonly number[],
	options: NoticeInputLoadOptions = {},
): Promise<NoticeClassificationTask[]> {
	const ids = noticeIds ? validateNoticeIds(noticeIds) : await listNoticeSourceIds(objectStore);
	if (ids.length === 0) {
		throw new Error("no notice source objects were found");
	}
	ids.sort((left, right) => left - right);
	const concurrency = options.concurrency ?? 1;
	if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
		throw new Error("notice input concurrency must be a positive integer");
	}
	return mapWithConcurrency(ids, concurrency, async (noticeId) => {
		const key = (await objectStore.getNoticeKey?.(noticeId)) ?? noticeSourceKey(noticeId);
		const notice = await loadNotice(objectStore, key);
		if (notice.notice_id !== noticeId) {
			throw new Error(`${key} contains notice_id ${notice.notice_id}`);
		}
		return { noticeId: notice.notice_id, noticeTitle: notice.notice_title };
	});
}

export async function listNoticeSourceIds(objectStore: NoticeSourceObjectStore): Promise<number[]> {
	if (objectStore.listNoticeIds) {
		return objectStore.listNoticeIds();
	}
	const ids = new Set<number>();
	for (const key of await objectStore.listObjectKeys(NOTICE_SOURCE_PREFIX)) {
		const noticeId = noticeSourceIdFromKey(key);
		if (noticeId !== null) {
			ids.add(noticeId);
		}
	}
	return [...ids];
}

async function loadNotice(
	objectStore: NoticeSourceObjectStore,
	key: string,
): Promise<NoticeClassificationSource> {
	return parseNoticeClassificationSourceJson(await objectStore.getObject(key), key);
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}
