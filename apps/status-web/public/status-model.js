export const STATUS_LABELS = Object.freeze({
	operational: "运行正常",
	degraded: "部分受影响",
	outage: "服务中断",
	unknown: "状态未知",
});

export const STATUS_SUMMARY_LABELS = Object.freeze({
	operational: "正常",
	degraded: "受影响",
	outage: "中断",
	unknown: "未知",
});

const STATUS_ORDER = Object.freeze(["operational", "degraded", "outage", "unknown"]);
const STATUS_SET = new Set(Object.keys(STATUS_LABELS));
export const STATUS_TIME_ZONE = "Asia/Shanghai";
export const STATUS_REFRESH_INTERVAL_MS = 60_000;

const STATUS_DAY_FORMATTER = new Intl.DateTimeFormat("en", {
	day: "2-digit",
	month: "2-digit",
	timeZone: STATUS_TIME_ZONE,
	year: "numeric",
});

export function validStatus(value) {
	return typeof value === "string" && STATUS_SET.has(value);
}

export function parseDate(value) {
	if (value instanceof Date) {
		const copy = new Date(value.getTime());
		return Number.isNaN(copy.getTime()) ? null : copy;
	}
	if (typeof value !== "string" && typeof value !== "number") {
		return null;
	}
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

export function statusCalendarDay(value) {
	const date = parseDate(value);
	if (!date) {
		return null;
	}
	const parts = Object.fromEntries(
		STATUS_DAY_FORMATTER.formatToParts(date)
			.filter((part) => part.type === "year" || part.type === "month" || part.type === "day")
			.map((part) => [part.type, part.value]),
	);
	return parts.year && parts.month && parts.day
		? `${parts.year}-${parts.month}-${parts.day}`
		: null;
}

export function timelineDays(entries, referenceDate = new Date()) {
	const anchorDay = statusCalendarDay(referenceDate) ?? statusCalendarDay(new Date());
	const [year, month, day] = (anchorDay ?? "1970-01-01").split("-").map(Number);
	const anchor = new Date(Date.UTC(year, month - 1, day));
	const byDay = new Map();
	if (Array.isArray(entries)) {
		for (const entry of entries) {
			if (entry && typeof entry.day === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(entry.day)) {
				byDay.set(entry.day, validStatus(entry.status) ? entry.status : "unknown");
			}
		}
	}
	return Array.from({ length: 30 }, (_, index) => {
		const date = new Date(anchor.getTime());
		date.setUTCDate(date.getUTCDate() - (29 - index));
		const day = date.toISOString().slice(0, 10);
		return { day, status: byDay.has(day) ? byDay.get(day) : null };
	});
}

export function timelineCounts(days) {
	const counts = { operational: 0, degraded: 0, outage: 0, unknown: 0, noData: 0 };
	for (const entry of Array.isArray(days) ? days : []) {
		if (entry?.status === null || entry?.status === undefined) {
			counts.noData += 1;
		} else if (validStatus(entry.status)) {
			counts[entry.status] += 1;
		} else {
			counts.unknown += 1;
		}
	}
	return counts;
}

export function timelineSummary(days) {
	const counts = timelineCounts(days);
	const parts = STATUS_ORDER.filter((status) => counts[status] > 0).map(
		(status) => `${counts[status]} 天${STATUS_SUMMARY_LABELS[status]}`,
	);
	if (counts.noData > 0) {
		parts.push(`${counts.noData} 天无历史数据`);
	}
	return parts.join("，") || "暂无历史数据";
}

export function isSnapshotExpired(snapshot, now = new Date()) {
	const expiresAt = parseDate(snapshot?.expiresAt);
	const current = parseDate(now);
	return !(expiresAt && current) || expiresAt.getTime() <= current.getTime();
}

export function formatRelativeTime(value, now = new Date()) {
	const date = parseDate(value);
	const current = parseDate(now);
	if (!(date && current)) {
		return "暂无";
	}
	const seconds = Math.max(0, Math.floor((current.getTime() - date.getTime()) / 1000));
	if (seconds < 60) {
		return "刚刚";
	}
	if (seconds < 3600) {
		return `${Math.floor(seconds / 60)} 分钟前`;
	}
	if (seconds < 86_400) {
		return `${Math.floor(seconds / 3600)} 小时前`;
	}
	return `${Math.floor(seconds / 86_400)} 天前`;
}

export function formatDateTime(value) {
	const date = parseDate(value);
	if (!date) {
		return "暂无";
	}
	return new Intl.DateTimeFormat("zh-CN", {
		dateStyle: "medium",
		timeZone: STATUS_TIME_ZONE,
		timeStyle: "short",
	}).format(date);
}

export function formatDayLabel(day, withYear = true) {
	if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(day)) {
		return "日期未知";
	}
	const [year, month, date] = day.split("-").map(Number);
	const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][
		new Date(Date.UTC(year, month - 1, date)).getUTCDay()
	];
	return withYear ? `${year}年${month}月${date}日 ${weekday}` : `${month}月${date}日 ${weekday}`;
}

