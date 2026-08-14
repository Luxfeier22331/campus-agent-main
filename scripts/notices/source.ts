import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import {
	type InternalPortalMeta,
	type InternalPortalNoticeSource,
	validateInternalPortalMeta,
	validateInternalPortalNoticeSource,
} from "ingestion-contracts";

import { cleanNoticeContentHtml, type NoticeClassificationInput } from "./classifier";

const META_KEY = "internal_portal/meta.json";
const NOTICE_PREFIX = "internal_portal/notices/";
const NOTICE_KEY_PATTERN = /^internal_portal\/notices\/([1-9][0-9]*)\.json$/u;
const SOURCE_BUCKET = "campus-agent-source";

export interface NoticeSourceObjectStore {
	close(): void;
	getObject(key: string): Promise<string>;
	listObjectKeys(prefix: string): Promise<string[]>;
}

export interface NoticeObjectListPage {
	isTruncated: boolean;
	keys: string[];
	nextContinuationToken?: string;
}

export function loadLocalNoticeSourceEnvironment(repositoryRoot: string): void {
	const path = resolve(repositoryRoot, "apps/source-collector/adapters/internal-portal/.env.local");
	if (existsSync(path)) {
		process.loadEnvFile(path);
	}
}

export function createNoticeSourceObjectStoreFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): NoticeSourceObjectStore {
	const bucket = requiredEnv(env, "OBJECT_STORE_BUCKET_SOURCE");
	if (bucket !== SOURCE_BUCKET) {
		throw new Error(`notice classifier only reads ${SOURCE_BUCKET}`);
	}
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
): Promise<NoticeClassificationInput[]> {
	const meta = await loadMeta(objectStore);
	const ids = noticeIds ? [...noticeIds] : await listNoticeIds(objectStore);
	if (ids.length === 0) {
		throw new Error("no notice source objects were found");
	}
	ids.sort((left, right) => left - right);
	const inputs: NoticeClassificationInput[] = [];
	for (const noticeId of ids) {
		const key = `${NOTICE_PREFIX}${noticeId}.json`;
		const notice = await loadNotice(objectStore, key);
		if (notice.notice_id !== noticeId) {
			throw new Error(`${key} contains notice_id ${notice.notice_id}`);
		}
		const noticeTypeName = meta.notice_types[String(notice.notice_type)];
		if (!noticeTypeName) {
			throw new Error(`${key} references unknown notice_type ${notice.notice_type}`);
		}
		inputs.push(toClassificationInput(notice, noticeTypeName));
	}
	return inputs;
}

async function listNoticeIds(objectStore: NoticeSourceObjectStore): Promise<number[]> {
	const ids = new Set<number>();
	for (const key of await objectStore.listObjectKeys(NOTICE_PREFIX)) {
		const match = NOTICE_KEY_PATTERN.exec(key);
		if (!match) {
			continue;
		}
		const id = Number(match[1]);
		if (!Number.isSafeInteger(id)) {
			throw new Error(`notice object key has an unsafe integer id: ${key}`);
		}
		ids.add(id);
	}
	return [...ids];
}

async function loadMeta(objectStore: NoticeSourceObjectStore): Promise<InternalPortalMeta> {
	const value = parseJson(await objectStore.getObject(META_KEY), META_KEY);
	const validation = validateInternalPortalMeta(value);
	if (!validation.ok) {
		throw new Error(`${META_KEY} violates its contract: ${validation.errors.join("; ")}`);
	}
	return value as InternalPortalMeta;
}

async function loadNotice(
	objectStore: NoticeSourceObjectStore,
	key: string,
): Promise<InternalPortalNoticeSource> {
	const value = parseJson(await objectStore.getObject(key), key);
	const validation = validateInternalPortalNoticeSource(value);
	if (!validation.ok) {
		throw new Error(`${key} violates its contract: ${validation.errors.join("; ")}`);
	}
	return value as InternalPortalNoticeSource;
}

function toClassificationInput(
	notice: InternalPortalNoticeSource,
	noticeTypeName: string,
): NoticeClassificationInput {
	return {
		contentText: cleanNoticeContentHtml(notice.notice_content_html),
		isExternal: notice.is_external,
		noticeId: notice.notice_id,
		noticeTitle: notice.notice_title,
		noticeTypeName,
	};
}

function parseJson(input: string, key: string): unknown {
	try {
		return JSON.parse(input);
	} catch (error) {
		throw new Error(`${key} is not valid JSON`, { cause: error });
	}
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}
