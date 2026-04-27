import {
	buildWeChatOfficialAccountArticleSourceTruthMaterialsFromFeedWePage,
	type WeChatOfficialAccountArticleSourceTruthMaterial,
} from "wechat-official-account-core";

import type { WeChatOfficialAccountArtifactStore } from "./artifact-store.ts";
import type { WeChatOfficialAccountCaptureArtifactRef } from "./capture.ts";

export interface ReplayFeedWeProviderResponseSourceTruthInput {
	accountName: string;
	accountSlug: string;
	artifactStore: WeChatOfficialAccountArtifactStore;
	capturedAt: string;
	providerResponseJsonl: string;
}

export interface ReplayFeedWeProviderResponseSourceTruthResult {
	artifacts: WeChatOfficialAccountCaptureArtifactRef[];
	summary: {
		articlesMaterialized: number;
		sourceTruthArtifacts: number;
	};
}

export async function replayFeedWeProviderResponseSourceTruth(
	input: ReplayFeedWeProviderResponseSourceTruthInput,
): Promise<ReplayFeedWeProviderResponseSourceTruthResult> {
	const materials = parseProviderResponsePages(input.providerResponseJsonl).flatMap((rawPage) =>
		buildWeChatOfficialAccountArticleSourceTruthMaterialsFromFeedWePage({
			accountName: input.accountName,
			accountSlug: input.accountSlug,
			capturedAt: input.capturedAt,
			page: { raw: rawPage },
		}),
	);
	const artifacts = await writeWeChatOfficialAccountSourceTruthArtifacts({
		artifactStore: input.artifactStore,
		materials,
	});
	return {
		artifacts,
		summary: {
			articlesMaterialized: materials.length,
			sourceTruthArtifacts: artifacts.length,
		},
	};
}

export async function writeWeChatOfficialAccountSourceTruthArtifacts(input: {
	artifactStore: WeChatOfficialAccountArtifactStore;
	materials: WeChatOfficialAccountArticleSourceTruthMaterial[];
}): Promise<WeChatOfficialAccountCaptureArtifactRef[]> {
	const refs: WeChatOfficialAccountCaptureArtifactRef[] = [];
	for (const material of input.materials) {
		for (const artifact of material.artifacts) {
			const stored = await input.artifactStore.putObject({
				contentType: artifact.contentType,
				data: artifact.data,
				objectKey: artifact.objectKey,
				recordCount: artifact.recordCount,
			});
			refs.push({
				...stored,
				artifactType: artifact.artifactType,
			});
		}
	}
	return refs;
}

function parseProviderResponsePages(value: string): Record<string, unknown>[] {
	return value
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line, index) => {
			const parsed = JSON.parse(line) as unknown;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error(`provider response JSONL line ${index + 1} must be an object`);
			}
			return parsed as Record<string, unknown>;
		});
}
