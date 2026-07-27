import { Context } from "@temporalio/activity";
import type { InternalPortalFileReleaseCaptureResult } from "ingestion-contracts";

import { resolveInternalPortalConfig } from "../adapters/internal-portal/src/config.ts";
import { captureInternalPortalFileRelease } from "../adapters/internal-portal/src/file-release-capture.ts";
import type { SourceCollectorObjectStore } from "./object-store.ts";

export interface SourceCollectorActivityDependencies {
	env: Record<string, string | undefined>;
	objectStore: SourceCollectorObjectStore;
}

export interface InternalPortalFileReleaseCaptureActivityInput {
	fileReleaseId: number;
}

export function createSourceCollectorActivities(input: SourceCollectorActivityDependencies) {
	return {
		async captureInternalPortalFileRelease(
			activityInput: InternalPortalFileReleaseCaptureActivityInput,
		): Promise<InternalPortalFileReleaseCaptureResult> {
			const context = Context.current();
			const heartbeat = () =>
				context.heartbeat({ file_release_id: activityInput.fileReleaseId, phase: "capture" });
			heartbeat();
			const heartbeatTimer = setInterval(heartbeat, 10_000);
			heartbeatTimer.unref();
			try {
				return await captureInternalPortalFileRelease({
					abortSignal: context.cancellationSignal,
					config: resolveInternalPortalConfig(input.env),
					fileReleaseId: activityInput.fileReleaseId,
					objectStore: input.objectStore,
				});
			} finally {
				clearInterval(heartbeatTimer);
			}
		},
	};
}
