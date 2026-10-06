import { fetchStatusSnapshot } from "./status-client.js";
import {
	formatRelativeTime,
	isSnapshotExpired,
	normalizeItem,
	parseDate,
	STATUS_REFRESH_INTERVAL_MS,
	semanticChangeAnnouncement,
	semanticStatus,
	semanticStatusSignature,
} from "./status-model.js";
import {
	captureFocusState,
	createTimelineTooltip,
	renderServices,
	restoreFocusState,
	setTimelineActive,
	timelineIndexAtClientX,
} from "./status-renderer.js";

const THEME_KEY = "campus-agent.theme";
const THEME_MODE_LABELS = Object.freeze({
	system: "跟随系统",
	light: "浅色",
	dark: "深色",
});
const THEME_MODES = Object.freeze(Object.keys(THEME_MODE_LABELS));
let activeThemeTransition = null;

const MONITOR_ICON =
	'<rect x="3" y="4" width="18" height="12" rx="1"></rect><path d="M8 20h8"></path><path d="M12 16v4"></path>';
const MOON_ICON = '<path d="M20.5 15.2A8 8 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2z"></path>';
const SUN_ICON =
	'<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path>';

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
		persistThemeMode(nextMode);
	}
}

function readThemeCookie(storageKey) {
	try {
		const match = document.cookie.match(new RegExp(`(?:^|; )${storageKey}=([^;]*)`));
		const value = match?.[1] ? decodeURIComponent(match[1]) : null;
		return isThemeMode(value) ? value : null;
	} catch {
		return null;
	}
}

function writeThemeCookie(storageKey, mode) {
	try {
		const hostname = window.location.hostname;
		const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname === "localhost";
		const domainAttr = isIp ? "" : `; domain=.${hostname.split(".").slice(-2).join(".")}`;
		const secure = window.location.protocol === "https:" ? "; secure" : "";
		// biome-ignore lint/suspicious/noDocumentCookie: cross-subdomain theme sync requires a shared cookie.
		document.cookie = `${storageKey}=${encodeURIComponent(mode)}; path=/; max-age=31536000; SameSite=Lax${secure}${domainAttr}`;
	} catch {
		/* Cookie write is best-effort. */
	}
}

function storedThemeMode() {
	// The shared cookie is the cross-subdomain channel; every writer updates both
	// stores, so a valid cookie is at least as fresh as this origin's localStorage.
	const cookieMode = readThemeCookie(THEME_KEY);
	if (cookieMode) {
		return cookieMode;
	}
	try {
		const value = window.localStorage.getItem(THEME_KEY);
		if (isThemeMode(value)) {
			return value;
		}
	} catch {
		/* Storage is optional. */
	}
	return null;
}

function persistThemeMode(nextMode) {
	try {
		window.localStorage.setItem(THEME_KEY, nextMode);
	} catch {
		/* Storage is optional. */
	}
	writeThemeCookie(THEME_KEY, nextMode);
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
			const cookieMode = readThemeCookie(THEME_KEY);
			if (cookieMode && cookieMode !== state.themeMode) {
				applyTheme(cookieMode, true, false);
			}
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
