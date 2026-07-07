import {
	type AuthenticatedNoticeNoticeFamilyConfig,
	materializeAuthenticatedFileReleaseSourceTruthFromTask,
	materializeAuthenticatedNoticeSourceTruthFromTask,
	type ObjectStore,
	resolveOfficialWebSourceTruthRefsFromTask,
	resolveWeChatOfficialAccountSourceTruthRefsFromTask,
} from "ingest-core";

import type { TsTaskHandler, TsTaskHandlerResult } from "./task-executor";

export type IngestionObjectStore = ObjectStore;

export function createAuthenticatedNoticeSourceTruthMaterializeHandler(input: {
	noticeFamilyConfig: AuthenticatedNoticeNoticeFamilyConfig;
	objectStore: IngestionObjectStore;
}): TsTaskHandler {
	return async (task): Promise<TsTaskHandlerResult> => ({
		artifactRefs: await materializeAuthenticatedNoticeSourceTruthFromTask({
			noticeFamilyConfig: input.noticeFamilyConfig,
			objectStore: input.objectStore,
			task,
		}),
	});
}

export function createAuthenticatedFileReleaseSourceTruthMaterializeHandler(input: {
	objectStore: IngestionObjectStore;
}): TsTaskHandler {
	return async (task): Promise<TsTaskHandlerResult> => ({
		artifactRefs: await materializeAuthenticatedFileReleaseSourceTruthFromTask({
			objectStore: input.objectStore,
			task,
		}),
	});
}

export function createOfficialWebSourceTruthMaterializeHandler(input: {
	objectStore: IngestionObjectStore;
}): TsTaskHandler {
	return async (task): Promise<TsTaskHandlerResult> => ({
		artifactRefs: await resolveOfficialWebSourceTruthRefsFromTask({
			objectStore: input.objectStore,
			task,
		}),
	});
}

export function createWeChatOfficialAccountSourceTruthMaterializeHandler(input: {
	objectStore: IngestionObjectStore;
}): TsTaskHandler {
	return async (task): Promise<TsTaskHandlerResult> => ({
		artifactRefs: await resolveWeChatOfficialAccountSourceTruthRefsFromTask({
			objectStore: input.objectStore,
			task,
		}),
	});
}
