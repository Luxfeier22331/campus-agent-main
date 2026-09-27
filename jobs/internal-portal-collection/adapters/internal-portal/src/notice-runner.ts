import { parsePortalReleaseTime } from "@campus-agent/notices";
import type { InternalPortalNoticeSource } from "ingestion-contracts";
import { formatRawError } from "ingestion-contracts/raw-error";

import type { InternalPortalCollectionObjectStore } from "../../../src/object-store.js";
import {
	PortalCredentialExpiredError,
	PortalCredentialUnavailableError,
	PortalSessionExpiredError,
} from "./auth-errors.js";
import type { InternalPortalNoticeMetaStore } from "./notice-meta-store.js";
import { NoticeIngestionDataError, type NoticeIngestionOperation } from "./notice-ingestion-errors.js";
import type { NoticeInventoryStore } from "./notice-inventory-store.js";
import {
	ensureNoticeResources,
	type NoticeResourceEnsureResult,
	type NoticeResourceKind,
	NoticeResourceTransferError,
} from "./notice-resources.js";
import {
	buildInternalPortalNoticeSource,
	type InternalPortalNoticeSourceStore,
} from "./notice-source.js";
import type {
	InternalPortalNoticeSyncState,
	InternalPortalNoticeSyncStateStore,
} from "./notice-state-store.js";
import type {
	ApiRequestContextLike,
	NoticeDetailResponse,
	NoticeItem,
	NoticeListResponse,
	NoticeMetadataResponse,
} from "./types.js";

const NOTICE_PAGE_SIZE = 20;
const PORTAL_TIME_ZONE_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface NoticeMaintenanceRange {
	from: string;
	to: string;
}

export interface NoticeRunnerProgress {
	phase: "scanning" | "processing" | "writing" | "finalizing";
	processed: number;
	processedRange: NoticeMaintenanceRange | null;
	total: number | null;
}

export interface NoticeRunnerInput {
	apiContext: ApiRequestContextLike;
	fetchNoticeDetail: (input: {
		apiContext: ApiRequestContextLike;
		noticeId: number;
	}) => Promise<NoticeDetailResponse>;
	fetchNoticeMetadata: (input: {
		apiContext: ApiRequestContextLike;
	}) => Promise<NoticeMetadataResponse>;
	fetchNoticePage: (input: {
		apiContext: ApiRequestContextLike;
		currentPage: number;
		endDate: string;
		startDate: string;
	}) => Promise<NoticeListResponse>;
	metaStore: InternalPortalNoticeMetaStore;
	inventoryStore: NoticeInventoryStore;
	now?: () => string;
	onProgress?: (progress: NoticeRunnerProgress) => void;
	objectStore: InternalPortalCollectionObjectStore;
	portalHost: string;
	sourceStore: InternalPortalNoticeSourceStore;
	stateStore: InternalPortalNoticeSyncStateStore;
}

export interface NoticeRunnerResourceCounts {
	attachmentsDownloaded: number;
	attachmentsMissing: number;
	attachmentsReused: number;
	imagesDownloaded: number;
	imagesReused: number;
}

export interface NoticeRunnerFailure {
	error: string;
	noticeId: number;
	operation: NoticeIngestionOperation | "download";
	resourceKind?: NoticeResourceKind;
	resourceOrdinal?: number;
}

export interface NoticeRunnerResult {
	failures: NoticeRunnerFailure[];
	maintenanceRange: NoticeMaintenanceRange | null;
	mode: "backfill" | "sync" | "rescan";
	noticesAdded: number;
	noticesProcessed: number;
	objectsReused: number;
	objectsWritten: number;
	pagesFetched: number;
	processedRange: NoticeMaintenanceRange | null;
	resources: NoticeRunnerResourceCounts;
	state: InternalPortalNoticeSyncState | null;
	upToDate: boolean;
}

interface NoticeCandidate {
	item: NoticeItem;
	noticeId: number;
	noticeType: number;
}

