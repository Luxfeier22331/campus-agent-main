import { AwsClient } from "aws4fetch";

import { type Env, isDeployedEnvironment, resolveEnvironment } from "../../config";
import { AppApiRouteError } from "../../http";
import type { NoticeObjectStore } from "./types";

const PRIVATE_DERIVED_OBJECT_STORE_BASE_URL = "http://object-store/campus-agent-derived/";

export function createNoticeObjectStore(env: Env): NoticeObjectStore {
	return {
		async get(contentSha256) {
			const upstream = resolveObjectStoreUpstream(env);
			const signer = new AwsClient({
				accessKeyId: requiredCredential(
					env.OBJECT_STORE_DERIVED_READ_ACCESS_KEY,
					"OBJECT_STORE_DERIVED_READ_ACCESS_KEY",
				),
				region: "us-east-1",
				retries: 0,
				secretAccessKey: requiredCredential(
					env.OBJECT_STORE_DERIVED_READ_SECRET_KEY,
					"OBJECT_STORE_DERIVED_READ_SECRET_KEY",
				),
				service: "s3",
			});
			const url = new URL(`notices/assets/sha256/${contentSha256}`, upstream.baseUrl);
			let response: Response;
			try {
				response = await upstream.fetch(await signer.sign(url, { method: "GET" }));
			} catch (error) {
				throw storageUnavailable(error);
			}
			if (response.status === 404) {
				return null;
			}
			if (!response.ok) {
				throw storageUnavailable();
			}
			return response;
		},
	};
}

function resolveObjectStoreUpstream(env: Env): { baseUrl: string; fetch: typeof fetch } {
	if (isDeployedEnvironment(resolveEnvironment(env))) {
		const privateFetch = env.OBJECT_STORE_PRIVATE?.fetch;
		if (typeof privateFetch !== "function") {
			throw storageUnavailable();
		}
		return {
			baseUrl: PRIVATE_DERIVED_OBJECT_STORE_BASE_URL,
			fetch: privateFetch.bind(env.OBJECT_STORE_PRIVATE) as typeof fetch,
		};
	}
	const localBaseUrl = env.OBJECT_STORE_LOCAL_BASE_URL?.trim();
	if (!localBaseUrl) {
		throw storageUnavailable();
	}
	return {
		baseUrl: localBaseUrl.endsWith("/") ? localBaseUrl : `${localBaseUrl}/`,
		fetch: globalThis.fetch.bind(globalThis),
	};
}

function requiredCredential(value: string | undefined, name: string): string {
	const normalized = value?.trim();
	if (!normalized) {
		throw new AppApiRouteError({
			code: "service_unavailable",
			message: `${name} is required for notice images.`,
			retryable: true,
			status: 503,
		});
	}
	return normalized;
}

function storageUnavailable(cause?: unknown): AppApiRouteError {
	return new AppApiRouteError({
		code: "upstream_unavailable",
		message:
			cause instanceof Error
				? "Notice image storage request failed."
				: "Notice image storage is unavailable.",
		retryable: true,
		status: 502,
	});
}
