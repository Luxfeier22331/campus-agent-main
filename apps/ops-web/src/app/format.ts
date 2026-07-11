export function formatDuration(value: number | null | undefined): string {
	if (value === null || value === undefined) {
		return "未记录耗时";
	}
	if (value < 1_000) {
		return `${value}ms`;
	}
	if (value < 60_000) {
		return `${(value / 1_000).toFixed(value < 10_000 ? 2 : 1)}s`;
	}
	if (value < 3_600_000) {
		return `${(value / 60_000).toFixed(1)}m`;
	}
	return `${(value / 3_600_000).toFixed(1)}h`;
}

export function formatPercent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

export function formatCurrencyUsd(value: number): string {
	if (value === 0) {
		return "$0";
	}
	return `$${value.toFixed(value < 0.01 ? 6 : 4)}`;
}

export function formatTimestamp(value: string | null | undefined): string {
	if (!value) {
		return "未记录时间";
	}
	const date = new Date(value);
	if (Number.isNaN(date.valueOf())) {
		return value;
	}
	return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export function formatId(value: string): string {
	if (value.length <= 12) {
		return value;
	}
	const prefix = value.slice(0, 6);
	const suffix = value.slice(-4);
	return `${prefix}...${suffix}`;
}
