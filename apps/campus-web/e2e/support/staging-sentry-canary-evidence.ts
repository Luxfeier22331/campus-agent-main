import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
	parseSentryCanarySentinels,
	type SentryCanarySentinels,
} from "../../src/platform/telemetry/sentry-canary";

const EVENT_ID_PATTERN = /^[0-9a-f]{32}$/u;
const APP_API_RELEASE_PATTERN = /^app-api@[0-9a-f]{40}$/u;
const CAMPUS_WEB_RELEASE_PATTERN = /^campus-web@[0-9a-f]{40}$/u;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const RUNTIME_TRACE_ID_PATTERN = /^[0-9a-f]{32}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_CANARY_WINDOW_MS = 30 * 60 * 1_000;

export interface StagingObservabilityCanaryEvidence {
	canaryWindow: {
		completedAt: string;
		startedAt: string;
	};
	eventIds: {
		appApi: string;
		campusWebBrowser: string;
		campusWebEdge: string;
	};
	requestId: string;
	schemaVersion: 1;
	sentinelSha256: string;
	sentinels: SentryCanarySentinels;
	runtimeTraceId: string;
}

export function createStagingObservabilityCanarySentinels(): SentryCanarySentinels {
	const suffix = randomUUID().replaceAll("-", "");
	return {
		body: `body-${suffix}`,
		credential: `credential-${suffix}`,
		header: `header-${suffix}`,
		query: `query-${suffix}`,
		user: `user-${suffix}`,
	};
}

export function buildStagingObservabilityCanaryEvidence(input: {
	appApiEventId: string;
	appApiRelease: string;
	browserEventId: string;
	campusWebRelease: string;
	completedAt: string;
	edgeEventId: string;
	requestId: string;
	runtimeTraceId: string;
	sentinelSha256: string;
	sentinels: SentryCanarySentinels;
	smokeAuthSecret: string;
	startedAt: string;
}): StagingObservabilityCanaryEvidence {
	for (const eventId of [input.appApiEventId, input.browserEventId, input.edgeEventId]) {
		if (!EVENT_ID_PATTERN.test(eventId)) {
			throw new Error("Sentry canary returned an invalid event id.");
		}
	}
	if (new Set([input.appApiEventId, input.browserEventId, input.edgeEventId]).size !== 3) {
		throw new Error("Sentry canary event ids must be distinct.");
	}
	if (
		!(
			APP_API_RELEASE_PATTERN.test(input.appApiRelease) &&
			CAMPUS_WEB_RELEASE_PATTERN.test(input.campusWebRelease)
		)
	) {
		throw new Error("Sentry canary returned an invalid release.");
	}
	if (!SHA256_PATTERN.test(input.sentinelSha256)) {
		throw new Error("Sentry canary returned an invalid sentinel hash.");
	}
	if (!REQUEST_ID_PATTERN.test(input.requestId)) {
		throw new Error("Observability canary returned an invalid request id.");
	}
	if (!RUNTIME_TRACE_ID_PATTERN.test(input.runtimeTraceId)) {
		throw new Error("Observability canary returned an invalid runtime trace id.");
	}
	if (!parseSentryCanarySentinels(input.sentinels)) {
		throw new Error("Observability canary returned invalid sentinels.");
	}
	if (!input.smokeAuthSecret) {
		throw new Error("The staging smoke auth secret is required.");
	}
	const startedAt = Date.parse(input.startedAt);
	const completedAt = Date.parse(input.completedAt);
	if (
		Number.isNaN(startedAt) ||
		Number.isNaN(completedAt) ||
		completedAt < startedAt ||
		completedAt - startedAt > MAX_CANARY_WINDOW_MS
	) {
		throw new Error(
			"Observability canary window must contain ordered RFC3339 timestamps no more than 30 minutes apart.",
		);
	}

	const evidence: StagingObservabilityCanaryEvidence = {
		canaryWindow: {
			completedAt: input.completedAt,
			startedAt: input.startedAt,
		},
		eventIds: {
			appApi: input.appApiEventId,
			campusWebBrowser: input.browserEventId,
			campusWebEdge: input.edgeEventId,
		},
		requestId: input.requestId,
		schemaVersion: 1,
		sentinelSha256: input.sentinelSha256,
		sentinels: {
			body: input.sentinels.body,
			credential: input.sentinels.credential,
			header: input.sentinels.header,
			query: input.sentinels.query,
			user: input.sentinels.user,
		},
		runtimeTraceId: input.runtimeTraceId,
	};
	if (JSON.stringify(evidence).includes(input.smokeAuthSecret)) {
		throw new Error(
			"Observability canary evidence must not contain the staging smoke auth secret.",
		);
	}
	return evidence;
}

export async function writeStagingObservabilityCanaryEvidence(
	path: string,
	evidence: StagingObservabilityCanaryEvidence,
	smokeAuthSecret: string,
): Promise<void> {
	const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
	if (!smokeAuthSecret || serialized.includes(smokeAuthSecret)) {
		throw new Error(
			"Observability canary evidence must not contain the staging smoke auth secret.",
		);
	}
	await mkdir(dirname(path), { mode: 0o700, recursive: true });
	const temporaryPath = `${path}.${process.pid}.tmp`;
	try {
		await writeFile(temporaryPath, serialized, { mode: 0o600 });
		await rename(temporaryPath, path);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}
