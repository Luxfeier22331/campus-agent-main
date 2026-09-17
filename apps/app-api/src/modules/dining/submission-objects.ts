import { AwsClient } from "aws4fetch";
import { XMLParser, XMLValidator } from "fast-xml-parser";

import { type Env, isDeployedEnvironment, resolveEnvironment } from "../../config";
import { AppApiRouteError } from "../../http";
import type { DiningSubmissionObjects } from "./submission-media";

const BUCKET = "campus-agent-derived";
const PREFIX = "dining/submissions/";
const PRIVATE_BASE_URL = `http://object-store/${BUCKET}/`;
// Bounds the caller wait; a timed-out remote PUT still requires retained cleanup intent.
const OPERATION_TIMEOUT_MS = 30_000;
const MAX_LIST_BYTES = 4 * 1024 * 1024;

interface ObjectVersion {
	key: string;
	versionId: string;
}

interface VersionPage {
	versions: ObjectVersion[];
	next: ObjectVersion | null;
}

interface StorageSession {
	baseUrl: URL;
	bucket: string;
	request(url: URL, init: RequestInit): Promise<Response>;
}

export function createDiningSubmissionObjects(env: Env): DiningSubmissionObjects {
	return {
		put(key, photo) {
			return withStorage(env, key, async ({ baseUrl, request }) => {
				const response = await request(new URL(key, baseUrl), {
					method: "PUT",
					headers: { "content-type": "image/webp", "cache-control": "no-store" },
					body: new Uint8Array(photo.bytes),
				});
				if (response.status !== 200) {
					throw storageUnavailable();
				}
				await response.body?.cancel();
				const versionId = response.headers.get("x-amz-version-id");
				return { versionId: versionId === "null" ? null : versionId };
			});
		},
		get(key) {
			return withStorage(env, key, async ({ baseUrl, request }) => {
				const response = await request(new URL(key, baseUrl), { method: "GET" });
				if (await isMissingObject(response)) {
					return null;
				}
				if (
					response.status !== 200 ||
					response.headers.get("content-type")?.split(";")[0]?.trim() !== "image/webp"
				) {
					throw storageUnavailable();
				}
				return readBytes(response);
			});
		},
		deleteAllVersions(key) {
			return withStorage(env, key, async (session) => {
				const versions = await listVersions(session, key);
				for (const version of versions) {
					const url = new URL(key, session.baseUrl);
					url.searchParams.set("versionId", version.versionId);
					await deleteObject(session, url);
				}
				// Some unversioned stores omit their current object from version listings.
				if (versions.length === 0 && (await currentObjectExists(session, key))) {
					await deleteObject(session, new URL(key, session.baseUrl));
				}
				if ((await listVersions(session, key)).length > 0) {
					throw storageUnavailable();
				}
				if (await currentObjectExists(session, key)) {
					throw storageUnavailable();
				}
			});
		},
	};
}

async function withStorage<T>(
	env: Env,
	key: string,
	work: (session: StorageSession) => Promise<T>,
): Promise<T> {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		validateKey(key);
		const upstream = resolveUpstream(env);
		const accessKeyId = env.OBJECT_STORE_DERIVED_ACCESS_KEY?.trim();
		const secretAccessKey = env.OBJECT_STORE_DERIVED_SECRET_KEY?.trim();
		if (!(accessKeyId && secretAccessKey)) {
			throw storageUnavailable();
		}
		const signer = new AwsClient({
			accessKeyId,
			secretAccessKey,
			region: "us-east-1",
			service: "s3",
			retries: 0,
		});
		const deadline = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => {
				controller.abort();
				reject(storageUnavailable());
			}, OPERATION_TIMEOUT_MS);
		});
		return await Promise.race([
			work({
				baseUrl: upstream.baseUrl,
				bucket: upstream.bucket,
				async request(url, init) {
					controller.signal.throwIfAborted();
					const signed = await signer.sign(url, {
						...init,
						redirect: "manual",
						signal: controller.signal,
					});
					controller.signal.throwIfAborted();
					return upstream.fetch(signed);
				},
			}),
			deadline,
		]);
	} catch {
		throw storageUnavailable();
	} finally {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
		controller.abort();
	}
}

function resolveUpstream(env: Env): { baseUrl: URL; bucket: string; fetch: typeof fetch } {
	if (isDeployedEnvironment(resolveEnvironment(env))) {
		const privateFetch = env.OBJECT_STORE_PRIVATE?.fetch;
		if (typeof privateFetch !== "function") {
			throw storageUnavailable();
		}
		return {
			baseUrl: new URL(PRIVATE_BASE_URL),
			bucket: BUCKET,
			fetch: privateFetch.bind(env.OBJECT_STORE_PRIVATE) as typeof fetch,
		};
	}
	const value = env.OBJECT_STORE_LOCAL_BASE_URL?.trim();
	if (!value) {
		throw storageUnavailable();
	}
	const baseUrl = new URL(value.endsWith("/") ? value : `${value}/`);
	// Local tunnels may expose a per-worktree bucket, so accept any single valid bucket segment.
	const bucket = baseUrl.pathname.slice(1, -1);
	if (
		!["http:", "https:"].includes(baseUrl.protocol) ||
		baseUrl.pathname !== `/${bucket}/` ||
		!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) ||
		baseUrl.search ||
		baseUrl.hash ||
		baseUrl.username ||
		baseUrl.password
	) {
		throw storageUnavailable();
	}
	return { baseUrl, bucket, fetch: globalThis.fetch.bind(globalThis) };
}

