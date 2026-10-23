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

export function formatHumanDuration(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
		return "未记录";
	}
	if (value < 1_000) {
		return `${Math.round(value)} 毫秒`;
	}
	if (value < 60_000) {
		return `${(value / 1_000).toFixed(value < 10_000 ? 2 : 1)} 秒`;
	}
	const totalMinutes = Math.floor(value / 60_000);
	const seconds = Math.floor((value % 60_000) / 1_000);
	if (totalMinutes < 60) {
		return seconds > 0 ? `${totalMinutes} 分 ${seconds} 秒` : `${totalMinutes} 分钟`;
	}
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
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
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("zh-CN", {
			day: "2-digit",
			hour: "2-digit",
			hourCycle: "h23",
			minute: "2-digit",
			month: "2-digit",
			second: "2-digit",
			timeZone: "Asia/Shanghai",
			year: "numeric",
		})
			.formatToParts(date)
			.map((part) => [part.type, part.value]),
	);
	return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function formatId(value: string): string {
	if (value.length <= 12) {
		return value;
	}
	const prefix = value.slice(0, 6);
	const suffix = value.slice(-4);
	return `${prefix}...${suffix}`;
}
