const STATUS_LABELS = Object.freeze({
	operational: "运行正常",
	degraded: "部分受影响",
	outage: "服务中断",
	unknown: "状态未知",
});

const STATUS_SUMMARY_LABELS = Object.freeze({
	operational: "正常",
	degraded: "受影响",
	outage: "中断",
	unknown: "未知",
});

const STATUS_ORDER = Object.freeze(["operational", "degraded", "outage", "unknown"]);
const STATUS_SET = new Set(Object.keys(STATUS_LABELS));
const STATUS_SNAPSHOT_SCHEMA_VERSION = "product-availability-snapshot.v1";
const STATUS_SERVICES = Object.freeze([
	Object.freeze({ id: "campus.qa", name: "校园问答" }),
	Object.freeze({ id: "campus.services", name: "其他服务" }),
]);
const THEME_KEY = "campus-agent.theme";
const THEME_MODE_LABELS = Object.freeze({
	system: "跟随系统",
	light: "浅色",
	dark: "深色",
});
const THEME_MODES = Object.freeze(Object.keys(THEME_MODE_LABELS));
let activeThemeTransition = null;
export const STATUS_TIME_ZONE = "Asia/Shanghai";
export const STATUS_REQUEST_TIMEOUT_MS = 10_000;
const STATUS_REFRESH_INTERVAL_MS = 60_000;

const STATUS_DAY_FORMATTER = new Intl.DateTimeFormat("en", {
	day: "2-digit",
	month: "2-digit",
	timeZone: STATUS_TIME_ZONE,
	year: "numeric",
});

const MONITOR_ICON =
	'<rect x="3" y="4" width="18" height="12" rx="1"></rect><path d="M8 20h8"></path><path d="M12 16v4"></path>';
const MOON_ICON = '<path d="M20.5 15.2A8 8 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2z"></path>';
const SUN_ICON =
	'<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path>';

export { STATUS_LABELS, STATUS_SUMMARY_LABELS };

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

function normalizeItem(item) {
	const id = typeof item?.id === "string" && item.id.length > 0 ? item.id : "unknown-service";
	return {
		...item,
		id,
		name: serviceName(item, id),
		status: validStatus(item?.status) ? item.status : "unknown",
		timeline: Array.isArray(item?.timeline) ? item.timeline : [],
	};
}

function serviceName(item, id = item?.id) {
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

function escapeHtml(value) {
	return String(value).replace(
		/[&<>"']/g,
		(character) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#039;",
			})[character],
	);
}

function statusForTimeline(entry) {
	return entry?.status === null || entry?.status === undefined
		? { className: "no-data", label: "无历史数据", status: null }
		: validStatus(entry.status)
			? { className: entry.status, label: STATUS_LABELS[entry.status], status: entry.status }
			: { className: "unknown", label: STATUS_LABELS.unknown, status: "unknown" };
}

function timelineStatusNote(status) {
	if (status === null) {
		return "这一天没有发布历史数据。";
	}
	if (status === "unknown") {
		return "这一天的探测结果未知。";
	}
	return "";
}

function timelineValueText(name, entry) {
	const state = statusForTimeline(entry);
	return `${name}，${formatDayLabel(entry?.day)}：${state.label}`;
}

function renderTimeline(item, days) {
	const name = serviceName(item, item.id);
	const activeIndex = Math.max(0, days.length - 1);
	const activeEntry = days[activeIndex] ?? { day: "", status: null };
	const bars = days
		.map((entry, index) => {
			const state = statusForTimeline(entry);
			const status = state.status ?? "no-data";
			return `<span aria-hidden="true" class="timeline-bar ${state.className}" data-day="${escapeHtml(entry.day)}" data-index="${index}" data-status="${status}" data-label="${escapeHtml(state.label)}" data-active="${index === activeIndex ? "true" : "false"}"></span>`;
		})
		.join("");
	const firstDay = days[0]?.day ?? "";
	const lastDay = days.at(-1)?.day ?? "";
	const activeState = statusForTimeline(activeEntry);
	return `<div class="timeline"><div class="timeline-heading"><strong>过去 30 天</strong><span>${escapeHtml(timelineSummary(days))}</span></div><div class="timeline-viewport"><div aria-label="${escapeHtml(name)}过去 30 天每日状态时间线" aria-valuemax="30" aria-valuemin="1" aria-valuenow="${activeIndex + 1}" aria-valuetext="${escapeHtml(timelineValueText(name, activeEntry))}" class="timeline-slider" data-active-index="${activeIndex}" data-day="${escapeHtml(activeEntry.day)}" data-label="${escapeHtml(activeState.label)}" data-service-name="${escapeHtml(name)}" data-status="${activeState.status ?? "no-data"}" role="slider" tabindex="0">${bars}</div><div class="timeline-labels"><span>${escapeHtml(formatDayLabel(firstDay, false))}</span><span>${escapeHtml(formatDayLabel(lastDay, false))}</span></div></div></div>`;
}