function validateKey(key: string): void {
	if (
		!key.startsWith(PREFIX) ||
		key.length > 1024 ||
		!key
			.slice(PREFIX.length)
			.split("/")
			.every((segment) => /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(segment))
	) {
		throw storageUnavailable();
	}
}

async function listVersions(session: StorageSession, key: string): Promise<ObjectVersion[]> {
	const versions: ObjectVersion[] = [];
	const seenVersions = new Set<string>();
	const seenMarkers = new Set<string>();
	let marker: ObjectVersion | null = null;
	do {
		const url = new URL(session.baseUrl);
		url.searchParams.set("versions", "");
		url.searchParams.set("prefix", key);
		if (marker) {
			url.searchParams.set("key-marker", marker.key);
			url.searchParams.set("version-id-marker", marker.versionId);
		}
		const response = await session.request(url, { method: "GET" });
		if (response.status !== 200) {
			throw storageUnavailable();
		}
		const page = parseVersionPage(await readXml(response), session.bucket, key);
		for (const version of page.versions) {
			if (seenVersions.has(version.versionId)) {
				throw storageUnavailable();
			}
			seenVersions.add(version.versionId);
			versions.push(version);
		}
		marker = page.next;
		if (marker) {
			const markerId = JSON.stringify(marker);
			if (seenMarkers.has(markerId)) {
				throw storageUnavailable();
			}
			seenMarkers.add(markerId);
		}
	} while (marker);
	return versions;
}

function parseVersionPage(xml: Record<string, unknown>, bucket: string, key: string): VersionPage {
	const result = asRecord(xml.ListVersionsResult);
	if (
		result.Name !== bucket ||
		result.Prefix !== key ||
		(result.IsTruncated !== "true" && result.IsTruncated !== "false") ||
		result.CommonPrefixes !== undefined
	) {
		throw storageUnavailable();
	}
	const versions: ObjectVersion[] = [];
	for (const name of ["Version", "DeleteMarker"]) {
		const entries = result[name];
		for (const entry of entries === undefined ? [] : Array.isArray(entries) ? entries : [entries]) {
			const record = asRecord(entry);
			if (
				typeof record.Key !== "string" ||
				!record.Key.startsWith(key) ||
				typeof record.VersionId !== "string" ||
				!record.VersionId
			) {
				throw storageUnavailable();
			}
			if (record.Key === key) {
				versions.push({ key, versionId: record.VersionId });
			}
		}
	}
	if (result.IsTruncated === "false") {
		if (result.NextKeyMarker || result.NextVersionIdMarker) {
			throw storageUnavailable();
		}
		return { versions, next: null };
	}
	if (
		typeof result.NextKeyMarker !== "string" ||
		!result.NextKeyMarker.startsWith(key) ||
		typeof result.NextVersionIdMarker !== "string" ||
		!result.NextVersionIdMarker
	) {
		throw storageUnavailable();
	}
	return {
		versions,
		next: { key: result.NextKeyMarker, versionId: result.NextVersionIdMarker },
	};
}

async function deleteObject(session: StorageSession, url: URL): Promise<void> {
	const response = await session.request(url, { method: "DELETE" });
	if (response.status !== 204) {
		throw storageUnavailable();
	}
	await response.body?.cancel();
}

async function currentObjectExists(session: StorageSession, key: string): Promise<boolean> {
	const response = await session.request(new URL(key, session.baseUrl), { method: "GET" });
	if (await isMissingObject(response)) {
		return false;
	}
	if (response.status !== 200) {
		throw storageUnavailable();
	}
	await response.body?.cancel();
	return true;
}

async function isMissingObject(response: Response): Promise<boolean> {
	if (response.status !== 404) {
		return false;
	}
	if (response.headers.get("x-amz-delete-marker") === "true") {
		await response.body?.cancel();
		return true;
	}
	const error = asRecord((await readXml(response)).Error);
	if (error.Code !== "NoSuchKey") {
		throw storageUnavailable();
	}
	return true;
}

async function readXml(response: Response): Promise<Record<string, unknown>> {
	const xml = new TextDecoder("utf-8", { fatal: true }).decode(
		await readBytes(response, MAX_LIST_BYTES),
	);
	if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) {
		throw storageUnavailable();
	}
	return asRecord(new XMLParser({ parseTagValue: false, trimValues: false }).parse(xml));
}

async function readBytes(
	response: Response,
	limit = Number.POSITIVE_INFINITY,
): Promise<Uint8Array> {
	const reader = response.body?.getReader();
	if (!reader) {
		throw storageUnavailable();
	}
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) {
				break;
			}
			size += value.byteLength;
			if (size > limit) {
				throw storageUnavailable();
			}
			chunks.push(value);
		}
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
	const length = response.headers.get("content-length");
	if (length !== null && (!/^\d+$/.test(length) || Number(length) !== size)) {
		throw storageUnavailable();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw storageUnavailable();
	}
	return value as Record<string, unknown>;
}

function storageUnavailable(): AppApiRouteError {
	return new AppApiRouteError({
		code: "dining_submission_storage_unavailable",
		message: "Dining photo storage is unavailable.",
		retryable: true,
		status: 503,
	});
}
