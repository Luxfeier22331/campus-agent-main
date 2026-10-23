import { describe, expect, it } from "vitest";
import { buildInternalPortalNoticeUrl } from "../src/features/notices/internal-portal-url";

describe("internal portal notice URL", () => {
	it("builds the verified portal detail route from stored notice metadata", () => {
		expect(buildInternalPortalNoticeUrl({ noticeId: "358159", noticeType: 5 })).toBe(
			"https://my.muc.edu.cn/page/11#/print?notice_id=358159&show_type=1&type=5",
		);
	});
});
