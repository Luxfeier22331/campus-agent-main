import {
	type AuthenticatedNoticeNoticeFamilyConfig,
	DEFAULT_EXECUTABLE_TS_TASK_IDENTITIES,
	type TsTaskHandlerIdentity,
} from "ingest-core";
import {
	createAuthenticatedFileReleaseSourceTruthMaterializeHandler,
	createAuthenticatedNoticeSourceTruthMaterializeHandler,
	createOfficialWebSourceTruthMaterializeHandler,
	createWeChatOfficialAccountSourceTruthMaterializeHandler,
	type IngestionObjectStore,
} from "./source-truth-handlers";
import { TsTaskHandlerRegistry } from "./task-executor";

export interface DefaultTsTaskHandlerRegistryOptions {
	authenticatedNoticeFamilyConfig?: AuthenticatedNoticeNoticeFamilyConfig;
	authenticatedNoticeObjectStore?: IngestionObjectStore;
	officialWebObjectStore?: IngestionObjectStore;
	wechatOfficialAccountObjectStore?: IngestionObjectStore;
}

export function createDefaultTsTaskHandlerRegistry(
	options: DefaultTsTaskHandlerRegistryOptions = {},
): TsTaskHandlerRegistry {
	const registry = new TsTaskHandlerRegistry();
	if (options.authenticatedNoticeObjectStore && options.authenticatedNoticeFamilyConfig) {
		registry.register(
			requireDefaultTsTaskIdentity(
				"authenticated_notice/campus_notices/internal_notice/source_truth_materialize",
			),
			createAuthenticatedNoticeSourceTruthMaterializeHandler({
				noticeFamilyConfig: options.authenticatedNoticeFamilyConfig,
				objectStore: options.authenticatedNoticeObjectStore,
			}),
		);
	}
	if (options.authenticatedNoticeObjectStore) {
		registry.register(
			requireDefaultTsTaskIdentity(
				"authenticated_notice/authenticated_documents/file_release_source/source_truth_materialize",
			),
			createAuthenticatedFileReleaseSourceTruthMaterializeHandler({
				objectStore: options.authenticatedNoticeObjectStore,
			}),
		);
	}
	if (options.officialWebObjectStore) {
		for (const collection of ["fresh_news", "stable_reference"]) {
			registry.register(
				requireDefaultTsTaskIdentity(
					`official_web/official_web/${collection}/source_truth_materialize`,
				),
				createOfficialWebSourceTruthMaterializeHandler({
					objectStore: options.officialWebObjectStore,
				}),
			);
		}
	}
	if (options.wechatOfficialAccountObjectStore) {
		registry.register(
			requireDefaultTsTaskIdentity(
				"wechat_public_notice/campus_notices/wechat_public_notice/source_truth_materialize",
			),
			createWeChatOfficialAccountSourceTruthMaterializeHandler({
				objectStore: options.wechatOfficialAccountObjectStore,
			}),
		);
	}
	return registry;
}

export function createAuthenticatedNoticeTsTaskHandlerRegistry(input: {
	noticeFamilyConfig: AuthenticatedNoticeNoticeFamilyConfig;
	objectStore: IngestionObjectStore;
}): TsTaskHandlerRegistry {
	const registry = new TsTaskHandlerRegistry();
	registry.register(
		requireDefaultTsTaskIdentity(
			"authenticated_notice/campus_notices/internal_notice/source_truth_materialize",
		),
		createAuthenticatedNoticeSourceTruthMaterializeHandler(input),
	);
	return registry;
}

function requireDefaultTsTaskIdentity(identity: string): TsTaskHandlerIdentity {
	const match = DEFAULT_EXECUTABLE_TS_TASK_IDENTITIES.find(
		(candidate) =>
			[
				candidate.sourceFamily,
				candidate.corpus,
				candidate.collection,
				candidate.registryTaskId,
			].join("/") === identity,
	);
	if (!match) {
		throw new Error(`default TS task identity is not declared: ${identity}`);
	}
	return match;
}
