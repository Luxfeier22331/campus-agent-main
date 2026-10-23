import type {
	DiningMapDraft,
	DiningMenuItemRecord,
	DiningOpsContentReportRecord,
	DiningOpsContentReviewEditRecord,
	DiningOpsContentReviewRecord,
} from "@campus-agent/dining/domain";
import {
	canonicalizeDiningFloorplanBundle,
	DINING_BOOTSTRAP_FLOORPLANS,
	type DiningFloorplanBundleV1,
} from "@campus-agent/dining/floorplans";
import { diningMapBundleFingerprint } from "@campus-agent/dining/publisher";
import { serve } from "@hono/node-server";
import { createOpsApp } from "../src/server/app.ts";
import type {
	DiningMapStore,
	DiningMenuStore,
	DiningOpsActor,
	DiningReviewStore,
} from "../src/server/dining-store-contract.ts";
import {
	DiningStoreConflictError,
	DiningStoreNotFoundError,
} from "../src/server/dining-store-errors.ts";
import { createNoticeJobService, type NoticeJobStore } from "../src/server/notice-jobs.ts";
import type { NoticeStore } from "../src/server/notice-store.ts";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission.ts";
import { createFixtureOpsStatusStore } from "../src/server/ops-status/store/fixture.ts";
import type { DiningReleaseSummary } from "../src/shared/dining-contract.ts";
import type {
	ExecutionModelSettingsStatus,
	NoticeClassificationBackend,
	NoticeClassificationCredentialUpdate,
	NoticeJob,
	NoticeSummary,
} from "../src/shared/ops-contract.ts";
import { opsOverviewFixture } from "../src/shared/ops-fixtures.ts";

const browserTestPort = Number(process.env.OPS_WEB_BROWSER_TEST_PORT ?? "4178");
const browserDiningStore = createBrowserDiningStore();
const browserDiningContentStore = createBrowserDiningContentStore();
const browserNoticeStore = createBrowserNoticeStore();
const browserNoticeJobStore = createBrowserNoticeJobStore();
const app = createOpsApp({
	admission: createAllowAllOpsAdmission({ email: "ops@example.test" }),
	env: {
		DEPLOYMENT_ENVIRONMENT: "local",
		OPS_WEB_AUTOMATION_ORIGIN:
			process.env.OPS_WEB_AUTOMATION_ORIGIN ?? `http://127.0.0.1:${browserTestPort + 1}`,
		OPS_WEB_CAMPUS_WEB_URL: "http://127.0.0.1:27014",
		OPS_WEB_PUBLIC_ORIGIN:
			process.env.OPS_WEB_PUBLIC_ORIGIN ?? `http://127.0.0.1:${browserTestPort}`,
	},
	overviewService: {
		getOverview: async () => opsOverviewFixture,
	},
	diningMapStore: browserDiningStore,
	diningMenuStore: browserDiningContentStore,
	diningReviewStore: browserDiningContentStore,
	noticeJobService: createNoticeJobService(browserNoticeJobStore),
	noticeStore: browserNoticeStore,
	noticePreviewStore: {
		async get(key) {
			const noticeId = Number(key.match(/\/(\d+)\.json$/u)?.[1]);
			const notice = await browserNoticeStore.get(noticeId);
			if (!notice) {
				throw new Error("Missing preview fixture");
			}
			const response = Response.json({
				schema_version: "internal_portal_notice_source.v2",
				notice_id: noticeId,
				notice_type: notice.noticeType.id,
				organization_id: notice.organization?.id ?? null,
				notice_title: notice.title,
				notice_release_time: "2026-08-23 18:00:00",
				is_external: notice.isExternal,
				external_url: notice.externalUrl,
				notice_content_html: notice.isExternal
					? null
					: "<p>请同学们按时完成学期注册。</p><table><tr><th>日期</th><th>地点</th></tr><tr><td>9月1日</td><td>教学楼</td></tr></table>",
				attachments: [],
			});
			if (!response.body) {
				throw new Error("Missing fixture body");
			}
			return { body: response.body, contentType: "application/json" };
		},
	},
	providerConfigClient: fixtureProviderConfigClient(),
	staticRoot: "dist",
	store: createFixtureOpsStatusStore(),
});

