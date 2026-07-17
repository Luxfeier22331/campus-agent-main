import { describe, expect, it } from "vitest";

import { recordFromFieldMap } from "../src/field-mapping";

describe("Feishu dining review field mapping", () => {
	it("maps OpenAPI fields while retaining the record submission time", () => {
		const parsed = recordFromFieldMap({
			fields: new Map<string, unknown>([
				["fldGE8Z5vG", { text: "海淀校区" }],
				["fldmJk9inX", { name: "第三食堂" }],
				["fldPRZItgB", "东北风味"],
				["flduqrX7Ab", "锅包肉"],
				["fldomqSoKM", "10"],
				["fldOWOVRMX", "5"],
				["fldIBfi1eC", "味道不错"],
				["fldyqctdoB", []],
				["fldHJzHJpX", "果小生"],
			]),
			sourceRecordId: "rec27Dpakq3km1",
			submittedAt: "2026-07-01T08:00:00.000Z",
		});

		expect(parsed).toMatchObject({
			campus: "海淀校区",
			dishName: "锅包肉",
			hallName: "第三食堂",
			paidPriceLabel: "10 元",
			rating: 5,
			stallName: "东北风味",
			submittedAt: "2026-07-01T08:00:00.000Z",
		});
	});
});