function renderService(item, state, now) {
	const status = validStatus(item.status) ? item.status : "unknown";
	const name = serviceName(item, item.id);
	const days = timelineDays(item.timeline, state.snapshot?.generatedAt ?? now);
	const checkedAt = parseDate(item.checkedAt);
	const checkedTitle = checkedAt ? `完整时间：${formatDateTime(checkedAt)}` : "尚未完成检查";
	const meta = checkedAt ? "" : '<span class="service-meta">尚未检查</span>';
	return `<article class="service-row" data-service-id="${escapeHtml(item.id)}"><div class="service-row-header"><div class="service-identity"><h2 class="service-name">${escapeHtml(name)}</h2>${meta}</div><div class="service-summary-side"><span class="service-status"><span class="status-dot ${status}" aria-hidden="true"></span><span>${escapeHtml(STATUS_LABELS[status])}</span></span></div></div><div class="detail-meta"><span>最近检查</span><time datetime="${checkedAt ? escapeHtml(checkedAt.toISOString()) : ""}" title="${escapeHtml(checkedTitle)}">${escapeHtml(checkedAt ? formatDateTime(checkedAt) : "暂无")}</time></div>${renderTimeline(item, days)}</article>`;
}

function renderServices(items, state, now) {
	return items.map((item) => renderService(item, state, now)).join("");
}

function setTimelineActive(slider, nextIndex, { focus = false } = {}) {
	if (!(slider instanceof HTMLElement)) {
		return;
	}
	const bars = [...slider.querySelectorAll(".timeline-bar")];
	if (bars.length === 0) {
		return;
	}
	const index = Math.max(0, Math.min(bars.length - 1, Number(nextIndex) || 0));
	const active = bars[index];
	for (const [candidateIndex, candidate] of bars.entries()) {
		candidate.dataset.active = String(candidateIndex === index);
	}
	slider.dataset.activeIndex = String(index);
	slider.dataset.day = active?.dataset.day ?? "";
	slider.dataset.status = active?.dataset.status ?? "unknown";
	slider.dataset.label = active?.dataset.label ?? STATUS_LABELS.unknown;
	slider.setAttribute("aria-valuenow", String(index + 1));
	slider.setAttribute(
		"aria-valuetext",
		`${slider.dataset.serviceName ?? "服务"}，${formatDayLabel(slider.dataset.day)}：${slider.dataset.label}`,
	);
	if (focus) {
		slider.focus({ preventScroll: true });
	}
}

function serviceRowById(services, serviceId) {
	return [...services.querySelectorAll(".service-row[data-service-id]")].find(
		(row) => row.dataset.serviceId === serviceId,
	);
}

function captureFocusState(services) {
	const active = document.activeElement;
	if (!(active instanceof Element && services.contains(active))) {
		return null;
	}
	const slider = active.closest(".timeline-slider");
	const row = slider?.closest(".service-row[data-service-id]");
	if (!(slider && row?.dataset.serviceId)) {
		return null;
	}
	return {
		day: slider.dataset.day ?? "",
		index: Number(slider.dataset.activeIndex) || 0,
		kind: "timeline-slider",
		serviceId: row.dataset.serviceId,
	};
}

function restoreFocusState(services, focusState) {
	if (!focusState) {
		return;
	}
	const row = serviceRowById(services, focusState.serviceId);
	if (!row) {
		return;
	}
	const slider = row.querySelector(".timeline-slider");
	if (slider instanceof HTMLElement) {
		const bars = [...slider.querySelectorAll(".timeline-bar")];
		const matchingIndex = bars.findIndex((bar) => bar.dataset.day === focusState.day);
		setTimelineActive(slider, matchingIndex >= 0 ? matchingIndex : focusState.index, {
			focus: true,
		});
	}
}

function timelineIndexAtClientX(slider, clientX) {
	const rect = slider.getBoundingClientRect();
	const count = slider.querySelectorAll(".timeline-bar").length;
	if (!(rect.width > 0 && count > 0 && Number.isFinite(clientX))) {
		return Number(slider.dataset.activeIndex) || 0;
	}
	const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
	return Math.round(ratio * (count - 1));
}