serve({
	fetch: (request) => {
		const ocrNotice = /^\/api\/ops\/ocr\/notices\/(\d+)$/u.exec(new URL(request.url).pathname);
		if (request.method === "GET" && ocrNotice) {
			return Response.json({ noticeId: ocrNotice[1], resources: [] });
		}
		if (request.method === "GET" && new URL(request.url).pathname.startsWith("/dining")) {
			browserDiningStore.reset();
			browserDiningContentStore.reset();
		}
		if (request.method === "GET" && new URL(request.url).pathname === "/notices") {
			browserNoticeStore.reset();
			browserNoticeJobStore.reset();
		}
		return app.fetch(request);
	},
	hostname: "127.0.0.1",
	port: browserTestPort,
});

function createBrowserNoticeStore(): NoticeStore & { reset(): void } {
	let notices: NoticeSummary[] = [];

	function reset() {
		notices = [
			{
				category: null,
				externalUrl: null,
				isExternal: false,
				noticeId: 354516,
				noticeType: { id: 5, name: "办公通知" },
				organization: { id: "org-1", name: "教务处" },
				releasedAt: "2026-08-23T10:00:00.000Z",
				state: "needs_classification",
				title: "关于 2026 年秋季学期注册安排的通知",
			},
			{
				category: "campus_operations",
				externalUrl: "https://campus.example.test/notices/354517",
				isExternal: true,
				noticeId: 354517,
				noticeType: { id: 7, name: "校园服务" },
				organization: { id: "org-2", name: "后勤处" },
				releasedAt: "2026-08-22T08:30:00.000Z",
				state: "needs_publication",
				title: "校园网络维护安排",
			},
			{
				category: "campus_news",
				externalUrl: null,
				isExternal: false,
				noticeId: 354518,
				noticeType: { id: 3, name: "校园动态" },
				organization: null,
				releasedAt: "2026-08-21T06:15:00.000Z",
				state: "published",
				title: "校园开放日活动回顾",
			},
		];
	}

	reset();
	return {
		reset,
		async get(noticeId) {
			const notice = notices.find((candidate) => candidate.noticeId === noticeId);
			return notice ? structuredClone(notice) : null;
		},
		async list(input) {
			const base = notices.filter((notice) => {
				if (input.category && notice.category !== input.category) {
					return false;
				}
				if (
					input.q &&
					!notice.title.toLocaleLowerCase().includes(input.q.toLocaleLowerCase()) &&
					String(notice.noticeId) !== input.q
				) {
					return false;
				}
				return true;
			});
			const counts = {
				all: base.length,
				needsClassification: base.filter((notice) => notice.state === "needs_classification")
					.length,
				needsPublication: base.filter((notice) => notice.state === "needs_publication").length,
				published: base.filter((notice) => notice.state === "published").length,
			};
			const filtered = input.state ? base.filter((notice) => notice.state === input.state) : base;
			const start = (input.page - 1) * 30;
			const items = filtered.slice(start, start + 30);
			return {
				counts,
				items: structuredClone(items),
				page: input.page,
				totalItems: filtered.length,
				totalPages: Math.ceil(filtered.length / 30),
			};
		},
		async updateCategory(noticeId, category) {
			const index = notices.findIndex((notice) => notice.noticeId === noticeId);
			const current = notices[index];
			if (!current) {
				throw new Error("Notice not found.");
			}
			const next = {
				...current,
				category,
				state: current.state === "published" ? "published" : "needs_publication",
			} satisfies NoticeSummary;
			notices[index] = next;
			return structuredClone(next);
		},
	};
}