export function normalizeItem(item) {
	const id = typeof item?.id === "string" && item.id.length > 0 ? item.id : "unknown-service";
	return {
		...item,
		id,
		name: serviceName(item, id),
		status: validStatus(item?.status) ? item.status : "unknown",
		timeline: Array.isArray(item?.timeline) ? item.timeline : [],
	};
}

export function serviceName(item, id = item?.id) {
	if (typeof item?.name === "string" && item.name.trim()) {
		return item.name.trim();
	}
	if (id === "campus.qa") {
		return "校园问答";
	}
	if (id === "campus.services") {
		return "其他服务";
	}
	return "未命名服务";
}

export function semanticStatus(items, { expired, failed }) {
	const services = (Array.isArray(items) ? items : [])
		.map((item) => ({
			id: item.id,
			name: serviceName(item, item.id),
			status: validStatus(item.status) ? item.status : "unknown",
		}))
		.sort((left, right) => left.id.localeCompare(right.id));
	return {
		expired: Boolean(expired),
		failed: Boolean(failed),
		services,
	};
}

export function semanticStatusSignature(status) {
	return JSON.stringify({
		expired: status.expired,
		failed: status.failed,
		services: status.services.map((service) => [service.id, service.status]),
	});
}

export function semanticChangeAnnouncement(previous, current) {
	if (current.failed) {
		return current.expired
			? "监控数据已过期，暂时无法取得新快照。"
			: current.services.length > 0
				? "状态更新失败，保留最近一次监控结果。"
				: "状态数据尚未载入，页面将继续等待更新。";
	}
	if (current.expired) {
		return "监控数据已过期，当前服务状态需要重新确认。";
	}
	if (previous?.failed || previous?.expired) {
		if (previous.failed && previous.services.length === 0 && !previous.expired) {
			return "状态数据已载入。";
		}
		return "状态数据已恢复更新。";
	}
	if (!previous) {
		return "状态数据已载入。";
	}

	const previousById = new Map(previous.services.map((service) => [service.id, service]));
	const currentById = new Map(current.services.map((service) => [service.id, service]));
	const changedIds = new Set([...previousById.keys(), ...currentById.keys()]);
	const changes = [...changedIds].filter(
		(id) => previousById.get(id)?.status !== currentById.get(id)?.status,
	);
	if (changes.length === 1) {
		const id = changes[0];
		const before = previousById.get(id);
		const after = currentById.get(id);
		if (!(before && after)) {
			return after
				? `${after.name}已加入状态监控，当前状态为${STATUS_LABELS[after.status]}。`
				: `${before.name}已不再发布状态。`;
		}
		return `${after.name}由${STATUS_LABELS[before.status]}变为${STATUS_LABELS[after.status]}。`;
	}
	if (changes.length > 1) {
		return `${changes.length} 项服务状态发生变化。`;
	}
	return null;
}
