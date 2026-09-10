import { stripVTControlCharacters } from "node:util";

interface Interval {
	started: string;
	completed?: string;
}

interface PackageProgress {
	resolved: number;
	reused: number;
	downloaded: number;
	added: number;
	done: boolean;
}

interface Operation {
	id: string;
	parentId?: string;
	name: string;
	category: string;
	intervals: Interval[];
	cached?: boolean;
	error?: string;
	pnpm: PackageProgress[];
}

export type OperationState = "cached" | "complete" | "failed" | "unfinished";
export type CacheExportState = "success" | "warning" | "unfinished" | "not-run" | "unknown";
export interface BuildkitReport {
	operations: Array<Operation & { durationMs: number | null; state: OperationState }>;
	cacheExport: CacheExportState;
	cacheWarnings: string[];
	incomplete: boolean;
	signal?: string | null;
}

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(value: unknown): value is string {
	return typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) > 0;
}

function category(name: string): string {
	if (/exporting cache|preparing build cache|sending cache export/iu.test(name)) {
		return "cache-export";
	}
	if (/importing cache/iu.test(name)) {
		return "cache-import";
	}
	if (/generating sbom|syft scanner/iu.test(name)) {
		return "sbom";
	}
	if (/^pushing (?:layers|manifest)/iu.test(name)) {
		return "image-push";
	}
	if (/^exporting (?:to image|layers)/iu.test(name)) {
		return "image-export";
	}
	if (/\bRUN\b/u.test(name)) {
		if (/\bturbo prune\b/u.test(name)) {
			return "prune";
		}
		if (/\b(?:pnpm install|npm ci|uv sync|pip install|go mod download|cargo fetch)\b/u.test(name)) {
			return "dependencies";
		}
		if (/\b(?:pnpm .*build|pnpm .*deploy|go build|cargo build|typecheck)\b/u.test(name)) {
			return "build/check";
		}
		return "run";
	}
	if (/\bFROM\b|load metadata|resolve image config|docker-image:\/\//u.test(name)) {
		return "base-image";
	}
	if (/load .*context|load .*definition/u.test(name)) {
		return "input";
	}
	return "other";
}

// Sum the union, not overlapping snapshots or separate operations.
function duration(intervals: Interval[]): number | null {
	if (intervals.length === 0 || intervals.some((entry) => !entry.completed)) {
		return null;
	}
	const spans = intervals.map((entry) => [
		Date.parse(entry.started),
		Date.parse(entry.completed ?? ""),
	]);
	if (spans.some(([start, end]) => end < start)) {
		return null;
	}
	spans.sort((a, b) => a[0] - b[0]);
	let total = 0;
	let [start, end] = spans[0];
	for (const [nextStart, nextEnd] of spans.slice(1)) {
		if (nextStart > end) {
			total += end - start;
			start = nextStart;
		}
		end = Math.max(end, nextEnd);
	}
	return total + end - start;
}

export class BuildkitProgress {
	private readonly operations = new Map<string, Operation>();
	private readonly lines = new Map<string, string>();
	private readonly packageLines = new Map<string, string>();
	private readonly warnings = new Set<string>();
	private incomplete = false;
	private readonly log: (text: string) => void;

	constructor(log: (text: string) => void = () => undefined) {
		this.log = log;
	}

	push(chunk: string, stream = "stderr"): void {
		const lines = ((this.lines.get(stream) ?? "") + chunk).split("\n");
		this.lines.set(stream, lines.pop() ?? "");
		for (const line of lines) {
			this.line(line);
		}
	}