function createBrowserNoticeJobStore(): NoticeJobStore & { reset(): void } {
	let sequence = 0;
	let jobs: NoticeJob[] = [];

	function reset() {
		sequence = 0;
		jobs = [];
	}

	reset();
	return {
		reset,
		async create(input) {
			const now = new Date("2026-08-26T06:00:00.000Z");
			const job: NoticeJob = {
				trigger: "manual",
				completedAt: null,
				createdAt: new Date(now.valueOf() + sequence++).toISOString(),
				controllerError: null,
				error: null,
				jobName: `${input.operation}-browser-${String(sequence)}`,
				maintenanceRange: null,
				noticeId: "noticeId" in input ? input.noticeId : null,
				operation: input.operation,
				processedRange: null,
				progress: null,
				startedAt: null,
				status: "pending",
				summary: null,
			};
			jobs = [job, ...jobs];
			return structuredClone(job);
		},
		async get(jobName) {
			const job = jobs.find((candidate) => candidate.jobName === jobName);
			return job ? structuredClone(job) : null;
		},
		async list() {
			return structuredClone(jobs);
		},
	};
}

function createBrowserDiningContentStore(): DiningMenuStore &
	DiningReviewStore & { reset(): void } {
	const firstLayout = DINING_BOOTSTRAP_FLOORPLANS.layouts[0];
	const firstWindow = firstLayout?.windows[0];
	if (!(firstLayout && firstWindow)) {
		throw new Error("Dining browser fixture needs one window.");
	}
	const firstWindowId = `${firstLayout.hallId}:${firstLayout.floorId}:${firstWindow.anchorId}`;
	let sequence = 2;
	let menuItems: DiningMenuItemRecord[] = [];
	let reviews: Extract<DiningOpsContentReviewRecord, { targetKind: "menu_item" }>[] = [];
	let reports: DiningOpsContentReportRecord[] = [];
	let edits = new Map<string, DiningOpsContentReviewEditRecord[]>();

	function reset() {
		sequence = 2;
		const firstMenuItem = menuItem("dmi_1", "牛肉面", "12 元", firstWindowId, 0);
		const secondMenuItem = menuItem("dmi_2", "鸡肉面", null, firstWindowId, 1);
		menuItems = [firstMenuItem, secondMenuItem];
		const firstReview = review("drv_1", firstMenuItem, "味道不错，出餐也很快。", "member", true);
		reviews = [firstReview, review("drv_2", secondMenuItem, "分量合适。", "operator", false)];
		reports = [
			{
				createdAt: "2026-07-24T08:10:00.000Z",
				details: "正文包含联系方式",
				reason: "privacy",
				reportId: "drp_1",
				reporterUserId: "user_2",
				resolution: null,
				resolvedAt: null,
				resolvedBy: null,
				target: {
					kind: "review",
					current: structuredClone(firstReview),
					targetRevision: 1,
					reported: { replayable: true, body: "味道不错，出餐也很快。" },
				},
			},
		];
		edits = new Map();
	}

	reset();
	return {
		reset,
		async archiveMenuItem(actor, menuItemId) {
			return updateMenu(menuItemId, { archivedAt: nextTime(), updatedBy: actor.principalId });
		},
		async createMenuItem(actor, input) {
			const item = menuItem(
				`dmi_${++sequence}`,
				input.name,
				input.priceText,
				input.windowId,
				menuItems.filter((candidate) => candidate.windowId === input.windowId).length,
			);
			item.createdBy = actor.principalId;
			item.updatedBy = actor.principalId;
			menuItems.push(item);
			return structuredClone(item);
		},
		async createReview(actor, input) {
			const item = requireMenu(input.menuItemId);
			const created = review(`drv_${++sequence}`, item, input.body, "operator", input.anonymous);
			created.authorDisplayName = actor.displayName;
			created.authorId = actor.principalId;
			reviews.unshift(created);
			return structuredClone(created);
		},
		async deleteOperatorReview(actor, reviewId) {
			const current = requireReview(reviewId);
			if (current.authorKind !== "operator") {
				throw new Error("Only operator reviews can be deleted.");
			}
			current.deletedAt = nextTime();
			current.updatedAt = current.deletedAt;
			current.updatedBy = actor.principalId;
		},
		async getReview(reviewId) {
			return {
				edits: structuredClone(edits.get(reviewId) ?? []),
				review: structuredClone(requireReview(reviewId)),
			};
		},
		async listMenuItems() {
			return structuredClone(menuItems);
		},
		async listReports(input) {
			return {
				items: structuredClone(
					reports.filter((report) =>
						input.status === "pending" ? !report.resolvedAt : Boolean(report.resolvedAt),
					),
				),
				nextCursor: null,
			};
		},
		async listReviews(input) {
			const query = input.q;
			const items = reviews.filter((candidate) => {
				if (input.menuItemId && candidate.menuItemId !== input.menuItemId) {
					return false;
				}
				if (input.windowId && candidate.windowId !== input.windowId) {
					return false;
				}
				if (
					query &&
					![candidate.body, candidate.authorDisplayName, candidate.menuItemName].some((value) =>
						value?.includes(query),
					)
				) {
					return false;
				}
				if (input.visibility === "visible") {
					return !(candidate.hiddenAt || candidate.deletedAt);
				}
				if (input.visibility === "hidden") {
					return Boolean(candidate.hiddenAt) && !candidate.deletedAt;
				}
				if (input.visibility === "deleted") {
					return Boolean(candidate.deletedAt);
				}
				return true;
			});
			return { items: structuredClone(items), nextCursor: null };
		},
		async moveMenuItem(actor, menuItemId, windowId) {
			return updateMenu(menuItemId, { updatedBy: actor.principalId, windowId });
		},
		async reorderMenuItems(actor, windowId, menuItemIds) {
			for (const [sortOrder, menuItemId] of menuItemIds.entries()) {
				updateMenu(menuItemId, { sortOrder, updatedBy: actor.principalId, windowId });
			}
			return structuredClone(menuItems.filter((item) => item.windowId === windowId));
		},
		async resolveReports(actor, reviewId, resolution) {
			const resolvedAt = nextTime();
			for (const report of reports) {
				if (
					report.target.kind === "review" &&
					report.target.current.reviewId === reviewId &&
					!report.resolvedAt
				) {
					report.resolution = resolution;
					report.resolvedAt = resolvedAt;
					report.resolvedBy = actor.principalId;
				}
			}
			if (resolution === "hide") {
				const current = requireReview(reviewId);
				current.hiddenAt = resolvedAt;
				current.hiddenBy = actor.principalId;
			}
		},
		async restoreMenuItem(actor, menuItemId) {
			return updateMenu(menuItemId, { archivedAt: null, updatedBy: actor.principalId });
		},
		async setReviewVisibility(actor, reviewId, visible) {
			const current = requireReview(reviewId);
			current.hiddenAt = visible ? null : nextTime();
			current.hiddenBy = visible ? null : actor.principalId;
			current.updatedAt = nextTime();
			current.updatedBy = actor.principalId;
			return structuredClone(current);
		},
		async updateMenuItem(actor, menuItemId, input) {
			return updateMenu(menuItemId, { ...input, updatedBy: actor.principalId });
		},
		async updateReview(actor, reviewId, body) {
			const current = requireReview(reviewId);
			const editedAt = nextTime();
			const history = edits.get(reviewId) ?? [];
			history.unshift({
				editId: `dre_${++sequence}`,
				editedAt,
				editedBy: actor.principalId,
				nextBody: body,
				previousBody: current.body ?? "",
				expiresAt: new Date(Date.parse(editedAt) + 30 * 86400000).toISOString(),
				previousRevision: current.contentRevision,
				nextRevision: current.contentRevision + 1,
				replayable: true,
			});
			edits.set(reviewId, history);
			current.body = body;
			current.contentRevision += 1;
			current.editCount = history.length;
			current.editedAt = editedAt;
			current.updatedAt = editedAt;
			current.updatedBy = actor.principalId;
			return structuredClone(current);
		},
		async verifyReadiness() {
			return;
		},
	};

	function menuItem(
		menuItemId: string,
		name: string,
		priceText: string | null,
		windowId: string,
		sortOrder: number,
	): DiningMenuItemRecord {
		return {
			archivedAt: null,
			createdAt: "2026-07-24T08:00:00.000Z",
			createdBy: "bootstrap",
			menuItemId,
			name,
			priceText,
			sortOrder,
			updatedAt: "2026-07-24T08:00:00.000Z",
			updatedBy: "bootstrap",
			windowId,
		};
	}

	function review(
		reviewId: string,
		item: DiningMenuItemRecord,
		body: string,
		authorKind: "member" | "operator",
		anonymous: boolean,
	): Extract<DiningOpsContentReviewRecord, { targetKind: "menu_item" }> {
		return {
			anonymous,
			authorDisplayName: authorKind === "member" ? "张同学" : "值班员",
			authorId: authorKind === "member" ? "user_1" : "ops@example.test",
			authorKind,
			body,
			contentRevision: 1,
			targetKind: "menu_item",
			createdAt: "2026-07-24T08:05:00.000Z",
			deletedAt: null,
			editCount: 0,
			editedAt: null,
			hiddenAt: null,
			hiddenBy: null,
			menuItemId: item.menuItemId,
			menuItemName: item.name,
			reviewId,
			updatedAt: "2026-07-24T08:05:00.000Z",
			updatedBy: authorKind === "member" ? "user_1" : "ops@example.test",
			windowId: item.windowId,
		};
	}

	function requireMenu(menuItemId: string) {
		const item = menuItems.find((candidate) => candidate.menuItemId === menuItemId);
		if (!item) {
			throw new Error("Menu item not found.");
		}
		return item;
	}

	function requireReview(reviewId: string) {
		const current = reviews.find((candidate) => candidate.reviewId === reviewId);
		if (!current) {
			throw new Error("Review not found.");
		}
		return current;
	}

	function updateMenu(
		menuItemId: string,
		input: Partial<
			Pick<
				DiningMenuItemRecord,
				"archivedAt" | "name" | "priceText" | "sortOrder" | "updatedBy" | "windowId"
			>
		>,
	) {
		const item = requireMenu(menuItemId);
		Object.assign(item, input, { updatedAt: nextTime() });
		return structuredClone(item);
	}

	function nextTime() {
		return new Date(Date.parse("2026-07-24T08:10:00.000Z") + sequence++ * 1_000).toISOString();
	}
}

