import {
	formatDateTime,
	formatDayLabel,
	parseDate,
	STATUS_LABELS,
	serviceName,
	timelineDays,
	timelineSummary,
	validStatus,
} from "./status-model.js";

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

export function renderServices(items, state, now) {
	return items.map((item) => renderService(item, state, now)).join("");
}

export function setTimelineActive(slider, nextIndex, { focus = false } = {}) {
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

export function captureFocusState(services) {
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

export function restoreFocusState(services, focusState) {
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

export function timelineIndexAtClientX(slider, clientX) {
	const rect = slider.getBoundingClientRect();
	const count = slider.querySelectorAll(".timeline-bar").length;
	if (!(rect.width > 0 && count > 0 && Number.isFinite(clientX))) {
		return Number(slider.dataset.activeIndex) || 0;
	}
	const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
	return Math.round(ratio * (count - 1));
}

export function createTimelineTooltip(tooltip, coarseMediaQuery) {
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
