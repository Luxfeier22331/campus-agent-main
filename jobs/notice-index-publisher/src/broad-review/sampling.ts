import { sha256, unicodeLength } from "../encoding.ts";
import {
	NOTICE_BROAD_REVIEW_DEFINITION,
	type BroadReviewNotice,
	type BroadReviewTag,
	type BroadReviewStratum,
	type Distribution,
} from "./model.ts";
import type { Sha256Ref } from "../types.ts";

export function selectBroadReviewSample(
	notices: readonly BroadReviewNotice[],
): { sample: BroadReviewNotice[]; summary: Record<string, unknown> } {
	const selected = new Map<string, BroadReviewNotice>();
	const stratumSummary: Array<Record<string, unknown>> = [];

	const selectAll = (name: BroadReviewTag): void => {
		const eligible = notices.filter((notice) => notice.tags.includes(name));
		let newNoticeCount = 0;
		for (const notice of stableNoticeSort(eligible, name)) {
			if (selected.has(notice.noticeId)) continue;
			selected.set(notice.noticeId, {
				...notice,
				primaryStratum: name,
			});
			newNoticeCount += 1;
		}
		stratumSummary.push({
			candidateCount: eligible.length,
			mode: "all",
			name,
			newNoticeCount,
		});
	};

	for (const tag of NOTICE_BROAD_REVIEW_DEFINITION.mandatoryTags) {
		selectAll(tag);
	}

	for (const stratum of NOTICE_BROAD_REVIEW_DEFINITION.additionalStrata) {
		const eligible = notices.filter((notice) => notice.tags.includes(stratum.name));
		const candidates = stableNoticeSort(
			eligible.filter((notice) => !selected.has(notice.noticeId)),
			stratum.name,
		);
		const picked = candidates.slice(0, stratum.target);
		for (const notice of picked) {
			selected.set(notice.noticeId, {
				...notice,
				primaryStratum: stratum.name,
			});
		}
		stratumSummary.push({
			candidateCount: eligible.length,
			name: stratum.name,
			newNoticeCount: picked.length,
			target: stratum.target,
		});
	}

	const controlCandidates = stableNoticeSort(
		notices.filter((notice) => !selected.has(notice.noticeId)),
		"random-control",
	);
	const controls = controlCandidates.slice(0, NOTICE_BROAD_REVIEW_DEFINITION.randomControlTarget);
	for (const notice of controls) {
		selected.set(notice.noticeId, {
			...notice,
			primaryStratum: "random-control",
		});
	}
	stratumSummary.push({
		candidateCount: controlCandidates.length,
		name: "random-control",
		newNoticeCount: controls.length,
		target: NOTICE_BROAD_REVIEW_DEFINITION.randomControlTarget,
	});

	const coverageFill = notices
		.filter((notice) => !selected.has(notice.noticeId))
		.sort(
			(left, right) =>
				stableNoticeRank("coverage-fill", left.noticeId).localeCompare(
					stableNoticeRank("coverage-fill", right.noticeId),
				) || compareNoticeIds(left, right),
		)
		.slice(0, Math.max(0, NOTICE_BROAD_REVIEW_DEFINITION.sampleTarget - selected.size));
	for (const notice of coverageFill) {
		selected.set(notice.noticeId, {
			...notice,
			primaryStratum: "coverage-fill",
		});
	}
	stratumSummary.push({
		candidateCount: notices.length,
		name: "coverage-fill",
		newNoticeCount: coverageFill.length,
		target: Math.max(
			0,
			NOTICE_BROAD_REVIEW_DEFINITION.sampleTarget - (selected.size - coverageFill.length),
		),
	});
	const sample = [...selected.values()].sort(
		(left, right) =>
			(left.primaryStratum ?? "").localeCompare(right.primaryStratum ?? "") ||
			compareNoticeIds(left, right),
	);
	const census = buildBroadReviewCensus(notices, `sha256:${"0".repeat(64)}` as Sha256Ref);
	const summary = {
		census: { ...census, run: undefined },
		definition: NOTICE_BROAD_REVIEW_DEFINITION,
		sampleChunkCount: sample.reduce((sum, notice) => sum + notice.metrics.chunkCount, 0),
		sampleCount: sample.length,
		sampleNoticeRatio: notices.length === 0 ? 0 : sample.length / notices.length,
		sampleTagCoverage: Object.fromEntries(
			allTags(notices).map((tag) => {
				const candidateCount = notices.filter((notice) => notice.tags.includes(tag)).length;
				const selectedCount = sample.filter((notice) => notice.tags.includes(tag)).length;
				return [
					tag,
					{
						candidateCount,
						ratio: candidateCount === 0 ? 0 : selectedCount / candidateCount,
						selectedCount,
					},
				];
			}),
		),
		strata: stratumSummary,
	};
	return { sample, summary };
}