function createTimelineTooltip(tooltip, coarseMediaQuery) {
	let openTrigger = null;
	let previousDescribedBy = null;

	function isCoarse() {
		return coarseMediaQuery?.matches ?? false;
	}

	function rectanglesIntersect(left, right) {
		return (
			left.left < right.right &&
			left.right > right.left &&
			left.top < right.bottom &&
			left.bottom > right.top
		);
	}

	function blockedRectangles(row) {
		return [...document.querySelectorAll(".service-row, .page-legend")]
			.filter((element) => element !== row && !element.hasAttribute("hidden"))
			.map((element) => element.getBoundingClientRect())
			.filter((rect) => rect.width > 0 && rect.height > 0);
	}

	function position(trigger) {
		if (tooltip.hidden || !trigger) {
			return;
		}
		const anchor = trigger.querySelector('.timeline-bar[data-active="true"]') ?? trigger;
		const rect = anchor.getBoundingClientRect();
		const row = trigger.closest(".service-row");
		const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 320;
		const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 640;
		const tooltipRect = tooltip.getBoundingClientRect();
		const width = tooltipRect.width || Math.min(280, viewportWidth - 24);
		const height = tooltipRect.height || 70;
		const margin = 12;
		const mobile = isCoarse() || viewportWidth <= 767;
		let left = rect.left + (rect.width - width) / 2;
		left = Math.max(margin, Math.min(left, viewportWidth - width - margin));
		const rowRect = row?.getBoundingClientRect();
		const candidates = mobile
			? [
					{ placement: "above", top: rect.top - height - 10 },
					{ placement: "below", top: rect.bottom + 10 },
					...(rowRect
						? [
								{ placement: "row-top", top: rowRect.top + margin },
								{ placement: "row-bottom", top: rowRect.bottom - height - margin },
							]
						: []),
				]
			: [
					{ placement: "above", top: rect.top - height - 10 },
					{ placement: "below", top: rect.bottom + 10 },
					...(rowRect ? [{ placement: "row-top", top: rowRect.top + margin }] : []),
				];
		const blocked = blockedRectangles(row);
		const minTop = margin;
		const maxTop = Math.max(minTop, viewportHeight - height - margin);
		const candidate = candidates.find(({ top }) => {
			const boundedTop = Math.max(minTop, Math.min(top, maxTop));
			const candidateRect = {
				bottom: boundedTop + height,
				left,
				right: left + width,
				top: boundedTop,
			};
			return !blocked.some((blockedRect) => rectanglesIntersect(candidateRect, blockedRect));
		});
		const fallback = candidate ?? candidates[0] ?? { placement: "fallback", top: minTop };
		const top = Math.max(minTop, Math.min(fallback.top, maxTop));
		tooltip.dataset.placement = fallback.placement;
		tooltip.style.left = `${Math.round(left)}px`;
		tooltip.style.top = `${Math.round(top)}px`;
	}

	function show(trigger) {
		if (!(trigger instanceof HTMLElement && trigger.isConnected)) {
			return;
		}
		if (openTrigger && openTrigger !== trigger) {
			close();
		}
		if (openTrigger !== trigger) {
			previousDescribedBy = trigger.getAttribute("aria-describedby");
			openTrigger = trigger;
		}
		const status = trigger.dataset.status ?? "unknown";
		const title = tooltip.querySelector(".timeline-tooltip-title");
		const statusNode = tooltip.querySelector(".timeline-tooltip-status");
		const note = tooltip.querySelector(".timeline-tooltip-note");
		if (title) {
			title.textContent = `${trigger.dataset.serviceName ?? "服务"} · ${formatDayLabel(trigger.dataset.day)}`;
		}
		if (statusNode) {
			statusNode.textContent = trigger.dataset.label ?? STATUS_LABELS.unknown;
		}
		if (note) {
			note.textContent = timelineStatusNote(status === "no-data" ? null : status);
			note.hidden = !note.textContent;
		}
		tooltip.dataset.status = status;
		tooltip.hidden = false;
		trigger.setAttribute("aria-describedby", "timeline-tooltip");
		if ((isCoarse() || window.innerWidth <= 767) && typeof trigger.scrollIntoView === "function") {
			const triggerRect = (
				trigger.querySelector('.timeline-bar[data-active="true"]') ?? trigger
			).getBoundingClientRect();
			const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 640;
			if (triggerRect.top < 12 || triggerRect.bottom > viewportHeight - 12) {
				trigger.scrollIntoView({ block: "nearest", inline: "nearest" });
			}
		}
		position(trigger);
	}

	function close() {
		if (openTrigger) {
			if (previousDescribedBy) {
				openTrigger.setAttribute("aria-describedby", previousDescribedBy);
			} else {
				openTrigger.removeAttribute("aria-describedby");
			}
		}
		openTrigger = null;
		previousDescribedBy = null;
		tooltip.hidden = true;
		tooltip.removeAttribute("data-status");
		tooltip.removeAttribute("data-placement");
	}

	function closeIf(trigger) {
		queueMicrotask(() => {
			if (openTrigger === trigger && document.activeElement !== trigger) {
				close();
			}
		});
	}

	function handleDocumentPointerDown(event) {
		const target = event.target instanceof Element ? event.target : null;
		if (
			openTrigger &&
			!(target?.closest(".timeline-slider") || target === tooltip || tooltip.contains(target))
		) {
			close();
		}
	}

	function handleDocumentKeydown(event) {
		if (event.key === "Escape" && openTrigger) {
			event.preventDefault();
			close();
		}
	}

	function handleResize() {
		position(openTrigger);
	}

	function handleScroll() {
		position(openTrigger);
	}

	document.addEventListener("pointerdown", handleDocumentPointerDown);
	document.addEventListener("click", handleDocumentPointerDown);
	document.addEventListener("keydown", handleDocumentKeydown);
	window.addEventListener("resize", handleResize, { passive: true });
	window.addEventListener("scroll", handleScroll, { passive: true, capture: true });

	return {
		close,
		closeIf,
		show,
		destroy: () => {
			close();
			document.removeEventListener("pointerdown", handleDocumentPointerDown);
			document.removeEventListener("click", handleDocumentPointerDown);
			document.removeEventListener("keydown", handleDocumentKeydown);
			window.removeEventListener("resize", handleResize);
			window.removeEventListener("scroll", handleScroll, true);
		},
	};
}

