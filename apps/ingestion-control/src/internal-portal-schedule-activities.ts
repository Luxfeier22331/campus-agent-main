import { ScheduleNotFoundError } from "@temporalio/client";

import {
	INTERNAL_PORTAL_NOTICE_PUBLICATION_AUTH_VALIDATED_NOTE,
	INTERNAL_PORTAL_NOTICE_PUBLICATION_CREDENTIAL_EXPIRED_NOTE,
	INTERNAL_PORTAL_NOTICE_PUBLICATION_CREDENTIAL_UNAVAILABLE_NOTE,
	INTERNAL_PORTAL_NOTICE_PUBLICATION_INITIAL_PAUSE_NOTE,
	INTERNAL_PORTAL_NOTICE_PUBLICATION_MANUAL_PAUSE_NOTE,
	INTERNAL_PORTAL_NOTICE_PUBLICATION_SCHEDULE_ID,
} from "./internal-portal-publication";

interface NoticeScheduleHandle {
	describe(): Promise<{ state: { note?: string; paused: boolean } }>;
	pause(note?: string): Promise<void>;
	unpause(note?: string): Promise<void>;
}

export interface InternalPortalScheduleClient {
	schedule: {
		getHandle(scheduleId: string): NoticeScheduleHandle;
	};
}

export interface InternalPortalScheduleActivities {
	activateInternalPortalNoticePublication(): Promise<
		"already_active" | "failure_pause_preserved" | "manual_pause_preserved" | "resumed"
	>;
	pauseInternalPortalNoticePublicationForCredential(
		errorCode: "internal_portal_credential_expired" | "internal_portal_credential_unavailable",
	): Promise<void>;
}

export function createInternalPortalScheduleActivities(input: {
	client: InternalPortalScheduleClient;
}): InternalPortalScheduleActivities {
	return {
		async activateInternalPortalNoticePublication() {
			const handle = input.client.schedule.getHandle(
				INTERNAL_PORTAL_NOTICE_PUBLICATION_SCHEDULE_ID,
			);
			let description: Awaited<ReturnType<NoticeScheduleHandle["describe"]>>;
			try {
				description = await handle.describe();
			} catch (error) {
				if (error instanceof ScheduleNotFoundError) {
					throw new Error("internal portal notice publication schedule is missing", {
						cause: error,
					});
				}
				throw error;
			}
			if (!description.state.paused) {
				return "already_active";
			}
			if (description.state.note === INTERNAL_PORTAL_NOTICE_PUBLICATION_MANUAL_PAUSE_NOTE) {
				return "manual_pause_preserved";
			}
			if (
				description.state.note !== INTERNAL_PORTAL_NOTICE_PUBLICATION_INITIAL_PAUSE_NOTE &&
				description.state.note !== INTERNAL_PORTAL_NOTICE_PUBLICATION_CREDENTIAL_EXPIRED_NOTE &&
				description.state.note !== INTERNAL_PORTAL_NOTICE_PUBLICATION_CREDENTIAL_UNAVAILABLE_NOTE
			) {
				return "failure_pause_preserved";
			}
			await handle.unpause(INTERNAL_PORTAL_NOTICE_PUBLICATION_AUTH_VALIDATED_NOTE);
			return "resumed";
		},
		async pauseInternalPortalNoticePublicationForCredential(errorCode) {
			const handle = input.client.schedule.getHandle(
				INTERNAL_PORTAL_NOTICE_PUBLICATION_SCHEDULE_ID,
			);
			await handle.pause(
				errorCode === "internal_portal_credential_expired"
					? INTERNAL_PORTAL_NOTICE_PUBLICATION_CREDENTIAL_EXPIRED_NOTE
					: INTERNAL_PORTAL_NOTICE_PUBLICATION_CREDENTIAL_UNAVAILABLE_NOTE,
			);
		},
	};
}
