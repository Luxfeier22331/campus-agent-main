import { createDiningFloorplanScaffoldDraft } from "./floorplan-scaffold";
import { sha256Tag, stableJson } from "./hash";
import { buildPublishedSnapshot } from "./projection";
import type { DiningPublication, DiningRelease } from "./release-types";
import { DINING_SYSTEM_SOURCE } from "./state-factory";
import type {
	DiningCatalog,
	DiningDraft,
	DiningMenuItem,
	DiningMenuOffering,
	DiningPublishedSnapshot,
	DiningReview,
	DiningStallProfile,
	DiningWindowAssignment,
} from "./types";

export const DINING_DEV_SEED_RELEASE_ID = "dining_release:dev_seed";
const DEV_SEED_ACTOR = "system:dining-dev-seed";
const DEV_SEED_SOURCE = {
	label: "本地开发食堂种子",
	updatedAt: DINING_SYSTEM_SOURCE.updatedAt,
};

export interface DiningDevSeed {
	draft: DiningDraft;
	publication: DiningPublication;
	release: DiningRelease;
	reviews: DiningReview[];
	snapshot: DiningPublishedSnapshot;
}

export function createDevDiningSeed(): DiningDevSeed {
	const scaffold = createDiningFloorplanScaffoldDraft();
	const halls = DEV_SEED_HALL_IDS.map((hallId) => {
		const hall = scaffold.halls.find((item) => item.hallId === hallId);
		if (!hall) {
			throw new Error(`Dining dev seed hall scaffold is missing: ${hallId}.`);
		}
		if (hall.floors.length === 0) {
			throw new Error(`Dining dev seed hall has no floor scaffold: ${hallId}.`);
		}
		return hall;
	});
	const floorKeys = new Set(
		halls.flatMap((hall) =>
			hall.floors.map((floor) => floorKeyFor({ floorId: floor.floorId, hallId: hall.hallId })),
		),
	);
	const windows = scaffold.windows
		.filter((window) => floorKeys.has(floorKeyFor(window)))
		.map((window) => {
			const floorWindows = scaffold.windows.filter(
				(candidate) => candidate.hallId === window.hallId && candidate.floorId === window.floorId,
			);
			const seed =
				DEV_SEED_STALLS[floorWindows.findIndex((item) => item.windowId === window.windowId)];
			return {
				...window,
				tags: seed?.tags ?? [],
			};
		});
	const stallProfiles: DiningStallProfile[] = [];
	const assignments: DiningWindowAssignment[] = [];
	const menuItems: DiningMenuItem[] = [];
	const menuOfferings: DiningMenuOffering[] = [];

	for (const hall of halls) {
		for (const floor of hall.floors) {
			const floorWindows = windows.filter(
				(window) => window.hallId === hall.hallId && window.floorId === floor.floorId,
			);
			if (floorWindows.length === 0) {
				throw new Error(
					`Dining dev seed floor has no window scaffold: ${hall.hallId}/${floor.floorId}.`,
				);
			}
			for (const [index, seed] of DEV_SEED_STALLS.entries()) {
				const window = floorWindows[index];
				if (!window) {
					break;
				}
				const seedScope = `${hall.hallId}:${floor.floorId}:${index + 1}`;
				const stallProfileId = `stall:dev:${seedScope}`;
				const assignmentId = assignmentIdForWindow(window);
				stallProfiles.push({
					displayName: seed.displayName,
					stallProfileId,
					stallType: "food_window",
					status: "active",
					tags: seed.tags,
				});
				assignments.push({
					assignmentId,
					stallProfileId,
					status: "active",
					windowId: window.windowId,
				});
				for (const [offeringIndex, offering] of seed.offerings.entries()) {
					const menuItemId = `menu:dev:${seedScope}:${offeringIndex + 1}`;
					menuItems.push({
						menuItemId,
						name: offering.name,
						status: "active",
						tags: offering.tags,
					});
					menuOfferings.push({
						assignmentId,
						menuItemId,
						offeringId: `offering:${assignmentId}:${menuItemId}`,
						priceLabel: offering.priceLabel,
					});
				}
			}
			if (
				!assignments.some((assignment) =>
					floorWindows.some((window) => window.windowId === assignment.windowId),
				)
			) {
				throw new Error(
					`Dining dev seed floor has no assigned offering: ${hall.hallId}/${floor.floorId}.`,
				);
			}
		}
	}

	const reviews = buildDevReviewProjections({
		assignments,
		halls,
		menuItems,
		menuOfferings,
		stallProfiles,
		windows,
	});
	const draft: DiningDraft = {
		...scaffold,
		assignments,
		baseReleaseId: null,
		halls,
		menuItems,
		menuOfferings,
		revision: 1,
		stallProfiles,
		updatedAt: DEV_SEED_SOURCE.updatedAt,
		updatedBy: DEV_SEED_ACTOR,
		windows,
	};
	const snapshot = buildPublishedSnapshot(draft, DINING_DEV_SEED_RELEASE_ID, DEV_SEED_SOURCE);
	const release: DiningRelease = {
		createdAt: DEV_SEED_SOURCE.updatedAt,
		createdBy: DEV_SEED_ACTOR,
		draftRevision: draft.revision,
		notes: "本地开发食堂种子数据",
		predecessorReleaseId: null,
		releaseId: DINING_DEV_SEED_RELEASE_ID,
		rollbackOfReleaseId: null,
		snapshotHash: sha256Tag(stableJson(snapshot)),
		validation: {
			blockers: [],
			createdAt: DEV_SEED_SOURCE.updatedAt,
			draftRevision: draft.revision,
			status: "pass",
			summary: {
				assignmentCount: assignments.length,
				hallCount: halls.length,
				menuItemCount: menuItems.length,
				windowCount: windows.length,
			},
			warnings: [],
		},
	};
	return {
		draft: { ...draft, baseReleaseId: release.releaseId },
		publication: {
			catalogReleaseId: release.releaseId,
			reviewRevision: 1,
			updatedAt: DEV_SEED_SOURCE.updatedAt,
		},
		release,
		reviews,
		snapshot,
	};
}

