import { BASELINE_CHUNK_DEFINITION } from "../definitions.ts";
import { unicodeLength } from "../encoding.ts";
import type { DistributionSummary } from "../types.ts";

export interface ReportBaselineChunk {
	content: string;
	end: number;
	start: number;
}

export function buildBaselineChunks(value: string): ReportBaselineChunk[] {
	const lineRanges = sourceLineRanges(value).flatMap((range) => splitBaselineRange(value, range));
	const chunks: ReportBaselineChunk[] = [];
	let current: Array<{ end: number; start: number }> = [];
	const flush = () => {
		const first = current[0];
		const last = current.at(-1);
		if (!(first && last)) {
			return;
		}
		chunks.push({ content: value.slice(first.start, last.end), end: last.end, start: first.start });
		current = [];
	};
	for (const range of lineRanges) {
		const first = current[0];
		const currentText = first ? value.slice(first.start, current.at(-1)?.end ?? first.end) : "";
		const combined = first
			? value.slice(first.start, range.end)
			: value.slice(range.start, range.end);
		if (
			current.length > 0 &&
			(unicodeLength(currentText) >= BASELINE_CHUNK_DEFINITION.targetChars ||
				unicodeLength(combined) > BASELINE_CHUNK_DEFINITION.maxChars)
		) {
			flush();
		}
		current.push(range);
	}
	flush();
	return chunks;
}

export function distribution(values: readonly number[]): DistributionSummary {
	if (values.length === 0) {
		throw new Error("notice chunk distribution has no values");
	}
	const sorted = [...values].sort((left, right) => left - right);
	return {
		max: sorted.at(-1) ?? 0,
		p50: percentile(sorted, 0.5),
		p75: percentile(sorted, 0.75),
		p90: percentile(sorted, 0.9),
		p95: percentile(sorted, 0.95),
	};
}

export function sum(values: readonly number[]): number {
	return values.reduce((total, value) => total + value, 0);
}

function sourceLineRanges(value: string): Array<{ end: number; start: number }> {
	const result: Array<{ end: number; start: number }> = [];
	let start = 0;
	while (start <= value.length) {
		const newline = value.indexOf("\n", start);
		const end = newline === -1 ? value.length : newline;
		if (end > start) {
			result.push({ end, start });
		}
		if (newline === -1) {
			break;
		}
		start = newline + 1;
	}
	return result;
}

function splitBaselineRange(
	value: string,
	range: { end: number; start: number },
): Array<{ end: number; start: number }> {
	const result: Array<{ end: number; start: number }> = [];
	let start = range.start;
	let remaining = value.slice(range.start, range.end);
	while (unicodeLength(remaining) > BASELINE_CHUNK_DEFINITION.maxChars) {
		const piece = [...remaining].slice(0, BASELINE_CHUNK_DEFINITION.maxChars).join("");
		result.push({ end: start + piece.length, start });
		start += piece.length;
		remaining = remaining.slice(piece.length);
	}
	if (remaining) {
		result.push({ end: range.end, start });
	}
	return result;
}

function percentile(sorted: readonly number[], value: number): number {
	const index = Math.max(0, Math.ceil(sorted.length * value) - 1);
	return sorted[index] ?? 0;
}
