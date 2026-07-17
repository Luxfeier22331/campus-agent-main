import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
	type ChatMemoryE2eStagingResult,
	runChatMemoryE2eStaging,
} from "../../apps/app-api/e2e/chat-memory-staging";
import {
	DEFAULT_STAGING_CHAT_E2E_APP_API_READYZ_URL,
	DEFAULT_STAGING_CHAT_E2E_CHAT_BASE_URL,
} from "../../apps/app-api/e2e/support/chat-e2e.args";
import {
	parseStagingSentryCanaryArgs,
	runStagingSentryCanary,
	type StagingSentryCanaryArgs,
	type StagingSentryCanaryInput,
	type StagingSentryCanaryResult,
} from "../../apps/campus-web/e2e/staging-sentry-canary";
import {
	buildStagingObservabilityCanaryEvidence,
	createStagingObservabilityCanarySentinels,
	type StagingObservabilityCanaryEvidence,
	writeStagingObservabilityCanaryEvidence,
} from "../../apps/campus-web/e2e/support/staging-sentry-canary-evidence";
import {
	hashCanonicalSentryCanarySentinels,
	type SentryCanarySentinels,
} from "../../apps/campus-web/src/platform/telemetry/sentry-canary";

interface ObservabilityStagingArgs {
	appApiReadyzUrl: string;
	chatBaseUrl: string;
	sentry: StagingSentryCanaryArgs;
}

export interface ObservabilityStagingDependencies {
	createSentinels?: () => SentryCanarySentinels;
	now?: () => Date;
	removeEvidence?: (path: string) => Promise<void>;
	runChatMemory?: (argv: string[], env: NodeJS.ProcessEnv) => Promise<ChatMemoryE2eStagingResult>;
	runSentryCanary?: (
		args: StagingSentryCanaryArgs,
		input: StagingSentryCanaryInput,
	) => Promise<StagingSentryCanaryResult>;
	writeEvidence?: (
		path: string,
		evidence: StagingObservabilityCanaryEvidence,
		smokeAuthSecret: string,
	) => Promise<void>;
}

function optionalValue(value: string | undefined): string | null {
	const normalized = value?.trim();
	return normalized ? normalized : null;
}

export function parseObservabilityStagingArgs(
	argv: string[],
	env: NodeJS.ProcessEnv = process.env,
): ObservabilityStagingArgs {
	let appApiReadyzUrl = DEFAULT_STAGING_CHAT_E2E_APP_API_READYZ_URL;
	let chatBaseUrl = DEFAULT_STAGING_CHAT_E2E_CHAT_BASE_URL;
	const sentryArgv: string[] = [];

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--") {
			continue;
		}
		if (token === "--app-api-readyz-url" || token === "--chat-base-url") {
			const value = optionalValue(argv[index + 1]);
			if (!value) {
				throw new Error(`${token} requires a non-empty value.`);
			}
			if (token === "--app-api-readyz-url") {
				appApiReadyzUrl = new URL(value).toString();
			} else {
				chatBaseUrl = new URL(value).origin;
			}
			index += 1;
			continue;
		}

		sentryArgv.push(token);
		if (token === "--campus-base-url" || token === "--evidence-path") {
			const value = argv[index + 1];
			if (value !== undefined) {
				sentryArgv.push(value);
				index += 1;
			}
		}
	}

	return {
		appApiReadyzUrl,
		chatBaseUrl,
		sentry: parseStagingSentryCanaryArgs(sentryArgv, env),
	};
}

export async function runObservabilityStaging(
	argv: string[],
	env: NodeJS.ProcessEnv = process.env,
	deps: ObservabilityStagingDependencies = {},
): Promise<StagingObservabilityCanaryEvidence> {
	const args = parseObservabilityStagingArgs(argv, env);
	const createSentinels = deps.createSentinels ?? createStagingObservabilityCanarySentinels;
	const now = deps.now ?? (() => new Date());
	const removeEvidence = deps.removeEvidence ?? ((path) => rm(path, { force: true }));
	const runChatMemory = deps.runChatMemory ?? runChatMemoryE2eStaging;
	const runSentryCanary = deps.runSentryCanary ?? runStagingSentryCanary;
	const writeEvidence = deps.writeEvidence ?? writeStagingObservabilityCanaryEvidence;

	const startedAt = now().toISOString();
	await removeEvidence(args.sentry.evidencePath);
	const sentinels = createSentinels();
	const sentinelSha256 = await hashCanonicalSentryCanarySentinels(sentinels);
	const chat = await runChatMemory(
		[
			"--app-api-readyz-url",
			args.appApiReadyzUrl,
			"--chat-base-url",
			args.chatBaseUrl,
			"--memory-value",
			sentinels.body,
			"--name",
			sentinels.user,
			"--observability-canary-header-sentinel",
			sentinels.header,
			"--observability-canary-api-key-sentinel",
			sentinels.credential,
			"--prompt",
			`请根据已保存的个人记忆处理本次查询标识 ${sentinels.query}。`,
		],
		env,
	);
	if (!(chat.passed && chat.submit)) {
		throw new Error("Chat memory staging smoke did not return a completed request identity.");
	}

	const sentry = await runSentryCanary(args.sentry, {
		productRequestId: chat.submit.requestId,
		runtimeTraceId: chat.submit.runtimeTraceId,
		sentinels,
	});
	if (sentry.sentinelSha256 !== sentinelSha256) {
		throw new Error("Sentry canary did not preserve the shared canonical sentinel hash.");
	}

	const evidence = buildStagingObservabilityCanaryEvidence({
		appApiEventId: sentry.appApiEventId,
		appApiRelease: sentry.appApiRelease,
		browserEventId: sentry.browserEventId,
		campusWebRelease: sentry.campusWebRelease,
		completedAt: now().toISOString(),
		edgeEventId: sentry.edgeEventId,
		requestId: chat.submit.requestId,
		runtimeTraceId: chat.submit.runtimeTraceId,
		sentinelSha256,
		sentinels,
		smokeAuthSecret: args.sentry.smokeAuthSecret,
		startedAt,
	});
	await writeEvidence(args.sentry.evidencePath, evidence, args.sentry.smokeAuthSecret);
	console.info(`Wrote staging observability canary evidence to ${args.sentry.evidencePath}.`);
	return evidence;
}

export async function main(
	argv: string[] = process.argv.slice(2),
	env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
	await runObservabilityStaging(argv, env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	await main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
