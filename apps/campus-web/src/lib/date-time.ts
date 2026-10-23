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

export function formatDate(value: string): string {
	return formatTimestamp(value).slice(0, 10);
}

const SHANGHAI_PARTS = new Intl.DateTimeFormat("zh-CN", {
	day: "numeric",
	hour: "2-digit",
	hourCycle: "h23",
	minute: "2-digit",
	month: "numeric",
	timeZone: "Asia/Shanghai",
	year: "numeric",
});

function shanghaiParts(date: Date) {
	const parts = Object.fromEntries(
		SHANGHAI_PARTS.formatToParts(date).map((part) => [part.type, part.value]),
	);
	return {
		day: Number(parts.day),
		month: Number(parts.month),
		time: `${parts.hour}:${parts.minute}`,
		year: Number(parts.year),
	};
}

/** 按上海日历描述时间：今天/昨天带时刻，今年内只写月日，跨年写完整日期。 */
export function formatCalendarTime(value: string, now: Date = new Date()): string {
	const date = new Date(value);
	if (Number.isNaN(date.valueOf())) {
		return value;
	}
	const target = shanghaiParts(date);
	const today = shanghaiParts(now);
	// Shanghai has no DST, so one fixed day back always lands on the previous calendar day.
	const yesterday = shanghaiParts(new Date(now.valueOf() - 24 * 60 * 60 * 1000));
	const sameDay = (a: typeof target, b: typeof target) =>
		a.year === b.year && a.month === b.month && a.day === b.day;
	if (sameDay(target, today)) {
		return `今天 ${target.time}`;
	}
	if (sameDay(target, yesterday)) {
		return `昨天 ${target.time}`;
	}
	if (target.year === today.year) {
		return `${target.month}月${target.day}日`;
	}
	return `${target.year}年${target.month}月${target.day}日`;
}