interface NoticeMappings {
	noticeTypes: Record<string, string>;
	organizations: Record<string, string>;
}

interface NoticeScan {
	candidates: NoticeCandidate[];
	failures: NoticeRunnerFailure[];
	pagesFetched: number;
}

export async function syncInternalPortalNotices(
	input: NoticeRunnerInput,
): Promise<NoticeRunnerResult> {
	const current = await input.stateStore.load();
	if (!hasCompleteRange(current)) {
		throw new Error(
			"notice sync requires a complete maintenance range; run notice-backfill --start-date YYYY-MM-DD first",
		);
	}
	const latestEnd = await discoverPortalLatestEnd(input);
	// The final covered day can still receive new notices after the previous run.
	const processedRange = noticeRange(
		[current.coveredFrom, previousDate(current.coveredUntil)].sort().at(-1) as string,
		[current.coveredUntil, latestEnd].sort().at(-1) as string,
	);
	const mappings = await fetchMappings(input);
	const allowedTypes = new Set(Object.keys(mappings.noticeTypes).map(Number));
	const scan = await scanNotices(input, processedRange, allowedTypes);
	const completeMappings = withObservedOrganizations(mappings, scan.candidates);
	await input.inventoryStore.upsertMappings(completeMappings);
	const counts = await writeCandidates(input, scan.candidates, processedRange);
	counts.failures = [...scan.failures, ...counts.failures];
	const updatedAt = now(input);
	emitProgress(input, {
		phase: "finalizing",
		processed: scan.candidates.length,
		processedRange,
		total: scan.candidates.length,
	});
	if (counts.failures.length > 0) {
		return result(
			"sync",
			current,
			processedRange,
			null,
			scan.pagesFetched + 1,
			counts,
		);
	}
	await saveMappings(input, completeMappings, updatedAt);
	const state = await saveState(input, { ...current, coveredUntil: processedRange.to }, updatedAt);
	return result(
		"sync",
		state,
		processedRange,
		maintenanceRangeFromState(state),
		scan.pagesFetched + 1,
		counts,
		counts.noticesAdded === 0,
	);
}

export async function rescanInternalPortalNotices(
	input: NoticeRunnerInput & { from: string; to: string },
): Promise<NoticeRunnerResult> {
	const current = await input.stateStore.load();
	const from = parseNoticeStartDate(input.from);
	const to = parseNoticeStartDate(input.to);
	if (!hasCompleteRange(current) || from >= to || from < current.coveredFrom || to > current.coveredUntil) {
		throw new Error("notice rescan requires a nonempty range inside the maintained range");
	}
	const range = noticeRange(from, to);
	const mappings = await fetchMappings(input);
	const scan = await scanNotices(input, range, new Set(Object.keys(mappings.noticeTypes).map(Number)));
	const completeMappings = withObservedOrganizations(mappings, scan.candidates);
	await input.inventoryStore.upsertMappings(completeMappings);
	const counts = await writeCandidates(input, scan.candidates, range);
	counts.failures = [...scan.failures, ...counts.failures];
	if (counts.failures.length === 0) {
		await saveMappings(input, completeMappings, now(input));
	}
	emitProgress(input, { phase: "finalizing", processed: counts.noticesProcessed, processedRange: range, total: scan.candidates.length });
	return result("rescan", current, range, counts.failures.length ? null : maintenanceRangeFromState(current), scan.pagesFetched, counts);
}