	finish(signal?: string | null): BuildkitReport {
		for (const line of this.lines.values()) {
			if (line) {
				this.line(line);
			}
		}
		this.lines.clear();
		for (const [id, line] of this.packageLines) {
			if (line) {
				this.packageProgress(id, line);
			}
		}
		this.packageLines.clear();
		const operations = [...this.operations.values()].map((operation) => {
			const state: OperationState = operation.error
				? "failed"
				: operation.cached
					? "cached"
					: operation.intervals.length > 0 && operation.intervals.every((entry) => entry.completed)
						? "complete"
						: "unfinished";
			return { ...operation, state, durationMs: duration(operation.intervals) };
		});
		const exporters = operations.filter(
			(operation) => operation.category === "cache-export" && !operation.parentId,
		);
		const cacheExport: CacheExportState =
			this.warnings.size > 0 || exporters.some((entry) => entry.error)
				? "warning"
				: exporters.length === 0
					? this.incomplete || operations.length === 0
						? "unknown"
						: "not-run"
					: exporters.every((entry) => entry.state === "complete")
						? "success"
						: "unfinished";
		return {
			operations,
			cacheExport,
			cacheWarnings: [...this.warnings],
			incomplete: this.incomplete || operations.length === 0,
			signal,
		};
	}

	private line(raw: string): void {
		if (!raw.trim()) {
			return;
		}
		let event: unknown;
		try {
			event = JSON.parse(raw);
		} catch {
			if (raw.trimStart().startsWith("{")) {
				this.incomplete = true;
			}
			this.plain(raw);
			return;
		}
		if (!object(event)) {
			this.incomplete = true;
			this.plain(raw);
			return;
		}
		try {
			let recognized = false;
			for (const key of ["vertexes", "statuses", "logs", "warnings"]) {
				if (!(key in event)) {
					continue;
				}
				recognized = true;
				if (!Array.isArray(event[key])) {
					this.incomplete = true;
					continue;
				}
				for (const value of event[key]) {
					if (!object(value)) {
						this.incomplete = true;
						continue;
					}
					if (key === "vertexes") {
						this.vertex(value);
					}
					if (key === "statuses") {
						this.status(value);
					}
					if (key === "logs") {
						this.commandLog(value);
					}
					if (key === "warnings") {
						this.plain(JSON.stringify(value));
					}
				}
			}
			if (!recognized) {
				if (typeof event.id === "string" && typeof event.name === "string") {
					this.vertex({ ...event, digest: event.id });
				} else {
					this.incomplete = true;
					this.plain(raw);
				}
			}
		} catch {
			this.incomplete = true;
			this.plain(raw);
		}
	}

	private plain(line: string): void {
		if (
			/failed to (?:export|configure).*cache|error (?:exporting|writing).*cache|cache export.*(?:failed|error)/iu.test(
				line,
			)
		) {
			this.warnings.add(line);
		}
		this.log(`${line}\n`);
	}

	private operation(id: string, name = id, parentId?: string): Operation {
		let operation = this.operations.get(id);
		if (!operation) {
			operation = { id, name, parentId, category: category(name), intervals: [], pnpm: [] };
			this.operations.set(id, operation);
		}
		if (name !== id) {
			operation.name = name;
			operation.category = category(name);
		}
		return operation;
	}

	private interval(operation: Operation, event: Record<string, unknown>): void {
		let interval = timestamp(event.started)
			? operation.intervals.find((entry) => entry.started === event.started)
			: operation.intervals.at(-1);
		if (!interval && timestamp(event.started)) {
			interval = { started: event.started };
			operation.intervals.push(interval);
			this.log(`[buildkit] state=start operation=${JSON.stringify(operation.name)}\n`);
		}
		if (interval && timestamp(event.completed)) {
			const completed = Boolean(interval.completed);
			interval.completed = event.completed;
			if (!completed) {
				this.log(
					`[buildkit] state=${operation.error ? "failed" : operation.cached ? "cached" : "complete"} operation=${JSON.stringify(operation.name)}\n`,
				);
			}
		}
	}

	private vertex(event: Record<string, unknown>): void {
		if (typeof event.digest !== "string") {
			this.incomplete = true;
			return;
		}
		const operation = this.operation(
			event.digest,
			typeof event.name === "string" ? event.name : undefined,
		);
		if (typeof event.cached === "boolean") {
			operation.cached = event.cached;
		}
		if (typeof event.error === "string") {
			if (operation.error !== event.error) {
				this.log(
					`[buildkit] error=${JSON.stringify(event.error)} operation=${JSON.stringify(operation.name)}\n`,
				);
			}
			operation.error = event.error;
		}
		this.interval(operation, event);
	}

