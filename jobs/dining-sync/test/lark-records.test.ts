import { describe, expect, it } from "vitest";
import { recordFromFieldMap } from "../src/field-mapping";
import { parseLarkRecordList } from "../src/lark-records";

describe("Lark record-list parsing", () => {
	it("zips record IDs with matrix cells by field ID", () => {
		const parsed = parseLarkRecordList({
			data: {
				data: [
					[
						"NO.005",
						["海淀校区"],
						["第一食堂"],
						"鱼粉",
						"金汤鱼粉",
						12,
						4,
						"有一点辣",
						[
							{
								file_token: "BwBpbNNU4oaCsXxGfUMcwrHsn0c",
								name: "-3f16931796b88838.jpg",
								size: 1465625,
							},
						],
						"果小生",
					],
				],
				field_id_list: [
					"fldc3WWRoB",
					"fldGE8Z5vG",
					"fldmJk9inX",
					"fldPRZItgB",
					"flduqrX7Ab",
					"fldomqSoKM",
					"fldOWOVRMX",
					"fldIBfi1eC",
					"fldyqctdoB",
					"fldHJzHJpX",
				],
				fields: [
					"ID",
					"请选择本次就餐所在校区",
					"请选择本次就餐所在食堂",
					"请填写档口名称",
					"请填写菜品名称",
					"请填写本次实际支付价格",
					"您愿意为这份菜品的推荐程度打几分？",
					"欢迎留下文字评价",
					"如方便，欢迎上传相关图片",
					"如愿意，请留下贡献署名",
				],
				record_id_list: ["rec27DpktN6uQn"],
			},
			ok: true,
		});

		expect(parsed).toEqual([
			{
				attachments: [
					{
						fileToken: "BwBpbNNU4oaCsXxGfUMcwrHsn0c",
						name: "-3f16931796b88838.jpg",
						size: 1465625,
					},
				],
				campus: "海淀校区",
				comment: "有一点辣",
				contributorName: "果小生",
				dishName: "金汤鱼粉",
				hallName: "第一食堂",
				paidPriceLabel: "12 元",
				rating: 4,
				sourceRecordId: "rec27DpktN6uQn",
				stallName: "鱼粉",
			},
		]);
	});

	it("fails closed when the matrix shape does not match field IDs", () => {
		expect(() =>
			parseLarkRecordList({
				data: {
					data: [["NO.001", "海淀校区"]],
					field_id_list: ["fldc3WWRoB"],
					fields: ["ID"],
					record_id_list: ["rec1"],
				},
				ok: true,
			}),
		).toThrow(/field count/i);
	});

	it("parses Feishu OpenAPI select objects after fields are mapped to IDs", () => {
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
		});

		expect(parsed).toMatchObject({
			campus: "海淀校区",
			dishName: "锅包肉",
			hallName: "第三食堂",
			paidPriceLabel: "10 元",
			rating: 5,
			stallName: "东北风味",
		});
	});
});
