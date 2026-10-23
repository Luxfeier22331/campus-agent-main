const DAY_IN_MS = 86_400_000;

const startOfLocalDay = (date: Date): number =>
	new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const padTimePart = (value: number): string => String(value).padStart(2, "0");

export function formatThreadListTime(date: Date | undefined, now = new Date()): string {
	if (!date || Number.isNaN(date.getTime())) {
		return "未发送";
	}

	const startOfToday = startOfLocalDay(now);
	const dateStart = startOfLocalDay(date);
	const time = `${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`;

	if (dateStart >= startOfToday) {
		return time;
	}
	if (dateStart >= startOfToday - DAY_IN_MS) {
		return `昨天 ${time}`;
	}
	if (date.getFullYear() === now.getFullYear()) {
		return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
	}
	return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}
