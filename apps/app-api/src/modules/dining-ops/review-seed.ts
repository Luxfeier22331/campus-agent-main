import type { DiningReview } from "./types";

export const STATIC_DINING_REVIEW_SEED: DiningReview[] = [
	createReview({
		campus: "海淀校区",
		comment: "味道不错",
		contributorName: "果小生",
		dishName: "锅包肉",
		hallId: "haidian-canteen-3",
		hallName: "海淀三食堂",
		paidPriceLabel: "10 元",
		rating: null,
		sourceRecordId: "rec27Dpakq3km1",
		stallName: "东北风味",
	}),
	createReview({
		campus: "海淀校区",
		comment: null,
		contributorName: "果小生",
		dishName: "铁板肉沫土豆",
		hallId: "haidian-canteen-1",
		hallName: "海淀一食堂",
		paidPriceLabel: "13 元",
		rating: 5,
		sourceRecordId: "rec27DpeYPIFru",
		stallName: "进门就是",
	}),
	createReview({
		campus: "丰台校区",
		comment: "薯条非常松脆，我就是为了薯条才来的，可以选择番茄酱或者其他撒粉",
		contributorName: "果小生",
		dishName: "摇多多",
		hallId: "fengtai-juya-canteen",
		hallName: "聚雅食堂",
		paidPriceLabel: "10 元",
		rating: 4,
		sourceRecordId: "rec27Dph0spQzm",
		stallName: "西式风味",
	}),
	createReview({
		campus: "海淀校区",
		comment: "有一点辣，有一点酸。现煮的，需要等几分钟（不到五分钟吧）。分量比较大，能吃撑我。",
		contributorName: "果小生",
		dishName: "金汤鱼粉",
		hallId: "haidian-canteen-1",
		hallName: "海淀一食堂",
		paidPriceLabel: "12 元",
		rating: 4,
		sourceRecordId: "rec27DpktN6uQn",
		stallName: "鱼粉",
	}),
	createReview({
		campus: "海淀校区",
		comment: "味道一般般，酸笋少而且酸的感觉像化学品；没有很大的臭味；粉分量够大，能吃饱。",
		contributorName: "果小生",
		dishName: "螺蛳粉（不加炸蛋）",
		hallId: "haidian-canteen-1",
		hallName: "海淀一食堂",
		paidPriceLabel: "12 元",
		rating: 4,
		sourceRecordId: "rec27DJv88QQlY",
		stallName: "螺蛳粉",
	}),
	createReview({
		campus: "海淀校区",
		comment: "酱味恰当，分量一般，价格适中",
		contributorName: "兰抑",
		dishName: "土耳其鸡肉炒饭",
		hallId: "haidian-canteen-4",
		hallName: "海淀四食堂",
		paidPriceLabel: "14 元",
		rating: 4,
		sourceRecordId: "rec27DJMSZYogx",
		stallName: "干锅窗口",
	}),
];

function createReview(
	input: Omit<DiningReview, "images" | "reviewId"> & {
		images?: DiningReview["images"];
	},
): DiningReview {
	return {
		...input,
		images: input.images ?? [],
		reviewId: `dining-review:${input.sourceRecordId}`,
	};
}