export async function backfillInternalPortalNotices(
	input: NoticeRunnerInput & { startDate: string },
): Promise<NoticeRunnerResult> {
	const startDate = parseNoticeStartDate(input.startDate);
	const current = await input.stateStore.load();
	if (current && isNoticeHistoryCovered(current, startDate)) {
		emitProgress(input, {
			phase: "finalizing",
			processed: 0,
			processedRange: null,
			total: 0,
		});
		return result(
			"backfill",
			current,
			null,
			maintenanceRangeFromState(current),
			0,
		);
	}
	const completeCurrent = hasCompleteRange(current) ? current : null;
	const processedRange = noticeRange(
		startDate,
		completeCurrent?.coveredFrom ?? (await discoverPortalLatestEnd(input)),
	);

	const mappings = await fetchMappings(input);
	const allowedTypes = new Set(Object.keys(mappings.noticeTypes).map(Number));
	const scan = await scanNotices(input, processedRange, allowedTypes);
	const completeMappings = withObservedOrganizations(mappings, scan.candidates);
	await input.inventoryStore.upsertMappings(completeMappings);
	const counts = await writeCandidates(input, scan.candidates, processedRange);
	counts.failures = [...scan.failures, ...counts.failures];
	const updatedAt = now(input);
	emitProgress(input, {
		phase: "finalizing",
		processed: scan.candidates.length,
		processedRange,
		total: scan.candidates.length,
	});
	if (counts.failures.length > 0) {
		return result(
			"backfill",
			current,
			processedRange,
			null,
			scan.pagesFetched + (completeCurrent ? 0 : 1),
			counts,
		);
	}
	await saveMappings(input, completeMappings, updatedAt);
	const updated = await saveState(
		input,
		{
			coveredFrom: processedRange.from,
			coveredUntil: completeCurrent?.coveredUntil ?? processedRange.to,
			updatedAt: current?.updatedAt ?? "",
		},
		updatedAt,
	);
	return result(
		"backfill",
		updated,
		processedRange,
		maintenanceRangeFromState(updated),
		scan.pagesFetched + (completeCurrent ? 0 : 1),
		counts,
	);
}

export function isNoticeHistoryCovered(
	state: InternalPortalNoticeSyncState | null,
	startDate: string,
): boolean {
	return hasCompleteRange(state) && state.coveredFrom <= startDate;
}

export function parseNoticeStartDate(value: string): string {
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
		throw new Error("--start-date must use YYYY-MM-DD");
	}
	const parsed = new Date(`${value}T00:00:00.000Z`);
	if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
		throw new Error("--start-date must be a valid calendar date");
	}
	return value;
}

async function scanNotices(
	input: NoticeRunnerInput,
	range: NoticeMaintenanceRange,
	allowedTypes: Set<number>,
): Promise<NoticeScan> {
	const candidates: NoticeCandidate[] = [];
	const failures: NoticeRunnerFailure[] = [];
	let pagesFetched = 0;
	let scanned = 0;
	const seenIds = new Set<number>();
	const failedIds = new Set<number>();
	let totalPages: number | null = null;
	let totalItems: number | null = null;
	if (range.from === range.to) {
		emitProgress(input, { phase: "scanning", processed: 0, processedRange: range, total: 0 });
		return { candidates, failures, pagesFetched };
	}

	for (let currentPage = 1; totalPages === null || currentPage <= totalPages; currentPage += 1) {
		const page = await fetchPage(input, currentPage, range.from, previousDate(range.to));
		pagesFetched += 1;
		const pagination = parsePagination(page);
		totalPages ??= pagination.totalPages;
		totalItems ??= pagination.totalItems;
		for (const item of page.datas?.tables ?? []) {
			let candidate: NoticeCandidate;
			try {
				candidate = parseNoticeItem(item);
			} catch (error) {
				if (!(error instanceof NoticeIngestionDataError)) {
					throw error;
				}
				if (!failedIds.has(error.noticeId)) {
					failedIds.add(error.noticeId);
					failures.push({
						error: formatRawError(error),
						noticeId: error.noticeId,
						operation: error.operation,
					});
				}
				continue;
			}
			if (seenIds.has(candidate.noticeId)) {
				continue;
			}
			seenIds.add(candidate.noticeId);
			scanned += 1;
			if (allowedTypes.has(candidate.noticeType)) {
				candidates.push(candidate);
			}
		}
		emitProgress(input, {
			phase: "scanning",
			processed: scanned,
			processedRange: range,
			total: totalItems,
		});
	}

	return { candidates, failures, pagesFetched };
}

