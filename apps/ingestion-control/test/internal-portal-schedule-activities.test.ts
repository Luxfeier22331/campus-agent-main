import { describe, expect, it, vi } from "vitest";
import {
	INTERNAL_PORTAL_NOTICE_PUBLICATION_CREDENTIAL_EXPIRED_NOTE,
	INTERNAL_PORTAL_NOTICE_PUBLICATION_MANUAL_PAUSE_NOTE,
} from "../src/internal-portal-publication";
import { createInternalPortalScheduleActivities } from "../src/internal-portal-schedule-activities";

describe("internal portal schedule activities", () => {
	it("resumes a notice schedule after credential validation", async () => {
		const unpause = vi.fn(async () => undefined);
		const activities = createInternalPortalScheduleActivities({
			client: clientWithState(
				{ note: INTERNAL_PORTAL_NOTICE_PUBLICATION_CREDENTIAL_EXPIRED_NOTE, paused: true },
				unpause,
			),
		});

		await expect(activities.activateInternalPortalNoticePublication()).resolves.toBe("resumed");
		expect(unpause).toHaveBeenCalledWith("credential validated by auth maintenance");
	});

	it("preserves an explicit operator pause", async () => {
		const unpause = vi.fn(async () => undefined);
		const activities = createInternalPortalScheduleActivities({
			client: clientWithState(
				{ note: INTERNAL_PORTAL_NOTICE_PUBLICATION_MANUAL_PAUSE_NOTE, paused: true },
				unpause,
			),
		});

		await expect(activities.activateInternalPortalNoticePublication()).resolves.toBe(
			"manual_pause_preserved",
		);
		expect(unpause).not.toHaveBeenCalled();
	});

	it("leaves an active notice schedule unchanged", async () => {
		const unpause = vi.fn(async () => undefined);
		const activities = createInternalPortalScheduleActivities({
			client: clientWithState({ paused: false }, unpause),
		});

		await expect(activities.activateInternalPortalNoticePublication()).resolves.toBe(
			"already_active",
		);
		expect(unpause).not.toHaveBeenCalled();
	});

	it("preserves a pause caused by a correctness failure", async () => {
		const unpause = vi.fn(async () => undefined);
		const activities = createInternalPortalScheduleActivities({
			client: clientWithState({ note: "Workflow failed", paused: true }, unpause),
		});

		await expect(activities.activateInternalPortalNoticePublication()).resolves.toBe(
			"failure_pause_preserved",
		);
		expect(unpause).not.toHaveBeenCalled();
	});

	it("pauses publication with an explicit credential reason", async () => {
		const pause = vi.fn(async () => undefined);
		const activities = createInternalPortalScheduleActivities({
			client: clientWithState(
				{ paused: false },
				vi.fn(async () => undefined),
				pause,
			),
		});

		await activities.pauseInternalPortalNoticePublicationForCredential(
			"internal_portal_credential_expired",
		);
		expect(pause).toHaveBeenCalledWith(INTERNAL_PORTAL_NOTICE_PUBLICATION_CREDENTIAL_EXPIRED_NOTE);
	});
});

function clientWithState(
	state: { note?: string; paused: boolean },
	unpause: (note?: string) => Promise<void>,
	pause: (note?: string) => Promise<void> = async () => undefined,
) {
	return {
		schedule: {
			getHandle: () => ({ describe: async () => ({ state }), pause, unpause }),
		},
	};
}
