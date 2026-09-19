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