function parseNoticeItem(item: NoticeItem): NoticeCandidate {
	const noticeId = parsePositiveInteger(item.notice_id, "notice_id");
	return {
		item,
		noticeId,
		noticeType: parseNoticeType(item.notice_type, noticeId),
	};
}

function parseNoticeType(
	value: number | string | null | undefined,
	noticeId: number,
): number {
	try {
		return parsePositiveInteger(value, "notice_type");
	} catch (error) {
		throw new NoticeIngestionDataError({
			cause: error,
			message: `notice ${noticeId} item has an invalid notice_type`,
			noticeId,
			operation: "item",
		});
	}
}

async function fetchPage(
	input: NoticeRunnerInput,
	currentPage: number,
	startDate: string,
	endDate: string,
): Promise<NoticeListResponse> {
	return await input.fetchNoticePage({
		apiContext: input.apiContext,
		currentPage,
		endDate,
		startDate,
	});
}

async function discoverPortalLatestEnd(input: NoticeRunnerInput): Promise<string> {
	const page = await fetchPage(input, 1, "", "");
	parsePagination(page);
	const firstItem = page.datas?.tables?.[0];
	if (!firstItem) {
		return nextDate(portalDateFromInstant(now(input)));
	}
	const listReleaseTime = normalizeOptionalText(firstItem.notice_release_time);
	if (listReleaseTime) {
		return nextDate(portalReleaseDate(listReleaseTime, "latest portal notice"));
	}
	const noticeId = parsePositiveInteger(firstItem.notice_id, "notice_id");
	const detail = await input.fetchNoticeDetail({ apiContext: input.apiContext, noticeId });
	const detailInfo = detail.datas?.notice_info;
	if (!detailInfo) {
		throw new Error(`notice ${noticeId} detail is missing notice_info`);
	}
	return nextDate(
		portalReleaseDate(detailInfo.notice_release_time, `latest portal notice ${noticeId}`),
	);
}

async function fetchMappings(input: NoticeRunnerInput): Promise<NoticeMappings> {
	const response = await input.fetchNoticeMetadata({ apiContext: input.apiContext });
	const noticeTypes: Record<string, string> = {};
	for (const item of response.datas?.type ?? []) {
		const id = parsePositiveInteger(item.notice_type_id, "notice_type_id");
		const name = requireText(item.notice_type_name, "notice_type_name");
		assertNewMapping(noticeTypes, String(id), name, "notice type");
	}
	if (Object.keys(noticeTypes).length === 0) {
		throw new Error("internal portal notice metadata returned no notice types");
	}
	const organizations: Record<string, string> = {};
	for (const item of response.datas?.org ?? []) {
		const id = normalizeOptionalText(item.organization_id);
		const name = normalizeOptionalText(item.organization_name);
		if (!id || !name) {
			emitMetadataDiagnostic(id, "invalid_entry");
			continue;
		}
		if (Object.hasOwn(organizations, id)) {
			if (organizations[id] !== name) {
				emitMetadataDiagnostic(id, "duplicate_id");
			}
			continue;
		}
		organizations[id] = name;
	}
	return { noticeTypes, organizations };
}

function emitMetadataDiagnostic(organizationId: string | null, reason: string): void {
	console.log(
		JSON.stringify({
			noticeMetadata: { organizationId, reason },
			status: "running",
		}),
	);
}

function assertNewMapping(
	mappings: Record<string, string>,
	id: string,
	name: string,
	label: string,
): void {
	if (Object.hasOwn(mappings, id)) {
		throw new Error(`internal portal notice metadata returned duplicate ${label} ${id}`);
	}
	mappings[id] = name;
}