function semanticStatus(items, { expired, failed }) {
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

function semanticStatusSignature(status) {
	return JSON.stringify({
		expired: status.expired,
		failed: status.failed,
		services: status.services.map((service) => [service.id, service.status]),
	});
}

function semanticChangeAnnouncement(previous, current) {
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

function isThemeMode(value) {
	return typeof value === "string" && THEME_MODES.includes(value);
}

function resolvedThemeForMode(mode, systemMatches = false) {
	return mode === "system" ? (systemMatches ? "dark" : "light") : mode;
}

function themeIconForMode(mode) {
	return mode === "system" ? MONITOR_ICON : mode === "dark" ? MOON_ICON : SUN_ICON;
}

function updateThemeControls(mode) {
	const label = THEME_MODE_LABELS[mode] ?? THEME_MODE_LABELS.system;
	const trigger = document.getElementById("theme-toggle");
	const icon = document.getElementById("theme-icon");
	if (icon) {
		icon.innerHTML = themeIconForMode(mode);
	}
	if (trigger) {
		const accessibleLabel = `外观，当前${label}`;
		trigger.title = accessibleLabel;
		trigger.setAttribute("aria-label", accessibleLabel);
	}
	for (const option of document.querySelectorAll("[data-theme-option]")) {
		if (option instanceof HTMLElement) {
			option.setAttribute("aria-checked", String(option.dataset.themeOption === mode));
		}
	}
	for (const input of document.querySelectorAll('input[name="status-theme-mode"]')) {
		if (input instanceof HTMLInputElement) {
			input.checked = input.value === mode;
		}
	}
}

function applyTheme(mode, persist = false, animate = true) {
	const nextMode = isThemeMode(mode) ? mode : "system";
	const systemMatches = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
	const nextTheme = resolvedThemeForMode(nextMode, systemMatches);
	const currentTheme = document.documentElement.dataset.theme ?? "light";
	const update = () => {
		document.documentElement.dataset.theme = nextTheme;
		document.documentElement.dataset.themeMode = nextMode;
		document.documentElement.style.colorScheme = nextTheme;
		updateThemeControls(nextMode);
	};
	const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
	const canTransition =
		animate &&
		currentTheme !== nextTheme &&
		!reduceMotion &&
		typeof document.startViewTransition === "function";
	if (activeThemeTransition) {
		activeThemeTransition.skipTransition();
		activeThemeTransition = null;
	}
	if (canTransition) {
		try {
			const transition = document.startViewTransition(update);
			activeThemeTransition = transition;
			void transition.finished
				.catch(() => undefined)
				.finally(() => {
					if (activeThemeTransition === transition) {
						activeThemeTransition = null;
					}
				});
		} catch {
			update();
		}
	} else {
		update();
	}
	if (persist) {
		try {
			window.localStorage.setItem(THEME_KEY, nextMode);
		} catch {
			/* Storage is optional. */
		}
	}
}

function storedThemeMode() {
	try {
		const value = window.localStorage.getItem(THEME_KEY);
		return isThemeMode(value) ? value : null;
	} catch {
		return null;
	}
}

/**
 * @param {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} fetchFn
 * @param {{ etag?: string | null, timeoutMs?: number }} options
 * @returns {Promise<{ kind: "empty", etag: null } | { kind: "not-modified", etag: string | null } | { kind: "snapshot", etag: string | null, snapshot: Record<string, unknown> }>}
 */
export async function fetchStatusSnapshot(
	fetchFn = (...args) => globalThis.fetch(...args),
	{ etag = null, timeoutMs = STATUS_REQUEST_TIMEOUT_MS } = {},
) {
	const controller = new AbortController();
	let timeoutId;
	const timeout = new Promise((_, reject) => {
		timeoutId = setTimeout(() => {
			controller.abort();
			reject(new Error("status request timed out"));
		}, timeoutMs);
	});
	try {
		const headers = new Headers({ accept: "application/json" });
		if (etag) {
			headers.set("if-none-match", etag);
		}
		const response = await Promise.race([
			Promise.resolve().then(() =>
				fetchFn("/api/status", {
					cache: "no-cache",
					headers,
					signal: controller.signal,
				}),
			),
			timeout,
		]);
		if (response.status === 304) {
			return { etag: response.headers.get("etag") ?? etag, kind: "not-modified" };
		}
		if (response.status === 204) {
			return { etag: null, kind: "empty" };
		}
		if (!response.ok) {
			throw new Error("status unavailable");
		}
		const snapshot = await Promise.race([response.json(), timeout]);
		if (
			!snapshot ||
			typeof snapshot !== "object" ||
			snapshot.schemaVersion !== STATUS_SNAPSHOT_SCHEMA_VERSION ||
			!Array.isArray(snapshot.services) ||
			snapshot.services.length !== STATUS_SERVICES.length ||
			!STATUS_SERVICES.every(
				(expected, index) =>
					snapshot.services[index]?.id === expected.id &&
					snapshot.services[index]?.name === expected.name,
			)
		) {
			throw new Error("invalid status snapshot");
		}
		return { etag: response.headers.get("etag") ?? etag, kind: "snapshot", snapshot };
	} finally {
		clearTimeout(timeoutId);
	}
}

export function initStatusPage(options = {}) {
	const services = document.getElementById("services");
	const themeToggle = document.getElementById("theme-toggle");
	const themeMenu = document.getElementById("theme-menu");
	const themeMenuContent = document.getElementById("theme-menu-content");
	const themeOptions = [...document.querySelectorAll("[data-theme-option]")].filter(
		(option) => option instanceof HTMLElement,
	);
	const mobileThemeInputs = [
		...document.querySelectorAll('input[name="status-theme-mode"]'),
	].filter((input) => input instanceof HTMLInputElement);
	const mobileMenu = document.getElementById("mobile-menu");
	const mobileMenuTrigger = document.getElementById("mobile-menu-trigger");
	const mobileMenuClose = document.getElementById("mobile-menu-close");
	const monitoringNotice = document.getElementById("monitoring-notice");
	const statusAnnouncement = document.getElementById("status-announcement");
	const timelineLegend = document.getElementById("timeline-legend");
	const timelineTooltip = document.getElementById("timeline-tooltip");
	if (
		!(
			services &&
			themeToggle &&
			themeMenu &&
			themeMenuContent &&
			monitoringNotice &&
			statusAnnouncement &&
			timelineLegend &&
			timelineTooltip
		)
	) {
		return;
	}

	const state = {
		etag: null,
		snapshot: null,
		displayedExpired: false,
		loading: false,
		semanticStatus: null,
		themeMode: storedThemeMode() ?? "system",
	};
	services.setAttribute("aria-busy", "true");
	const fetchFn = options.fetchFn ?? ((...args) => globalThis.fetch(...args));
	const now = options.now ?? (() => new Date());
	const coarseMediaQuery = window.matchMedia?.("(pointer: coarse)");
	const themeMediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
	const tooltipController = createTimelineTooltip(timelineTooltip, coarseMediaQuery);
	let announcementTimer = null;
	let expiryTimer = null;
	let hoveredTimelineSlider = null;
	let menuRestoreFocus = true;
	let themeMenuOpen = false;

	function setMobileMenuOpen(nextOpen, { restoreFocus = true } = {}) {
		if (
			typeof HTMLDialogElement === "undefined" ||
			!(mobileMenu instanceof HTMLDialogElement) ||
			!(mobileMenuTrigger instanceof HTMLElement)
		) {
			return;
		}
		menuRestoreFocus = restoreFocus;
		if (nextOpen) {
			if (!mobileMenu.open) {
				try {
					if (typeof mobileMenu.showModal === "function") {
						mobileMenu.showModal();
					} else {
						mobileMenu.setAttribute("open", "");
					}
				} catch {
					mobileMenu.setAttribute("open", "");
				}
			}
			mobileMenuTrigger.setAttribute("aria-expanded", "true");
			window.requestAnimationFrame(() => {
				if (mobileMenu.open && mobileMenuClose instanceof HTMLElement) {
					mobileMenuClose.focus({ preventScroll: true });
				}
			});
			return;
		}
		if (mobileMenu.open) {
			if (typeof mobileMenu.close === "function") {
				mobileMenu.close();
			} else {
				mobileMenu.removeAttribute("open");
			}
		}
		mobileMenu.removeAttribute("open");
		mobileMenuTrigger.setAttribute("aria-expanded", "false");
		if (menuRestoreFocus) {
			mobileMenuTrigger.focus({ preventScroll: true });
		}
	}

	function handleMobileMenuTrigger() {
		setMobileMenuOpen(true);
	}

	function handleMobileMenuClose() {
		setMobileMenuOpen(false);
	}

	function handleMobileMenuCancel(event) {
		event.preventDefault();
		setMobileMenuOpen(false);
	}

	function handleMobileMenuClick(event) {
		if (event.target === mobileMenu) {
			setMobileMenuOpen(false);
		}
	}

	function handleMobileMenuKeydown(event) {
		if (event.key === "Escape" && mobileMenu?.open) {
			event.preventDefault();
			setMobileMenuOpen(false);
		}
	}

	function setThemeMenuOpen(nextOpen, { focusSelected = false } = {}) {
		themeMenuOpen = nextOpen;
		themeMenuContent.hidden = !nextOpen;
		themeToggle.setAttribute("aria-expanded", String(nextOpen));
		if (nextOpen && focusSelected) {
			const selected = themeOptions.find(
				(option) => option.getAttribute("aria-checked") === "true",
			);
			window.requestAnimationFrame(() => {
				(selected ?? themeOptions[0])?.focus({ preventScroll: true });
			});
		}
	}

	function handleThemeToggleClick() {
		setThemeMenuOpen(!themeMenuOpen, { focusSelected: !themeMenuOpen });
	}

	function handleThemeOptionClick(event) {
		const target =
			event.target instanceof Element ? event.target.closest("[data-theme-option]") : null;
		const mode = target instanceof HTMLElement ? target.dataset.themeOption : null;
		if (!isThemeMode(mode)) {
			return;
		}
		state.themeMode = mode;
		applyTheme(mode, true);
		setThemeMenuOpen(false);
		themeToggle.focus({ preventScroll: true });
	}

	function handleThemeMenuKeydown(event) {
		if (event.key === "Escape") {
			event.preventDefault();
			setThemeMenuOpen(false);
			themeToggle.focus({ preventScroll: true });
			return;
		}
		if (event.key === "Tab") {
			setThemeMenuOpen(false);
			return;
		}
		const currentIndex = themeOptions.indexOf(document.activeElement);
		if (currentIndex < 0) {
			return;
		}
		let nextIndex = currentIndex;
		if (event.key === "ArrowDown" || event.key === "ArrowRight") {
			nextIndex = Math.min(themeOptions.length - 1, currentIndex + 1);
		} else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
			nextIndex = Math.max(0, currentIndex - 1);
		} else if (event.key === "Home") {
			nextIndex = 0;
		} else if (event.key === "End") {
			nextIndex = themeOptions.length - 1;
		} else {
			return;
		}
		event.preventDefault();
		themeOptions[nextIndex]?.focus({ preventScroll: true });
	}

	function handleThemeOutsidePointer(event) {
		if (themeMenuOpen && event.target instanceof Node && !themeMenu.contains(event.target)) {
			setThemeMenuOpen(false);
		}
	}

	function handleMobileThemeChange(event) {
		const input = event.target instanceof HTMLInputElement ? event.target : null;
		if (!(input && isThemeMode(input.value))) {
			return;
		}
		state.themeMode = input.value;
		applyTheme(input.value, true);
	}

	function announce(message) {
		if (!message) {
			return;
		}
		if (announcementTimer !== null) {
			window.clearTimeout(announcementTimer);
			announcementTimer = null;
		}
		if (statusAnnouncement.textContent !== message) {
			statusAnnouncement.textContent = message;
			return;
		}
		statusAnnouncement.textContent = "";
		announcementTimer = window.setTimeout(() => {
			statusAnnouncement.textContent = message;
			announcementTimer = null;
		}, 0);
	}

	function publishSemanticStatus(items, { expired, failed }) {
		const current = semanticStatus(items, { expired, failed });
		const previous = state.semanticStatus;
		if (!previous || semanticStatusSignature(previous) !== semanticStatusSignature(current)) {
			announce(semanticChangeAnnouncement(previous, current));
		}
		state.semanticStatus = current;
	}

	function setMonitoringNotice(snapshot, { expired = false, failed = false } = {}) {
		if (!(expired || (failed && snapshot))) {
			monitoringNotice.hidden = true;
			monitoringNotice.textContent = "";
			monitoringNotice.removeAttribute("data-kind");
			return;
		}
		const generatedAt = parseDate(snapshot?.generatedAt);
		const lastUpdated = generatedAt
			? `最近成功更新：${formatRelativeTime(generatedAt, now())}。`
			: "";
		monitoringNotice.dataset.kind = expired ? "expired" : "stale";
		monitoringNotice.textContent = expired
			? `监控数据已过期，当前状态暂不可确认。${lastUpdated}`
			: `暂时无法更新监控数据，保留最近一次结果。${lastUpdated}`;
		monitoringNotice.hidden = false;
	}

	function render(snapshot, { failed = false, replaceServices = true } = {}) {
		if (replaceServices) {
			tooltipController.close();
			hoveredTimelineSlider = null;
		}
		const focusState = replaceServices ? captureFocusState(services) : null;
		state.snapshot = snapshot && typeof snapshot === "object" ? snapshot : null;
		const expired = isSnapshotExpired(snapshot, now());
		const rawItems = snapshot.services.map(normalizeItem);
		const items = expired ? rawItems.map((item) => ({ ...item, status: "unknown" })) : rawItems;
		setMonitoringNotice(snapshot, { expired, failed });
		services.setAttribute("aria-busy", "false");
		if (replaceServices) {
			services.innerHTML = renderServices(items, state, now());
		}
		timelineLegend.hidden = false;
		state.displayedExpired = expired;
		if (replaceServices) {
			restoreFocusState(services, focusState);
			if (focusState) {
				tooltipController.close();
			}
		}
		resetExpiryTimer();
		publishSemanticStatus(items, { expired, failed });
	}

	function renderError() {
		if (state.snapshot) {
			const expired = isSnapshotExpired(state.snapshot, now());
			render(state.snapshot, { failed: true, replaceServices: expired && !state.displayedExpired });
			return;
		}
		setMonitoringNotice(null);
		timelineLegend.hidden = true;
		publishSemanticStatus([], { expired: false, failed: true });
	}

	function setLoading(loading) {
		state.loading = loading;
		services.setAttribute("aria-busy", String(loading || !state.snapshot));
	}

	async function load() {
		if (state.loading) {
			return;
		}
		setLoading(true);
		try {
			const result = await fetchStatusSnapshot(fetchFn, { etag: state.etag });
			if (result.kind === "empty") {
				state.etag = null;
				if (state.snapshot) {
					renderError();
				}
			} else if (result.kind === "not-modified") {
				if (!state.snapshot) {
					throw new Error("status snapshot missing for 304 response");
				}
				state.etag = result.etag;
				const expired = isSnapshotExpired(state.snapshot, now());
				render(state.snapshot, { replaceServices: expired && !state.displayedExpired });
			} else {
				state.etag = result.etag;
				render(result.snapshot);
			}
		} catch {
			renderError();
		} finally {
			setLoading(false);
		}
	}

	function handleServicesClick(event) {
		const target = event.target instanceof Element ? event.target : null;
		if (!target) {
			return;
		}
		const slider = target.closest(".timeline-slider");
		if (slider instanceof HTMLElement && services.contains(slider)) {
			setTimelineActive(slider, timelineIndexAtClientX(slider, event.clientX));
			tooltipController.show(slider);
		}
	}

	function handleServicesKeydown(event) {
		const slider =
			event.target instanceof Element ? event.target.closest(".timeline-slider") : null;
		if (!(slider instanceof HTMLElement && services.contains(slider))) {
			return;
		}
		const count = slider.querySelectorAll(".timeline-bar").length;
		const currentIndex = Number(slider.dataset.activeIndex) || 0;
		let nextIndex = currentIndex;
		if (event.key === "ArrowLeft") {
			nextIndex = Math.max(0, currentIndex - 1);
		} else if (event.key === "ArrowDown") {
			nextIndex = Math.max(0, currentIndex - 1);
		} else if (event.key === "ArrowRight") {
			nextIndex = Math.min(count - 1, currentIndex + 1);
		} else if (event.key === "ArrowUp") {
			nextIndex = Math.min(count - 1, currentIndex + 1);
		} else if (event.key === "Home") {
			nextIndex = 0;
		} else if (event.key === "End") {
			nextIndex = count - 1;
		} else {
			return;
		}
		event.preventDefault();
		setTimelineActive(slider, nextIndex, { focus: true });
		tooltipController.show(slider);
	}

	function handleServicesPointerOver(event) {
		if (coarseMediaQuery?.matches) {
			return;
		}
		const target = event.target instanceof Element ? event.target : null;
		const slider = target?.closest(".timeline-slider");
		if (!(slider instanceof HTMLElement && services.contains(slider))) {
			return;
		}
		if (event.relatedTarget instanceof Node && slider.contains(event.relatedTarget)) {
			return;
		}
		setTimelineActive(slider, timelineIndexAtClientX(slider, event.clientX));
		hoveredTimelineSlider = slider;
		tooltipController.show(slider);
	}

	function handleServicesPointerMove(event) {
		if (coarseMediaQuery?.matches) {
			return;
		}
		const target = event.target instanceof Element ? event.target : null;
		const slider = target?.closest(".timeline-slider");
		if (!(slider instanceof HTMLElement && services.contains(slider))) {
			return;
		}
		setTimelineActive(slider, timelineIndexAtClientX(slider, event.clientX));
		hoveredTimelineSlider = slider;
		tooltipController.show(slider);
	}

	function handleServicesPointerOut(event) {
		if (coarseMediaQuery?.matches) {
			return;
		}
		const target = event.target instanceof Element ? event.target : null;
		const slider = target?.closest(".timeline-slider");
		if (!(slider instanceof HTMLElement && services.contains(slider))) {
			return;
		}
		if (event.relatedTarget instanceof Node && slider.contains(event.relatedTarget)) {
			return;
		}
		if (hoveredTimelineSlider === slider) {
			hoveredTimelineSlider = null;
		}
		tooltipController.closeIf(slider);
	}

	function handleServicesFocusIn(event) {
		const target = event.target instanceof Element ? event.target : null;
		const slider = target?.closest(".timeline-slider");
		if (slider instanceof HTMLElement && services.contains(slider)) {
			setTimelineActive(slider, Number(slider.dataset.activeIndex) || 0);
			tooltipController.show(slider);
		}
	}

	function handleServicesFocusOut(event) {
		const target = event.target instanceof Element ? event.target : null;
		const slider = target?.closest(".timeline-slider");
		if (
			slider instanceof HTMLElement &&
			services.contains(slider) &&
			hoveredTimelineSlider !== slider
		) {
			tooltipController.closeIf(slider);
		}
	}

	function handleVisibilityChange() {
		if (document.visibilityState === "visible") {
			refreshExpiryState();
		}
	}

	function refreshExpiryState() {
		if (!state.snapshot) {
			return;
		}
		const expired = isSnapshotExpired(state.snapshot, now());
		if (expired !== state.displayedExpired) {
			render(state.snapshot, { replaceServices: true });
		}
		resetExpiryTimer();
	}

	function resetExpiryTimer() {
		if (expiryTimer !== null) {
			window.clearTimeout(expiryTimer);
			expiryTimer = null;
		}
		if (!state.snapshot) {
			return;
		}
		const expiresAt = parseDate(state.snapshot.expiresAt);
		if (!expiresAt || isSnapshotExpired(state.snapshot, now())) {
			return;
		}
		const delay = Math.max(0, expiresAt.getTime() - now().getTime());
		expiryTimer = window.setTimeout(() => {
			expiryTimer = null;
			refreshExpiryState();
		}, delay);
	}

	function handleThemePreferenceChange() {
		if (state.themeMode === "system") {
			applyTheme("system");
		}
	}

	services.addEventListener("click", handleServicesClick);
	services.addEventListener("keydown", handleServicesKeydown);
	services.addEventListener("pointerover", handleServicesPointerOver);
	services.addEventListener("pointermove", handleServicesPointerMove);
	services.addEventListener("pointerout", handleServicesPointerOut);
	services.addEventListener("pointerenter", handleServicesPointerOver, true);
	services.addEventListener("pointerleave", handleServicesPointerOut, true);
	services.addEventListener("focusin", handleServicesFocusIn);
	services.addEventListener("focusout", handleServicesFocusOut);
	themeToggle.addEventListener("click", handleThemeToggleClick);
	themeMenuContent.addEventListener("click", handleThemeOptionClick);
	themeMenuContent.addEventListener("keydown", handleThemeMenuKeydown);
	for (const input of mobileThemeInputs) {
		input.addEventListener("change", handleMobileThemeChange);
	}
	document.addEventListener("pointerdown", handleThemeOutsidePointer);
	mobileMenuTrigger?.addEventListener("click", handleMobileMenuTrigger);
	mobileMenuClose?.addEventListener("click", handleMobileMenuClose);
	mobileMenu?.addEventListener("cancel", handleMobileMenuCancel);
	mobileMenu?.addEventListener("click", handleMobileMenuClick);
	mobileMenu?.addEventListener("keydown", handleMobileMenuKeydown);
	document.addEventListener("visibilitychange", handleVisibilityChange);
	themeMediaQuery?.addEventListener?.("change", handleThemePreferenceChange);
	applyTheme(state.themeMode, false, false);
	if (options.autoLoad !== false) {
		void load();
	}
	const intervalId =
		options.autoRefresh === false
			? null
			: window.setInterval(() => void load(), STATUS_REFRESH_INTERVAL_MS);
	return {
		destroy: () => {
			if (intervalId !== null) {
				window.clearInterval(intervalId);
			}
			if (announcementTimer !== null) {
				window.clearTimeout(announcementTimer);
			}
			services.removeEventListener("click", handleServicesClick);
			services.removeEventListener("keydown", handleServicesKeydown);
			services.removeEventListener("pointerover", handleServicesPointerOver);
			services.removeEventListener("pointermove", handleServicesPointerMove);
			services.removeEventListener("pointerout", handleServicesPointerOut);
			services.removeEventListener("pointerenter", handleServicesPointerOver, true);
			services.removeEventListener("pointerleave", handleServicesPointerOut, true);
			services.removeEventListener("focusin", handleServicesFocusIn);
			services.removeEventListener("focusout", handleServicesFocusOut);
			themeToggle.removeEventListener("click", handleThemeToggleClick);
			themeMenuContent.removeEventListener("click", handleThemeOptionClick);
			themeMenuContent.removeEventListener("keydown", handleThemeMenuKeydown);
			for (const input of mobileThemeInputs) {
				input.removeEventListener("change", handleMobileThemeChange);
			}
			document.removeEventListener("pointerdown", handleThemeOutsidePointer);
			mobileMenuTrigger?.removeEventListener("click", handleMobileMenuTrigger);
			mobileMenuClose?.removeEventListener("click", handleMobileMenuClose);
			mobileMenu?.removeEventListener("cancel", handleMobileMenuCancel);
			mobileMenu?.removeEventListener("click", handleMobileMenuClick);
			mobileMenu?.removeEventListener("keydown", handleMobileMenuKeydown);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			if (expiryTimer !== null) {
				window.clearTimeout(expiryTimer);
				expiryTimer = null;
			}
			themeMediaQuery?.removeEventListener?.("change", handleThemePreferenceChange);
			tooltipController.destroy();
		},
		load,
		state,
	};
}

if (typeof document !== "undefined") {
	initStatusPage();
}