function stableNoticeSort(
	notices: readonly BroadReviewNotice[],
	stratum: BroadReviewStratum,
): BroadReviewNotice[] {
	return [...notices].sort(
		(left, right) =>
			stableNoticeRank(stratum, left.noticeId).localeCompare(
				stableNoticeRank(stratum, right.noticeId),
			) || compareNoticeIds(left, right),
	);
}

function stableNoticeRank(stratum: BroadReviewStratum, noticeId: string): string {
	return sha256(`${NOTICE_BROAD_REVIEW_DEFINITION.algorithm}\0${stratum}\0${noticeId}`);
}

export function buildBroadReviewCensus(
	notices: readonly BroadReviewNotice[],
	run: Sha256Ref,
): Record<string, unknown> {
	const chunks = notices.flatMap((notice) => notice.chunks);
	return {
		chunkCount: chunks.length,
		chunkLength: distribution(chunks.map((chunk) => unicodeLength(chunk.content))),
		chunkLengthBuckets: bucketCounts(
			chunks.map((chunk) => unicodeLength(chunk.content)),
			[120, 300, 600, 800, 1000, 1200],
		),
		noticeChunkCount: distribution(notices.map((notice) => notice.metrics.chunkCount)),
		noticeCount: notices.length,
		noticeLength: distribution(notices.map((notice) => notice.metrics.totalChars)),
		run,
		schemaVersion: NOTICE_BROAD_REVIEW_DEFINITION.algorithm,
		tagCounts: Object.fromEntries(
			allTags(notices).map((tag) => [
				tag,
				notices.filter((notice) => notice.tags.includes(tag)).length,
			]),
		),
	};
}

function distribution(values: readonly number[]): Distribution {
	const sorted = [...values].sort((left, right) => left - right);
	if (sorted.length === 0) return { max: 0, min: 0, p50: 0, p75: 0, p90: 0, p95: 0 };
	return {
		max: sorted.at(-1) ?? 0,
		min: sorted[0] ?? 0,
		p50: percentile(sorted, 0.5),
		p75: percentile(sorted, 0.75),
		p90: percentile(sorted, 0.9),
		p95: percentile(sorted, 0.95),
	};
}

function percentile(sorted: readonly number[], value: number): number {
	return sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)] ?? 0;
}

function bucketCounts(values: readonly number[], upperBounds: readonly number[]): Record<string, number> {
	const result: Record<string, number> = {};
	let lower = 0;
	for (const upper of upperBounds) {
		result[`${lower}-${upper - 1}`] = values.filter((value) => value >= lower && value < upper).length;
		lower = upper;
	}
	result[`${lower}+`] = values.filter((value) => value >= lower).length;
	return result;
}

function compareNoticeIds(left: BroadReviewNotice, right: BroadReviewNotice): number {
	const leftNumber = BigInt(left.noticeId);
	const rightNumber = BigInt(right.noticeId);
	return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
}

function allTags(notices: readonly BroadReviewNotice[]): BroadReviewTag[] {
	return [...new Set(notices.flatMap((notice) => notice.tags))].sort();
}