function withObservedOrganizations(
	mappings: NoticeMappings,
	candidates: readonly NoticeCandidate[],
): NoticeMappings {
	const organizations = { ...mappings.organizations };
	for (const candidate of candidates) {
		const id = normalizeOptionalText(candidate.item.organization_id);
		const name = normalizeOptionalText(candidate.item.organization_name);
		if (id && name && !Object.hasOwn(organizations, id)) {
			organizations[id] = name;
		}
	}
	return { ...mappings, organizations };
}

async function writeCandidates(
	input: NoticeRunnerInput,
	candidates: NoticeCandidate[],
	range: NoticeMaintenanceRange,
): Promise<{
	failures: NoticeRunnerFailure[];
	noticesAdded: number;
	noticesProcessed: number;
	objectsReused: number;
	objectsWritten: number;
	resources: NoticeRunnerResourceCounts;
}> {
	const failures: NoticeRunnerFailure[] = [];
	let objectsReused = 0;
	let objectsWritten = 0;
	let noticesProcessed = 0;
	let noticesAdded = 0;
	let candidatesProcessed = 0;
	let candidatesWritten = 0;
	const resources = emptyResourceCounts();
	emitProgress(input, {
		phase: "processing",
		processed: 0,
		processedRange: range,
		total: candidates.length,
	});
	for (const candidate of candidates) {
		try {
			const existing = await input.sourceStore.get(candidate.noticeId);
			let source: InternalPortalNoticeSource;
			if (existing) {
				source = existing;
			} else {
				source = await buildNoticeSource(input, candidate);
			}
			candidatesProcessed += 1;
			emitProgress(input, {
				phase: "processing",
				processed: candidatesProcessed,
				processedRange: range,
				total: candidates.length,
			});
			if (!isSourceInRange(source, range)) {
				candidatesWritten += 1;
				emitProgress(input, {
					phase: "writing",
					processed: candidatesWritten,
					processedRange: range,
					total: candidates.length,
				});
				continue;
			}
			if (existing) {
				objectsReused += 1;
			} else {
				const outcome = await input.sourceStore.put(source);
				if (outcome === "reused") {
					objectsReused += 1;
				} else {
					objectsWritten += 1;
				}
			}
			emitProgress(input, {
				phase: "writing",
				processed: candidatesWritten,
				processedRange: range,
				total: candidates.length,
			});
			const resourceResult = await ensureNoticeResources({
				apiContext: input.apiContext,
				dryRun: false,
				notices: [source],
				objectStore: input.objectStore,
				portalHost: input.portalHost,
			});
			if (await input.inventoryStore.register(source) === "written") {
				noticesAdded += 1;
			}
			noticesProcessed += 1;
			addResourceCounts(resources, resourceResult);
			candidatesWritten += 1;
			emitProgress(input, {
				phase: "writing",
				processed: candidatesWritten,
				processedRange: range,
				total: candidates.length,
			});
		} catch (error) {
			const failure = isolateNoticeCandidateFailure(error);
			if (!failure) {
				throw error;
			}
			failures.push(failure);
			candidatesWritten += 1;
			emitProgress(input, {
				phase: "writing",
				processed: candidatesWritten,
				processedRange: range,
				total: candidates.length,
			});
		}
	}
	return { failures, noticesAdded, noticesProcessed, objectsReused, objectsWritten, resources };
}

async function buildNoticeSource(
	input: NoticeRunnerInput,
	candidate: NoticeCandidate,
): Promise<InternalPortalNoticeSource> {
	let detail: NoticeDetailResponse;
	try {
		detail = await input.fetchNoticeDetail({
			apiContext: input.apiContext,
			noticeId: candidate.noticeId,
		});
	} catch (error) {
		if (isPortalAuthenticationError(error)) {
			throw error;
		}
		throw new NoticeIngestionDataError({
			cause: error,
			message: `notice ${candidate.noticeId} detail fetch failed`,
			noticeId: candidate.noticeId,
			operation: "detail",
		});
	}
	const detailInfo = detail.datas?.notice_info;
	if (!detailInfo) {
		throw new NoticeIngestionDataError({
			message: `notice ${candidate.noticeId} detail is missing notice_info`,
			noticeId: candidate.noticeId,
			operation: "detail",
		});
	}
	try {
		return buildInternalPortalNoticeSource({
			detailInfo,
			listItem: candidate.item,
			noticeId: candidate.noticeId,
			noticeType: candidate.noticeType,
		});
	} catch (error) {
		if (error instanceof NoticeIngestionDataError) {
			throw error;
		}
		throw new NoticeIngestionDataError({
			cause: error,
			message: `notice ${candidate.noticeId} source construction failed`,
			noticeId: candidate.noticeId,
			operation: "source",
		});
	}
}