const DEV_SEED_HALL_IDS = [
	"haidian-canteen-1",
	"haidian-canteen-2",
	"haidian-canteen-3",
	"haidian-canteen-4",
	"haidian-canteen-5",
	"fengtai-huixian-canteen",
	"fengtai-juya-canteen",
	"fengtai-outdoor-dining-zone",
] as const;

const DEV_SEED_STALLS = [
	{
		displayName: "鱼粉",
		offerings: [
			{ name: "金汤鱼粉", priceLabel: "12 元", tags: ["粉面"] },
			{ name: "清淡鱼粉", priceLabel: null, tags: ["清淡", "粉面"] },
			{ name: "酸菜鱼粉", priceLabel: "13 元", tags: ["粉面", "热餐"] },
		],
		tags: ["粉面"],
	},
	{
		displayName: "螺蛳粉",
		offerings: [
			{ name: "螺蛳粉", priceLabel: "12 元", tags: ["粉面", "热餐"] },
			{ name: "螺蛳粉（不加炸蛋）", priceLabel: null, tags: ["粉面", "热餐"] },
			{ name: "螺蛳粉（加腐竹）", priceLabel: "14 元", tags: ["粉面", "热餐"] },
		],
		tags: ["粉面", "热餐"],
	},
	{
		displayName: "热餐窗口",
		offerings: [
			{ name: "番茄牛腩饭", priceLabel: "18 元", tags: ["主食", "热餐"] },
			{ name: "时蔬套餐", priceLabel: null, tags: ["清淡", "热餐"] },
			{ name: "土豆烧鸡饭", priceLabel: "16 元", tags: ["主食", "热餐"] },
		],
		tags: ["主食", "热餐"],
	},
	flavorStall(
		"四川风味",
		[
			["川味小炒套餐", "16 元"],
			["麻婆豆腐饭", "13 元"],
			["回锅肉盖饭", "17 元"],
		],
		["主食", "热餐"],
	),
	flavorStall(
		"苏州风味",
		[
			["苏式焖肉饭", "17 元"],
			["苏式爆鱼面", "16 元"],
			["荠菜馄饨", "13 元"],
		],
		["主食", "热餐"],
	),
	flavorStall(
		"大阪风味",
		[
			["大阪烧套餐", "18 元"],
			["日式咖喱饭", "16 元"],
			["照烧鸡排饭", "18 元"],
		],
		["主食", "热餐"],
	),
	flavorStall(
		"巴黎风味",
		[
			["法式烩鸡饭", "18 元"],
			["奶油蘑菇意面", "17 元"],
			["香草烤鸡套餐", "19 元"],
		],
		["主食", "热餐"],
	),
	flavorStall(
		"兰州风味",
		[
			["兰州牛肉面", "15 元"],
			["牛肉炒面", "16 元"],
			["牛肉拌面", "16 元"],
		],
		["粉面", "热餐"],
	),
	flavorStall(
		"广式风味",
		[
			["广式烧腊饭", "18 元"],
			["叉烧滑蛋饭", "17 元"],
			["鲜虾云吞面", "16 元"],
		],
		["主食", "热餐"],
	),
	flavorStall(
		"湘味小炒",
		[
			["农家小炒肉", "17 元"],
			["剁椒鱼块饭", "18 元"],
			["香干炒肉饭", "16 元"],
		],
		["主食", "热餐"],
	),
	flavorStall(
		"闽南风味",
		[
			["沙茶肉片饭", "16 元"],
			["海蛎煎套餐", "18 元"],
			["闽南卤面", "15 元"],
		],
		["主食", "热餐"],
	),
	flavorStall(
		"云南风味",
		[
			["过桥米线", "15 元"],
			["小锅米线", "14 元"],
			["汽锅鸡套餐", "19 元"],
		],
		["粉面", "热餐"],
	),
	flavorStall(
		"新疆风味",
		[
			["新疆拌面", "17 元"],
			["大盘鸡拌面", "19 元"],
			["烤肉抓饭", "18 元"],
		],
		["粉面", "热餐"],
	),
	flavorStall(
		"陕西风味",
		[
			["油泼面", "14 元"],
			["肉夹馍套餐", "15 元"],
			["岐山臊子面", "15 元"],
		],
		["粉面", "热餐"],
	),
	flavorStall(
		"重庆风味",
		[
			["重庆小面", "13 元"],
			["豌杂面", "15 元"],
			["酸辣粉", "12 元"],
		],
		["粉面", "热餐"],
	),
	flavorStall(
		"东北风味",
		[
			["锅包肉套餐", "18 元"],
			["地三鲜盖饭", "14 元"],
			["酸菜白肉饭", "17 元"],
		],
		["主食", "热餐"],
	),
	flavorStall(
		"江南风味",
		[
			["笋干烧肉饭", "17 元"],
			["雪菜肉丝面", "14 元"],
			["菜饭骨头汤", "16 元"],
		],
		["主食", "热餐"],
	),
	flavorStall(
		"潮汕风味",
		[
			["潮汕卤味饭", "17 元"],
			["牛肉粿条", "16 元"],
			["潮汕砂锅粥", "18 元"],
		],
		["主食", "热餐"],
	),
	flavorStall(
		"客家风味",
		[
			["客家酿豆腐饭", "16 元"],
			["盐焗鸡饭", "18 元"],
			["梅菜扣肉饭", "17 元"],
		],
		["主食", "热餐"],
	),
	flavorStall(
		"北京风味",
		[
			["京酱肉丝饭", "16 元"],
			["老北京炸酱面", "14 元"],
			["宫保鸡丁饭", "16 元"],
		],
		["主食", "热餐"],
	),
	flavorStall(
		"天津风味",
		[
			["天津素卷套餐", "14 元"],
			["老豆腐烧饼", "12 元"],
			["天津打卤面", "14 元"],
		],
		["主食", "热餐"],
	),
	flavorStall(
		"山东风味",
		[
			["鲁味排骨饭", "18 元"],
			["鲅鱼水饺", "17 元"],
			["葱烧鸡饭", "16 元"],
		],
		["主食", "热餐"],
	),
	flavorStall(
		"河南风味",
		[
			["河南烩面", "15 元"],
			["胡辣汤套餐", "12 元"],
			["河南卤面", "14 元"],
		],
		["粉面", "热餐"],
	),
	flavorStall(
		"台湾风味",
		[
			["卤肉饭", "16 元"],
			["三杯鸡饭", "18 元"],
			["盐酥鸡饭", "17 元"],
		],
		["主食", "热餐"],
	),
	flavorStall(
		"东南亚风味",
		[
			["咖喱鸡饭", "17 元"],
			["海南鸡饭", "18 元"],
			["冬阴功汤面", "18 元"],
		],
		["主食", "热餐"],
	),
] satisfies Array<{
	displayName: string;
	offerings: Array<{ name: string; priceLabel: string | null; tags: string[] }>;
	tags: string[];
}>;

