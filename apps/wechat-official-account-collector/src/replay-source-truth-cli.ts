import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import {
	createWeChatOfficialAccountArtifactStoreFromEnv,
	normalizeWeChatAccountSlug,
	replayFeedWeProviderResponseSourceTruth,
} from "./index.ts";

export async function runReplaySourceTruthCli(
	argv: string[] = process.argv.slice(2),
	env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
	const { values } = parseArgs({
		allowPositionals: false,
		args: argv[0] === "--" ? argv.slice(1) : argv,
		options: {
			account: { type: "string" },
			"account-slug": { type: "string" },
			"captured-at": { type: "string" },
			"provider-response-path": { type: "string" },
		},
	});
	const accountName = required(values.account, "--account");
	const accountSlug = values["account-slug"]?.trim() || normalizeWeChatAccountSlug(accountName);
	const capturedAt = values["captured-at"]?.trim() || new Date().toISOString();
	const providerResponsePath = required(
		values["provider-response-path"],
		"--provider-response-path",
	);
	const artifactStore = createWeChatOfficialAccountArtifactStoreFromEnv(env);
	if (!artifactStore) {
		throw new Error("OBJECT_STORE_* source-bucket configuration is required.");
	}

	const result = await replayFeedWeProviderResponseSourceTruth({
		accountName,
		accountSlug,
		artifactStore,
		capturedAt,
		providerResponseJsonl: await readFile(providerResponsePath, "utf-8"),
	});
	console.log(
		JSON.stringify(
			{
				artifactCount: result.artifacts.length,
				artifacts: result.artifacts,
				summary: result.summary,
			},
			null,
			2,
		),
	);
}

function required(value: unknown, field: string): string {
	const normalized = typeof value === "string" ? value.trim() : "";
	if (!normalized) {
		throw new Error(`${field} is required.`);
	}
	return normalized;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runReplaySourceTruthCli().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