interface BrowserDiningRelease {
	bundle: DiningFloorplanBundleV1;
	summary: DiningReleaseSummary;
}

function createBrowserDiningStore(): DiningMapStore & { reset(): void } {
	let clock = Date.parse("2026-07-24T08:00:00.000Z");
	let releaseSequence = 1;
	let draft = initialDiningDraft();
	let releases: BrowserDiningRelease[] = [
		{
			bundle: structuredClone(draft.bundle),
			summary: {
				createdAt: new Date(clock).toISOString(),
				createdBy: "bootstrap",
				draftRevision: draft.revision,
				kind: "publish",
				releaseId: "dining-release-1",
				restoredFromReleaseId: null,
				snapshotHash: draft.fingerprint,
			},
		},
	];
	let currentReleaseId = releases[0]?.summary.releaseId ?? null;

	function reset(): void {
		clock = Date.parse("2026-07-24T08:00:00.000Z");
		releaseSequence = 1;
		draft = initialDiningDraft();
		releases = [
			{
				bundle: structuredClone(draft.bundle),
				summary: {
					createdAt: new Date(clock).toISOString(),
					createdBy: "bootstrap",
					draftRevision: draft.revision,
					kind: "publish",
					releaseId: "dining-release-1",
					restoredFromReleaseId: null,
					snapshotHash: draft.fingerprint,
				},
			},
		];
		currentReleaseId = releases[0]?.summary.releaseId ?? null;
	}

	function assertRevision(expectedRevision: number): void {
		if (expectedRevision !== draft.revision) {
			throw new DiningStoreConflictError("地图草稿已被其他操作者更新，请刷新后重试。");
		}
	}

	function createRelease(
		actor: DiningOpsActor,
		kind: DiningReleaseSummary["kind"],
		restoredFromReleaseId: string | null,
	): DiningReleaseSummary {
		clock += 1_000;
		releaseSequence += 1;
		return {
			createdAt: new Date(clock).toISOString(),
			createdBy: actor.principalId,
			draftRevision: draft.revision,
			kind,
			releaseId: `dining-release-${releaseSequence}`,
			restoredFromReleaseId,
			snapshotHash: draft.fingerprint,
		};
	}

	return {
		reset,
		async getState() {
			return {
				currentRelease:
					releases.find((item) => item.summary.releaseId === currentReleaseId)?.summary ?? null,
				draft: structuredClone(draft),
			};
		},
		async listReleases() {
			return {
				currentReleaseId,
				releases: structuredClone(releases.map((item) => item.summary)),
			};
		},
		async publish(actor, expectedRevision) {
			assertRevision(expectedRevision);
			const current = releases.find((item) => item.summary.releaseId === currentReleaseId);
			if (current?.summary.snapshotHash === draft.fingerprint) {
				return structuredClone(current.summary);
			}
			const summary = createRelease(actor, "publish", null);
			releases.unshift({ bundle: structuredClone(draft.bundle), summary });
			currentReleaseId = summary.releaseId;
			return structuredClone(summary);
		},
		async restore(actor, releaseId, expectedRevision) {
			assertRevision(expectedRevision);
			const target = releases.find((item) => item.summary.releaseId === releaseId);
			if (!target) {
				throw new DiningStoreNotFoundError("未找到要恢复的地图版本。");
			}
			if (draft.fingerprint !== target.summary.snapshotHash) {
				clock += 1_000;
				draft = {
					bundle: structuredClone(target.bundle),
					fingerprint: target.summary.snapshotHash,
					revision: draft.revision + 1,
					updatedAt: new Date(clock).toISOString(),
					updatedBy: actor.principalId,
				};
			}
			const current = releases.find((item) => item.summary.releaseId === currentReleaseId);
			if (current?.summary.snapshotHash === target.summary.snapshotHash) {
				return { draft: structuredClone(draft), release: structuredClone(current.summary) };
			}
			const summary = createRelease(actor, "restore", target.summary.releaseId);
			releases.unshift({ bundle: structuredClone(draft.bundle), summary });
			currentReleaseId = summary.releaseId;
			return { draft: structuredClone(draft), release: structuredClone(summary) };
		},
		async saveDraft(actor, bundle, expectedRevision) {
			assertRevision(expectedRevision);
			const canonical = canonicalizeDiningFloorplanBundle(bundle);
			const fingerprint = diningMapBundleFingerprint(canonical);
			if (fingerprint === draft.fingerprint) {
				return structuredClone(draft);
			}
			clock += 1_000;
			draft = {
				bundle: canonical,
				fingerprint,
				revision: draft.revision + 1,
				updatedAt: new Date(clock).toISOString(),
				updatedBy: actor.principalId,
			};
			return structuredClone(draft);
		},
		async verifyReadiness() {
			return;
		},
	};
}