function flavorStall(
	displayName: string,
	offerings: [name: string, priceLabel: string | null][],
	tags: string[],
) {
	return {
		displayName,
		offerings: offerings.map(([name, priceLabel]) => ({ name, priceLabel, tags })),
		tags,
	};
}

function buildDevReviewProjections(input: {
	assignments: DiningWindowAssignment[];
	halls: DiningCatalog["halls"];
	menuItems: DiningMenuItem[];
	menuOfferings: DiningMenuOffering[];
	stallProfiles: DiningStallProfile[];
	windows: DiningCatalog["windows"];
}): DiningReview[] {
	const reviews: DiningReview[] = [];
	let reviewSequence = 0;
	for (const [assignmentIndex, assignment] of input.assignments.entries()) {
		const window = input.windows.find((item) => item.windowId === assignment.windowId);
		const hall = input.halls.find((item) => item.hallId === window?.hallId);
		const stall = input.stallProfiles.find(
			(item) => item.stallProfileId === assignment.stallProfileId,
		);
		const offerings = input.menuOfferings.filter(
			(item) => item.assignmentId === assignment.assignmentId,
		);
		if (!(window && hall && stall && offerings.length > 0)) {
			throw new Error(`Dining dev seed cannot build reviews for ${assignment.assignmentId}.`);
		}
		for (const [offeringIndex, offering] of offerings.entries()) {
			const menuItem = input.menuItems.find((item) => item.menuItemId === offering.menuItemId);
			if (!menuItem) {
				throw new Error(`Dining dev seed review menu item is missing: ${offering.menuItemId}.`);
			}
			reviews.push(
				createDevReview({
					assignmentIndex,
					hall,
					includeImage: offeringIndex === 0 && assignmentIndex % 4 === 0,
					menuItem,
					offering,
					reviewSequence: reviewSequence++,
					stall,
					variant: "primary",
					window,
				}),
			);
			if (offeringIndex === 0) {
				reviews.push(
					createDevReview({
						assignmentIndex,
						hall,
						includeImage: false,
						menuItem,
						offering,
						reviewSequence: reviewSequence++,
						stall,
						variant: "secondary",
						window,
					}),
				);
			}
		}
	}
	return reviews;
}

