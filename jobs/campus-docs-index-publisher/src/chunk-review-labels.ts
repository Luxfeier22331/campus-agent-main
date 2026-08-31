import { decodeGovernanceNdjson } from "./chunk-governance-artifacts.ts";
import type {
	CampusDocsReviewAction,
	CampusDocsReviewCandidateSignal,
	CampusDocsReviewItem,
	CampusDocsReviewItemStratum,
	CampusDocsReviewLabel,
	CampusDocsReviewLabelGroupSummary,
	CampusDocsReviewLabelSummary,
	CampusDocsReviewVerdict,
} from "./chunk-governance-types.ts";

const ACTIONS: readonly CampusDocsReviewAction[] = [
	"attach",
	"drop",
	"merge",
	"split",
	"upstream-reader",
];
const VERDICTS: readonly CampusDocsReviewVerdict[] = ["change", "keep"];

export function decodeCampusDocsReviewLabels(bytes: Uint8Array): CampusDocsReviewLabel[] {
	const values = decodeGovernanceNdjson(bytes);
	const labels = values.map((value, index) => parseReviewLabel(value, index + 1));
	const seen = new Set<string>();
	for (const label of labels) {
		if (seen.has(label.chunkId)) {
			throw new Error(`Campus docs review labels contain duplicate chunkId: ${label.chunkId}`);
		}
		seen.add(label.chunkId);
	}
	return labels;
}

export function summarizeCampusDocsReviewLabels(
	items: readonly CampusDocsReviewItem[],
	labels: readonly CampusDocsReviewLabel[],
): CampusDocsReviewLabelSummary {
	const itemByChunkId = new Map(items.map((item) => [item.chunk.chunkId, item]));
	const labelByChunkId = new Map<string, CampusDocsReviewLabel>();
	for (const label of labels) {
		if (!itemByChunkId.has(label.chunkId)) {
			throw new Error(`Campus docs review label references an unknown chunk: ${label.chunkId}`);
		}
		if (labelByChunkId.has(label.chunkId)) {
			throw new Error(`Campus docs review labels contain duplicate chunkId: ${label.chunkId}`);
		}
		labelByChunkId.set(label.chunkId, label);
	}
	const actions = Object.fromEntries(ACTIONS.map((action) => [action, 0])) as Record<
		CampusDocsReviewAction,
		number
	>;
	const verdicts = Object.fromEntries(VERDICTS.map((verdict) => [verdict, 0])) as Record<
		CampusDocsReviewVerdict,
		number
	>;
	for (const label of labels) {
		verdicts[label.verdict] += 1;
		if (label.action) actions[label.action] += 1;
	}
	const strata = [...new Set(items.map((item) => item.primaryStratum))].sort();
	const signals = [
		...new Set(items.flatMap((item) => item.signals.map((signal) => signal.signal))),
	].sort();
	return {
		actions,
		byPrimaryStratum: Object.fromEntries(
			strata.map((stratum) => [
				stratum,
				groupSummary(
					items.filter((item) => item.primaryStratum === stratum),
					labelByChunkId,
				),
			]),
		) as Partial<Record<CampusDocsReviewItemStratum, CampusDocsReviewLabelGroupSummary>>,
		bySignal: Object.fromEntries(
			signals.map((signal) => [
				signal,
				groupSummary(
					items.filter((item) => item.signals.some((candidate) => candidate.signal === signal)),
					labelByChunkId,
				),
			]),
		) as Partial<Record<CampusDocsReviewCandidateSignal, CampusDocsReviewLabelGroupSummary>>,
		itemCount: items.length,
		labeledCount: labels.length,
		unlabeledCount: items.length - labels.length,
		verdicts,
	};
}

function parseReviewLabel(value: unknown, lineNumber: number): CampusDocsReviewLabel {
	if (!isRecord(value)) {
		throw new Error(`Campus docs review label line ${lineNumber} must be an object`);
	}
	const allowedFields = new Set(["action", "chunkId", "reason", "verdict"]);
	const unknownField = Object.keys(value).find((field) => !allowedFields.has(field));
	if (unknownField) {
		throw new Error(`Campus docs review label line ${lineNumber} has unknown field: ${unknownField}`);
	}
	if (!nonEmptyString(value.chunkId)) {
		throw new Error(`Campus docs review label line ${lineNumber} has invalid chunkId`);
	}
	if (value.verdict !== "change" && value.verdict !== "keep") {
		throw new Error(`Campus docs review label line ${lineNumber} has invalid verdict`);
	}
	if (value.reason !== undefined && !nonEmptyString(value.reason)) {
		throw new Error(`Campus docs review label line ${lineNumber} has invalid reason`);
	}
	if (value.verdict === "change") {
		if (!ACTIONS.includes(value.action as CampusDocsReviewAction)) {
			throw new Error(`Campus docs review label line ${lineNumber} requires a valid action`);
		}
		return {
			action: value.action as CampusDocsReviewAction,
			chunkId: value.chunkId,
			...(value.reason ? { reason: value.reason } : {}),
			verdict: value.verdict,
		};
	}
	if (value.action !== undefined) {
		throw new Error(`Campus docs review label line ${lineNumber} must omit action when verdict is keep`);
	}
	return {
		chunkId: value.chunkId,
		...(value.reason ? { reason: value.reason } : {}),
		verdict: value.verdict,
	};
}

function groupSummary(
	items: readonly CampusDocsReviewItem[],
	labelByChunkId: ReadonlyMap<string, CampusDocsReviewLabel>,
): CampusDocsReviewLabelGroupSummary {
	const labels = items.flatMap((item) => {
		const label = labelByChunkId.get(item.chunk.chunkId);
		return label ? [label] : [];
	});
	const changeCount = labels.filter((label) => label.verdict === "change").length;
	return {
		changeCount,
		changeRate: labels.length === 0 ? 0 : round(changeCount / labels.length, 4),
		itemCount: items.length,
		labeledCount: labels.length,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

function round(value: number, digits: number): number {
	return Number(value.toFixed(digits));
}
