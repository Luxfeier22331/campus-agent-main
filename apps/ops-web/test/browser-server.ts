import type {
	DiningMapDraft,
	DiningMenuItemRecord,
	DiningOpsReportRecord,
	DiningOpsReviewRecord,
	DiningReviewEditRecord,
} from "@campus-agent/dining/domain";
import {
	canonicalizeDiningFloorplanBundle,
	DINING_BOOTSTRAP_FLOORPLANS,
	type DiningFloorplanBundleV1,
} from "@campus-agent/dining/floorplans";
import { diningMapBundleFingerprint } from "@campus-agent/dining/publisher";
import { serve } from "@hono/node-server";
import { createOpsApp } from "../src/server/app.ts";
import type { DiningContentStore } from "../src/server/dining-content-store.ts";
import {
	type DiningOpsActor,
	type DiningStore,
	DiningStoreConflictError,
	DiningStoreNotFoundError,
} from "../src/server/dining-store.ts";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission.ts";
import { createFixtureOpsStatusStore } from "../src/server/ops-status-store.ts";
import type { DiningReleaseSummary } from "../src/shared/dining-contract.ts";
import type { ExecutionModelSettingsStatus } from "../src/shared/ops-contract.ts";
import {
	opsLogObservabilityFixture,
	opsOverviewFixture,
	opsSentryIssuesFixture,
	opsTraceObservabilityFixture,
} from "../src/shared/ops-fixtures.ts";

const browserTestPort = Number(process.env.OPS_WEB_BROWSER_TEST_PORT ?? "4178");
const browserDiningStore = createBrowserDiningStore();
const browserDiningContentStore = createBrowserDiningContentStore();
const browserLogObservabilityFixture = {
	...opsLogObservabilityFixture,
	records: Array.from({ length: 30 }, (_, index) => ({
		...opsLogObservabilityFixture.records[0],
		eventType: index === 0 ? "request.finalized" : `request.event.${index}`,
	})),
};

const app = createOpsApp({
	admission: createAllowAllOpsAdmission({ email: "ops@example.test" }),
	env: {
		DEPLOYMENT_ENVIRONMENT: "local",
		OPS_WEB_CAMPUS_WEB_URL: "http://127.0.0.1:27014",
		OPS_WEB_PUBLIC_ORIGIN:
			process.env.OPS_WEB_PUBLIC_ORIGIN ?? `http://127.0.0.1:${browserTestPort}`,
	},
	axiom: {
		getTelemetrySnapshot: async () => opsOverviewFixture.telemetry,
		queryRequest: async ({ completedAt, kind, requestId, startedAt, traceId }) => {
			if (requestId === "req_ops_001") {
				return kind === "logs" ? browserLogObservabilityFixture : opsTraceObservabilityFixture;
			}
			const fixture = kind === "logs" ? opsLogObservabilityFixture : opsTraceObservabilityFixture;
			return {
				...fixture,
				dataState: "NO_DATA" as const,
				from: startedAt,
				records: [],
				requestId,
				to: completedAt ?? startedAt,
				traceId,
			};
		},
	},
	overviewService: {
		getOverview: async () => opsOverviewFixture,
	},
	sentry: {
		queryRequestIssues: async ({ completedAt, requestId, startedAt, traceId }) =>
			requestId === "req_ops_001"
				? opsSentryIssuesFixture
				: {
						...opsSentryIssuesFixture,
						dataState: "NO_DATA" as const,
						from: startedAt,
						issues: [],
						requestId,
						searchQuery: `campus.request_id:${JSON.stringify(requestId)}`,
						to: completedAt ?? startedAt,
						traceId,
					},
	},
	diningStore: browserDiningStore,
	diningContentStore: browserDiningContentStore,
	providerConfigClient: fixtureProviderConfigClient(),
	staticRoot: "dist",
	store: createFixtureOpsStatusStore(),
});

serve({
	fetch: (request) => {
		if (request.method === "GET" && new URL(request.url).pathname.startsWith("/dining")) {
			browserDiningStore.reset();
			browserDiningContentStore.reset();
		}
		return app.fetch(request);
	},
	hostname: "127.0.0.1",
	port: browserTestPort,
});

function createBrowserDiningContentStore(): DiningContentStore & { reset(): void } {
	const firstLayout = DINING_BOOTSTRAP_FLOORPLANS.layouts[0];
	const firstWindow = firstLayout?.windows[0];
	if (!(firstLayout && firstWindow)) {
		throw new Error("Dining browser fixture needs one window.");
	}
	const firstWindowId = `${firstLayout.hallId}:${firstLayout.floorId}:${firstWindow.anchorId}`;
	let sequence = 2;
	let menuItems: DiningMenuItemRecord[] = [];
	let reviews: DiningOpsReviewRecord[] = [];
	let reports: DiningOpsReportRecord[] = [];
	let edits = new Map<string, DiningReviewEditRecord[]>();

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
				review: structuredClone(firstReview),
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
						value.includes(query),
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
				if (report.review.reviewId === reviewId && !report.resolvedAt) {
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
				previousBody: current.body,
			});
			edits.set(reviewId, history);
			current.body = body;
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
	): DiningOpsReviewRecord {
		return {
			anonymous,
			authorDisplayName: authorKind === "member" ? "张同学" : "值班员",
			authorId: authorKind === "member" ? "user_1" : "ops@example.test",
			authorKind,
			body,
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

function createBrowserDiningStore(): DiningStore & { reset(): void } {
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
	let counter = 1;
	const status: ExecutionModelSettingsStatus = {
		etag: "etag-1",
		sampledAt: new Date().toISOString(),
		settings: {
			embedding: {
				baseUrl: "https://embedding.example.test/v1",
				credentialConfigured: true,
				credentialLast4: "demo",
				dimensions: 2560,
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
				credentialLast4: "demo",
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
		},
	};
	return {
		async getStatus() {
			return status;
		},
		async put(kind: "llm" | "embedding", body: Record<string, unknown>) {
			counter += 1;
			const current = status.settings[kind];
			status.etag = `etag-${counter}`;
			status.settings[kind] = {
				baseUrl: String(body.baseUrl),
				credentialConfigured: true,
				credentialLast4: String(body.apiKey || current?.credentialLast4 || "").slice(-4),
				...(kind === "embedding" ? { dimensions: 2560 } : {}),
				kind,
				latestValidation: {
					message: "Validation passed.",
					...(kind === "embedding" ? { observedDimensions: 2560 } : {}),
					status: "passed",
					validatedAt: new Date().toISOString(),
					validatedBy: "ops@example.test",
				},
				model: kind === "embedding" ? "Qwen3-Embedding-4B" : String(body.model),
				provider:
					kind === "embedding"
						? "openai-compatible"
						: (body.provider as "openai" | "openai-compatible"),
				transport:
					kind === "embedding"
						? "embeddings"
						: (body.transport as "responses" | "chat_completions"),
				updatedAt: new Date().toISOString(),
				updatedBy: "ops@example.test",
			};
			return status;
		},
		async validate(kind: "llm" | "embedding") {
			return {
				kind,
				validation: {
					message: "Validation passed.",
					status: "passed" as const,
					validatedAt: new Date().toISOString(),
					validatedBy: "ops@example.test",
				},
			};
		},
	};
}