function initialDiningDraft(): DiningMapDraft {
	const bundle = structuredClone(DINING_BOOTSTRAP_FLOORPLANS);
	return {
		bundle,
		fingerprint: diningMapBundleFingerprint(bundle),
		revision: 1,
		updatedAt: "2026-07-24T08:00:00.000Z",
		updatedBy: "bootstrap",
	};
}

function fixtureProviderConfigClient() {
	const status: ExecutionModelSettingsStatus = {
		embeddingContract: {
			dimensions: 2560,
			model: "Qwen3-Embedding-4B",
			provider: "openai-compatible",
			transport: "embeddings",
		},
		sampledAt: new Date().toISOString(),
		settings: {
			embedding: {
				baseUrl: "https://embedding.example.test/v1",
				credentialConfigured: true,
				kind: "embedding",
				latestValidation: {
					message: "Embedding validation passed.",
					observedDimensions: 2560,
					status: "passed",
					validatedAt: "2026-07-16T00:05:00.000Z",
					validatedBy: "ops@example.test",
				},
				model: "Qwen3-Embedding-4B",
				provider: "openai-compatible",
				transport: "embeddings",
				updatedAt: "2026-07-16T00:00:00.000Z",
				updatedBy: "ops@example.test",
			},
			llm: {
				baseUrl: "https://provider.example.test/v1",
				credentialConfigured: true,
				kind: "llm",
				latestValidation: {
					message: "LLM validation passed.",
					status: "passed",
					validatedAt: "2026-07-16T00:05:00.000Z",
					validatedBy: "ops@example.test",
				},
				model: "primary-demo-model",
				provider: "openai",
				transport: "responses",
				updatedAt: "2026-07-16T00:00:00.000Z",
				updatedBy: "ops@example.test",
			},
			reranker: {
				baseUrl: "https://reranker.example.test/v1",
				credentialConfigured: true,
				kind: "reranker",
				latestValidation: {
					message: "Reranker validation passed.",
					status: "passed",
					validatedAt: "2026-07-16T00:05:00.000Z",
					validatedBy: "ops@example.test",
				},
				model: "rerank-v4",
				provider: "cohere-compatible",
				transport: "rerank",
				updatedAt: "2026-07-16T00:00:00.000Z",
				updatedBy: "ops@example.test",
			},
		},
		noticeClassification: {
			backend: "llm",
			credentials: {
				decision: null,
				llm: {
					baseUrl: "https://classifier.example.test/v1",
					credentialConfigured: true,
					latestValidation: {
						message: "Notice classifier validation passed.",
						status: "passed",
						validatedAt: "2026-07-16T00:05:00.000Z",
						validatedBy: "ops@example.test",
					},
					model: "deepseek-v4-flash",
					provider: "openai-compatible",
					transport: "chat_completions",
					updatedAt: "2026-07-16T00:00:00.000Z",
					updatedBy: "ops@example.test",
				},
			},
		},
	};
	const passed = () => ({
		message: "Validation passed.",
		status: "passed" as const,
		validatedAt: new Date().toISOString(),
		validatedBy: "ops@example.test",
	});
	return {
		async discoverModels() {
			return {
				models: ["primary-demo-model", "reasoning-demo-model"],
				sampledAt: new Date().toISOString(),
			};
		},
		async getOcrConfig() {
			return null;
		},
		async putOcrConfig() {
			return null;
		},
		async getStatus() {
			return status;
		},
		async put(kind: "llm" | "embedding" | "reranker", body: Record<string, unknown>) {
			status.settings[kind] = {
				baseUrl: String(body.baseUrl),
				credentialConfigured: true,
				kind,
				latestValidation: {
					message: "Validation passed.",
					...(kind === "embedding" ? { observedDimensions: 2560 } : {}),
					status: "passed",
					validatedAt: new Date().toISOString(),
					validatedBy: "ops@example.test",
				},
				model: kind === "embedding" ? status.embeddingContract.model : String(body.model),
				provider:
					kind === "embedding"
						? status.embeddingContract.provider
						: (body.provider as "openai" | "openai-compatible" | "cohere" | "cohere-compatible"),
				transport:
					kind === "embedding"
						? "embeddings"
						: (body.transport as "responses" | "chat_completions" | "rerank"),
				updatedAt: new Date().toISOString(),
				updatedBy: "ops@example.test",
			};
			return status;
		},
		async selectNoticeClassification(backend: NoticeClassificationBackend) {
			status.noticeClassification.backend = backend;
			return status;
		},
		async putNoticeClassificationCredential(
			backend: NoticeClassificationBackend,
			body: NoticeClassificationCredentialUpdate,
		) {
			status.noticeClassification.credentials[backend] = {
				baseUrl: body.baseUrl,
				credentialConfigured: true,
				latestValidation: passed(),
				model: body.model,
				provider: body.provider,
				transport: "transport" in body ? body.transport : "systemone",
				updatedAt: new Date().toISOString(),
				updatedBy: "ops@example.test",
			};
			return status;
		},
		async validateNoticeClassificationCredential(backend: NoticeClassificationBackend) {
			const credential = status.noticeClassification.credentials[backend];
			if (credential) {
				credential.latestValidation = passed();
			}
			return status;
		},
		async discoverNoticeClassificationModels() {
			return { models: ["drex-max", "deepseek-v4-flash"], sampledAt: new Date().toISOString() };
		},
		async validate(kind: "llm" | "embedding" | "reranker") {
			const setting = status.settings[kind];
			if (setting) {
				setting.latestValidation = {
					message: "Validation passed.",
					...(kind === "embedding" ? { observedDimensions: 2560 } : {}),
					status: "passed",
					validatedAt: new Date().toISOString(),
					validatedBy: "ops@example.test",
				};
			}
			return status;
		},
	};
}