function isolateNoticeCandidateFailure(error: unknown): NoticeRunnerFailure | null {
	if (error instanceof NoticeResourceTransferError) {
		return {
			error: formatRawError(error),
			noticeId: error.noticeId,
			operation: error.operation,
			resourceKind: error.resourceKind,
			resourceOrdinal: error.resourceOrdinal,
		};
	}
	if (error instanceof NoticeIngestionDataError) {
		return {
			error: formatRawError(error),
			noticeId: error.noticeId,
			operation: error.operation,
		};
	}
	return null;
}

function isPortalAuthenticationError(error: unknown): boolean {
	return (
		error instanceof PortalCredentialExpiredError ||
		error instanceof PortalCredentialUnavailableError ||
		error instanceof PortalSessionExpiredError
	);
}

async function saveMappings(
	input: NoticeRunnerInput,
	mappings: NoticeMappings,
	updatedAt: string,
): Promise<void> {
	await input.metaStore.putMappings({ ...mappings, updatedAt });
}

async function saveState(
	input: NoticeRunnerInput,
	state: InternalPortalNoticeSyncState,
	updatedAt: string,
): Promise<InternalPortalNoticeSyncState> {
	const updated = { ...state, updatedAt };
	await input.stateStore.save(updated);
	return updated;
}

function parsePositiveInteger(value: number | string | null | undefined, field: string): number {
	const normalized =
		typeof value === "number"
			? value
			: typeof value === "string" && /^[1-9]\d*$/u.test(value.trim())
				? Number(value.trim())
				: Number.NaN;
	if (!Number.isSafeInteger(normalized) || normalized <= 0) {
		throw new Error(`internal portal notice response returned an invalid ${field}`);
	}
	return normalized;
}

function parsePagination(response: NoticeListResponse): {
	totalItems: number;
	totalPages: number;
} {
	const page = response.datas?.page;
	const totalItems = parseNonNegativeInteger(page?.total);
	const totalPages = parseNonNegativeInteger(page?.totalCounts);
	const pageSize = parseInteger(page?.pageSize);
	if (
		!(Number.isSafeInteger(totalItems) && Number.isSafeInteger(totalPages)) ||
		pageSize !== NOTICE_PAGE_SIZE ||
		Math.ceil(totalItems / pageSize) !== totalPages
	) {
		throw new Error("internal portal notice list returned invalid pagination metadata");
	}
	return { totalItems, totalPages };
}

function parseNonNegativeInteger(value: number | string | undefined): number {
	const normalized = parseInteger(value);
	return normalized >= 0 ? normalized : Number.NaN;
}

function parseInteger(value: number | string | undefined): number {
	return typeof value === "number"
		? value
		: typeof value === "string" && /^\d+$/u.test(value.trim())
			? Number(value.trim())
			: Number.NaN;
}

function requireText(value: string | null | undefined, field: string): string {
	const normalized = normalizeOptionalText(value) ?? "";
	if (!normalized) {
		throw new Error(`internal portal notice metadata returned an invalid ${field}`);
	}
	return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
	const normalized = typeof value === "string" ? value.trim() : "";
	return normalized || null;
}

function now(input: NoticeRunnerInput): string {
	return (input.now ?? (() => new Date().toISOString()))();
}

