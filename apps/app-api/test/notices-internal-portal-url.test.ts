import { describe, expect, it } from "vitest";
import { buildInternalPortalAttachmentUrl } from "../src/modules/notices/internal-portal-url";

describe("internal portal attachment URL", () => {
	it("builds the portal download route from the notice and annex identifiers", () => {
		expect(buildInternalPortalAttachmentUrl({ noticeId: "358159", portalAnnexId: "annex 1" })).toBe(
			"https://my.muc.edu.cn/comsys-portal-notice-web/download?id=annex+1&notice_id=358159",
		);
	});
});