const DEV_REVIEW_PROFILES = [
	{ comment: "口味很稳，出餐速度也快，午餐高峰排队可以接受。", contributorName: "林川", rating: 5 },
	{ comment: "分量够一顿午饭，调味不会太重。", contributorName: "周宁", rating: 4 },
	{ comment: "刚出锅时口感最好，配菜也比较新鲜。", contributorName: "陈墨", rating: 5 },
	{ comment: "价格和分量匹配，下次还会再点。", contributorName: "叶青", rating: 4 },
	{ comment: "整体偏清淡，适合不想吃太油的时候。", contributorName: "许言", rating: 4 },
	{ comment: "高峰期等了几分钟，拿到手还是热的。", contributorName: "唐悦", rating: 4 },
] as const;

function createDevReview(input: {
	assignmentIndex: number;
	hall: DiningCatalog["halls"][number];
	includeImage: boolean;
	menuItem: DiningMenuItem;
	offering: DiningMenuOffering;
	reviewSequence: number;
	stall: DiningStallProfile;
	variant: "primary" | "secondary";
	window: DiningCatalog["windows"][number];
}): DiningReview {
	const profile = DEV_REVIEW_PROFILES[input.reviewSequence % DEV_REVIEW_PROFILES.length];
	if (!profile) {
		throw new Error("Dining dev review profile is missing.");
	}
	const hasEmptyOptionals = input.variant === "secondary" && input.assignmentIndex % 5 === 0;
	const reviewKey = `${input.offering.offeringId}:${input.variant}`;
	return {
		campus: input.hall.campus,
		comment:
			input.variant === "secondary" && input.assignmentIndex === 0
				? "口味比较清爽，蔬菜种类够多。午餐高峰期需要稍等，但拿到时温度和口感都很好，整体分量也合适。"
				: profile.comment,
		contributorName: hasEmptyOptionals ? null : profile.contributorName,
		dishName: input.menuItem.name,
		hallId: input.hall.hallId,
		hallName: input.hall.name,
		images: input.includeImage
			? [
					{
						alt: `${input.menuItem.name}评价图片`,
						imageId: `dining-review-image:${reviewKey}:1`,
						url: "/assets/dining/reviews/dev-meal.svg",
					},
				]
			: [],
		offeringId: input.offering.offeringId,
		paidPriceLabel: hasEmptyOptionals ? null : input.offering.priceLabel,
		rating: hasEmptyOptionals ? null : profile.rating,
		reviewId: `dining-review:${reviewKey}`,
		sourceRecordId: `dev:${reviewKey}`,
		stallName: input.stall.displayName,
		stallProfileId: input.stall.stallProfileId,
		submittedAt: new Date(
			Date.UTC(2026, 6, 15, 12) - input.reviewSequence * 21_600_000,
		).toISOString(),
		windowId: input.window.windowId,
	};
}

function assignmentIdForWindow(input: {
	floorId: string;
	hallId: string;
	windowId: string;
}): string {
	return `assignment:${input.hallId}:${input.floorId}:${input.windowId}`;
}

function floorKeyFor(input: { floorId: string; hallId: string }): string {
	return `${input.hallId}:${input.floorId}`;
}