	private status(event: Record<string, unknown>): void {
		if (typeof event.vertex !== "string" || typeof event.id !== "string") {
			this.incomplete = true;
			return;
		}
		// Layer byte updates are high frequency; aggregate exporter phases already cover them.
		if (
			!/^(?:exporting layers|pushing layers|pushing manifest|preparing build cache|sending cache export)/u.test(
				event.id,
			)
		) {
			return;
		}
		const operation = this.operation(`${event.vertex}/${event.id}`, event.id, event.vertex);
		this.interval(operation, event);
	}

	private commandLog(event: Record<string, unknown>): void {
		if (typeof event.vertex !== "string" || typeof event.data !== "string") {
			this.incomplete = true;
			return;
		}
		const text = Buffer.from(event.data, "base64").toString("utf8");
		this.log(text);
		const lines = ((this.packageLines.get(event.vertex) ?? "") + text).split(/[\r\n]/u);
		this.packageLines.set(event.vertex, lines.pop() ?? "");
		for (const line of lines) {
			this.packageProgress(event.vertex, line);
		}
	}

	private packageProgress(id: string, raw: string): void {
		const line = stripVTControlCharacters(raw);
		const match = line.match(
			/^Progress: resolved (\d+), reused (\d+), downloaded (\d+), added (\d+)(, done)?\s*$/u,
		);
		if (!match) {
			return;
		}
		const operation = this.operation(id);
		const next: PackageProgress = {
			resolved: Number(match[1]),
			reused: Number(match[2]),
			downloaded: Number(match[3]),
			added: Number(match[4]),
			done: Boolean(match[5]),
		};
		const previous = operation.pnpm.at(-1);
		if (previous && JSON.stringify(previous) === JSON.stringify(next)) {
			return;
		}
		if (!previous || previous.done || next.resolved < previous.resolved) {
			operation.pnpm.push(next);
		} else {
			operation.pnpm[operation.pnpm.length - 1] = next;
		}
	}
}

export function parseBuildkit(log: string): BuildkitReport {
	const parser = new BuildkitProgress();
	parser.push(log);
	return parser.finish();
}

export function renderBuildkit(report: BuildkitReport): string {
	const cell = (value: unknown) =>
		String(value)
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll("|", "\\|")
			.replace(/[\r\n]/gu, " ");
	const rows = report.operations.map((operation) => {
		const packages =
			!/\bpnpm\b/u.test(operation.name) && operation.pnpm.length === 0
				? "-"
				: operation.cached
					? "not executed"
					: operation.pnpm.length === 0
						? "unknown"
						: operation.pnpm
								.map(
									(entry) =>
										`resolved=${entry.resolved} reused=${entry.reused} downloaded=${entry.downloaded} added=${entry.added}${entry.done ? " done" : " unfinished"}`,
								)
								.join("; ");
		return `| ${cell(operation.category)} | ${cell(operation.name)} | ${cell(operation.error ? `${operation.state}: ${operation.error}` : operation.state)} | ${operation.durationMs === null ? "unknown" : `${(operation.durationMs / 1000).toFixed(2)}s`} | ${cell(packages)} |`;
	});
	return [
		`Cache export: **${report.cacheExport}**; observation: ${report.incomplete ? "incomplete" : "available"}${report.signal ? `; signal: ${cell(report.signal)}` : ""}.`,
		...report.cacheWarnings.map((warning) => `- ${cell(warning)}`),
		"",
		"| Phase | Operation | State | Duration | pnpm package observations |",
		"| --- | --- | --- | ---: | --- |",
		...rows,
		"",
		"Durations are unions within an operation; operations and exporter substeps overlap. Do not sum them as wall time.",
		"Layer cache hits skip commands. Missing package output is unknown, not a package cache miss. Package progress sequences are not additive.",
		"",
	].join("\n");
}