function result(
	mode: NoticeRunnerResult["mode"],
	state: InternalPortalNoticeSyncState | null,
	processedRange: NoticeMaintenanceRange | null,
	maintenanceRange: NoticeMaintenanceRange | null,
	pagesFetched: number,
	counts: Pick<
		NoticeRunnerResult,
		"failures" | "noticesAdded" | "noticesProcessed" | "objectsReused" | "objectsWritten" | "resources"
	> = {
		failures: [],
		noticesAdded: 0,
		noticesProcessed: 0,
		objectsReused: 0,
		objectsWritten: 0,
		resources: emptyResourceCounts(),
	},
	upToDate = false,
): NoticeRunnerResult {
	return {
		maintenanceRange,
		mode,
		pagesFetched,
		processedRange,
		state,
		upToDate,
		...counts,
	};
}

function hasCompleteRange(
	state: InternalPortalNoticeSyncState | null,
): state is InternalPortalNoticeSyncState & { coveredFrom: string; coveredUntil: string } {
	if (!(state?.coveredFrom && state.coveredUntil)) {
		return false;
	}
	if (state.coveredFrom > state.coveredUntil) {
		throw new Error("internal portal notice sync state has an invalid maintenance range");
	}
	return true;
}

function maintenanceRangeFromState(
	state: InternalPortalNoticeSyncState,
): NoticeMaintenanceRange {
	if (!hasCompleteRange(state)) {
		throw new Error("internal portal notice sync state has no complete maintenance range");
	}
	return { from: state.coveredFrom, to: state.coveredUntil };
}

function noticeRange(from: string, to: string): NoticeMaintenanceRange {
	parseNoticeStartDate(from);
	parseNoticeStartDate(to);
	if (from > to) {
		throw new Error(`notice maintenance range is invalid: [${from}, ${to})`);
	}
	return { from, to };
}

function portalReleaseDate(value: string | null | undefined, key: string): string {
	const normalized = normalizeOptionalText(value);
	parsePortalReleaseTime(normalized, key);
	return normalized?.slice(0, 10) ?? "";
}

function isSourceInRange(
	source: InternalPortalNoticeSource,
	range: NoticeMaintenanceRange,
): boolean {
	const releasedOn = portalReleaseDate(
		source.notice_release_time,
		`internal_portal/notices/${source.notice_id}.json`,
	);
	return releasedOn >= range.from && releasedOn < range.to;
}

function portalDateFromInstant(value: string): string {
	const instant = new Date(value);
	if (Number.isNaN(instant.valueOf())) {
		throw new Error("notice runner now() returned an invalid date-time");
	}
	return new Date(instant.getTime() + PORTAL_TIME_ZONE_OFFSET_MS).toISOString().slice(0, 10);
}

function nextDate(value: string): string {
	return shiftDate(value, 1);
}

function previousDate(value: string): string {
	return shiftDate(value, -1);
}

function shiftDate(value: string, days: number): string {
	parseNoticeStartDate(value);
	const date = new Date(`${value}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

function emitProgress(input: NoticeRunnerInput, progress: NoticeRunnerProgress): void {
	if (input.onProgress) {
		input.onProgress(progress);
		return;
	}
	const { processedRange, ...jobProgress } = progress;
	console.log(JSON.stringify({ processedRange, progress: jobProgress, status: "running" }));
}

function emptyResourceCounts(): NoticeRunnerResourceCounts {
	return {
		attachmentsDownloaded: 0,
		attachmentsMissing: 0,
		attachmentsReused: 0,
		imagesDownloaded: 0,
		imagesReused: 0,
	};
}

function addResourceCounts(
	target: NoticeRunnerResourceCounts,
	resultValue: NoticeResourceEnsureResult,
): void {
	target.attachmentsDownloaded += resultValue.attachments.downloaded;
	target.attachmentsMissing += resultValue.attachments.missing;
	target.attachmentsReused += resultValue.attachments.existing;
	target.imagesDownloaded += resultValue.images.downloaded;
	target.imagesReused += resultValue.images.existing;
}
