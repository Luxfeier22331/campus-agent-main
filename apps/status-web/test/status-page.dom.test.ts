// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initStatusPage, STATUS_REQUEST_TIMEOUT_MS } from "../public/status-page.js";

const NOW = new Date("2026-08-07T00:05:00.000Z");

function createMediaQuery(initialMatches: boolean) {
	let matches = initialMatches;
	const listeners = new Set<(event: MediaQueryListEvent) => void>();
	const mediaQuery = {
		addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
			listeners.add(listener);
		},
		get matches() {
			return matches;
		},
		removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
			listeners.delete(listener);
		},
	} as unknown as MediaQueryList;
	return {
		listenerCount: () => listeners.size,
		mediaQuery,
		setMatches(nextMatches: boolean) {
			matches = nextMatches;
			for (const listener of listeners) {
				listener({ matches: nextMatches } as MediaQueryListEvent);
			}
		},
	};
}

function installShell({ coarse = false } = {}) {
	document.documentElement.dataset.theme = "light";
	document.documentElement.dataset.themeMode = "system";
	document.body.innerHTML = `
		<div id="theme-menu">
			<button id="theme-toggle" type="button" aria-label="外观，当前跟随系统"><svg id="theme-icon"></svg></button>
			<div id="theme-menu-content" role="menu" hidden>
				<button data-theme-option="system" role="menuitemradio" aria-checked="true" type="button">跟随系统</button>
				<button data-theme-option="light" role="menuitemradio" aria-checked="false" type="button">浅色</button>
				<button data-theme-option="dark" role="menuitemradio" aria-checked="false" type="button">深色</button>
			</div>
		</div>
		<div id="mobile-theme-control">
			<label><input name="status-theme-mode" type="radio" value="system" /></label>
			<label><input name="status-theme-mode" type="radio" value="light" /></label>
			<label><input name="status-theme-mode" type="radio" value="dark" /></label>
			</div>
			<p id="monitoring-notice" hidden></p>
			<div id="services" class="service-list">
				<article class="service-row service-row-skeleton" aria-hidden="true"></article>
				<article class="service-row service-row-skeleton" aria-hidden="true"></article>
			</div>
		<div id="timeline-legend" hidden></div>
		<div id="timeline-tooltip" role="tooltip" hidden>
			<span class="timeline-tooltip-title"></span>
			<span class="timeline-tooltip-status"></span>
			<span class="timeline-tooltip-note" hidden></span>
		</div>
		<p id="status-announcement" role="status" aria-live="polite" aria-atomic="true"></p>
	`;
	const coarseMedia = createMediaQuery(coarse);
	const themeMedia = createMediaQuery(false);
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: vi.fn((query: string) =>
			query === "(pointer: coarse)" ? coarseMedia.mediaQuery : themeMedia.mediaQuery,
		),
	});
	return { coarseMedia, themeMedia };
}

function snapshot({
	expiresAt = "2026-08-07T00:20:00.000Z",
	generatedAt = "2026-08-07T00:05:00.000Z",
	services = [
		{
			checkedAt: "2026-08-07T00:05:00.000Z",
			id: "campus.qa",
			name: "校园问答",
			status: "operational",
			timeline: [{ day: "2026-08-07", status: "operational" }],
		},
		{
			checkedAt: "2026-08-07T00:05:00.000Z",
			id: "campus.services",
			name: "其他服务",
			status: "operational",
			timeline: [{ day: "2026-08-07", status: "operational" }],
		},
	],
} = {}) {
	return {
		environment: "staging",
		expiresAt,
		generatedAt,
		schemaVersion: "product-availability-snapshot.v1",
		services,
	};
}

function response(body: unknown, etag = '"status-v1"') {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json", etag },
		status: 200,
	});
}

describe("status page DOM lifecycle", () => {
	beforeEach(() => {
		window.localStorage.clear();
		installShell();
	});

	afterEach(() => {
		vi.useRealTimers();
		document.body.innerHTML = "";
		window.localStorage.clear();
	});

	it("renders each service with one composite slider and 30 visual bars", async () => {
		const controller = initStatusPage({
			autoLoad: false,
			autoRefresh: false,
			fetchFn: async () => response(snapshot()),
			now: () => NOW,
		});
		if (!controller) {
			throw new Error("status page shell did not initialize");
		}

		await controller.load();

		expect(document.querySelectorAll("article.service-row")).toHaveLength(2);
		expect(
			[...document.querySelectorAll(".service-name")].map((heading) => ({
				level: heading.tagName,
				text: heading.textContent,
			})),
		).toEqual([
			{ level: "H2", text: "校园问答" },
			{ level: "H2", text: "其他服务" },
		]);
		const row = document.querySelector("article.service-row[data-service-id]");
		const timeline = row?.querySelector(".timeline-slider");
		const timelineViewport = row?.querySelector(".timeline-viewport");
		expect(row).toBeTruthy();
		expect(timeline).toBeTruthy();
		expect(timeline?.getAttribute("role")).toBe("slider");
		expect(timeline?.getAttribute("aria-valuemin")).toBe("1");
		expect(timeline?.getAttribute("aria-valuemax")).toBe("30");
		expect(timeline?.getAttribute("aria-valuenow")).toBe("30");
		expect(timelineViewport?.querySelector(".timeline-labels")).toBeTruthy();
		expect(timelineViewport?.getAttribute("role")).toBeNull();
		expect(row?.querySelectorAll(".timeline-bar")).toHaveLength(30);
		expect(row?.querySelectorAll('.timeline-slider[tabindex="0"]')).toHaveLength(1);
		expect(row?.querySelectorAll(".timeline-bar")).toHaveLength(30);
		expect(row?.querySelectorAll('.timeline-bar[aria-hidden="true"]')).toHaveLength(30);
		expect(document.querySelector("details, select, .date-picker, .timeline-selected")).toBeNull();
		expect(document.querySelector("#page-footer")).toBeNull();
		expect((document.getElementById("timeline-legend") as HTMLElement).hidden).toBe(false);
		expect(document.getElementById("monitoring-notice")?.hidden).toBe(true);
		expect(document.getElementById("overall-summary")).toBeNull();
		expect(document.body.textContent).not.toContain("最近更新：");
		controller.destroy();
	});

	it("preserves timeline focus after an automatic render", async () => {
		const requests: RequestInit[] = [];
		const controller = initStatusPage({
			autoLoad: false,
			autoRefresh: false,
			fetchFn: async (_input: RequestInfo | URL, init?: RequestInit) => {
				requests.push(init ?? {});
				return response(snapshot(), requests.length === 1 ? '"status-v1"' : '"status-v2"');
			},
			now: () => NOW,
		});
		if (!controller) {
			throw new Error("status page shell did not initialize");
		}

		await controller.load();
		const bar = document.querySelector<HTMLElement>(".timeline-slider");
		if (!bar) {
			throw new Error("timeline bar did not render");
		}
		bar.focus();
		const selectedDay = bar.dataset.day;
		expect(document.getElementById("timeline-tooltip")?.hidden).toBe(false);

		await controller.load();

		const activeBar = document.activeElement as HTMLElement | null;
		expect(activeBar?.matches(".timeline-slider")).toBe(true);
		expect(activeBar?.dataset.day).toBe(selectedDay);
		expect(
			activeBar?.closest(".service-row")?.querySelectorAll('.timeline-slider[tabindex="0"]'),
		).toHaveLength(1);
		expect(document.getElementById("timeline-tooltip")?.hidden).toBe(true);
		expect(activeBar?.hasAttribute("aria-describedby")).toBe(false);
		expect(requests[1]).toBeDefined();
		if (!requests[1]) {
			throw new Error("second request was not captured");
		}
		expect(requests[1].cache).toBe("no-cache");
		expect(new Headers(requests[1].headers).get("if-none-match")).toBe('"status-v1"');
		controller.destroy();
	});

	it("keeps the last snapshot visible when an automatic read fails", async () => {
		let attempt = 0;
		const controller = initStatusPage({
			autoLoad: false,
			autoRefresh: false,
			fetchFn: async () => {
				attempt += 1;
				if (attempt > 1) {
					throw new Error("network unavailable");
				}
				return response(snapshot());
			},
			now: () => NOW,
		});
		if (!controller) {
			throw new Error("status page shell did not initialize");
		}

		await controller.load();
		await controller.load();

		expect(document.querySelector(".service-row")).toBeTruthy();
		expect(document.getElementById("monitoring-notice")?.hidden).toBe(false);
		expect(document.getElementById("monitoring-notice")?.textContent).toContain(
			"暂时无法更新监控数据，保留最近一次结果。",
		);
		expect(document.querySelector(".service-status")?.textContent).toContain("运行正常");
		expect(document.getElementById("status-announcement")?.textContent).toContain("状态更新失败");
		expect(document.querySelector(".empty-state")).toBeNull();
		controller.destroy();
	});

	it("keeps the loading skeleton after an initial request timeout", async () => {
		vi.useFakeTimers();
		const controller = initStatusPage({
			autoLoad: false,
			autoRefresh: false,
			fetchFn: () =>
				new Promise(() => {
					// Keep the request pending so the timeout path can be exercised.
				}),
			now: () => NOW,
		});
		if (!controller) {
			throw new Error("status page shell did not initialize");
		}

		const loading = controller.load();
		await vi.advanceTimersByTimeAsync(STATUS_REQUEST_TIMEOUT_MS);
		await loading;

		expect(document.querySelectorAll(".service-row-skeleton")).toHaveLength(2);
		expect(document.querySelector(".empty-state")).toBeNull();
		expect(document.querySelector("[data-retry]")).toBeNull();
		expect(document.getElementById("services")?.getAttribute("aria-busy")).toBe("true");
		expect(document.getElementById("monitoring-notice")?.hidden).toBe(true);
		controller.destroy();
	});

	it("keeps the skeleton silently when the first response is 204", async () => {
		const controller = initStatusPage({
			autoLoad: false,
			autoRefresh: false,
			fetchFn: async () => new Response(null, { status: 204 }),
			now: () => NOW,
		});
		if (!controller) {
			throw new Error("status page shell did not initialize");
		}

		await controller.load();

		expect(document.querySelectorAll(".service-row-skeleton")).toHaveLength(2);
		expect(document.getElementById("monitoring-notice")?.hidden).toBe(true);
		expect(document.getElementById("status-announcement")?.textContent).toBe("");
		expect(document.getElementById("services")?.getAttribute("aria-busy")).toBe("true");
		controller.destroy();
	});

	it("keeps the published snapshot and shows a stale notice when a later response is 204", async () => {
		let attempt = 0;
		const controller = initStatusPage({
			autoLoad: false,
			autoRefresh: false,
			fetchFn: async () => {
				attempt += 1;
				return attempt === 1 ? response(snapshot()) : new Response(null, { status: 204 });
			},
			now: () => NOW,
		});
		if (!controller) {
			throw new Error("status page shell did not initialize");
		}

		await controller.load();
		await controller.load();

		expect(document.querySelectorAll(".service-row")).toHaveLength(2);
		expect(document.querySelector(".service-status")?.textContent).toContain("运行正常");
		expect(document.getElementById("monitoring-notice")?.textContent).toContain(
			"暂时无法更新监控数据，保留最近一次结果。",
		);
		expect(document.getElementById("services")?.getAttribute("aria-busy")).toBe("false");
		controller.destroy();
	});

	it("replaces the skeleton when a later poll returns the first snapshot", async () => {
		let attempt = 0;
		const controller = initStatusPage({
			autoLoad: false,
			autoRefresh: false,
			fetchFn: async () => {
				attempt += 1;
				if (attempt === 1) {
					throw new Error("network unavailable");
				}
				return response(snapshot());
			},
			now: () => NOW,
		});
		if (!controller) {
			throw new Error("status page shell did not initialize");
		}

		await controller.load();
		expect(document.querySelectorAll(".service-row-skeleton")).toHaveLength(2);
		expect(document.getElementById("status-announcement")?.textContent).toContain(
			"状态数据尚未载入",
		);
		await controller.load();
		expect(document.querySelector(".service-row-skeleton")).toBeNull();
		expect(document.querySelectorAll(".service-row")).toHaveLength(2);
		expect(document.getElementById("services")?.getAttribute("aria-busy")).toBe("false");
		expect(document.getElementById("status-announcement")?.textContent).toBe("状态数据已载入。");
		controller.destroy();
	});

	it("keeps the skeleton when the first response has an invalid service set", async () => {
		const invalid = snapshot();
		const controller = initStatusPage({
			autoLoad: false,
			autoRefresh: false,
			fetchFn: async () => response({ ...invalid, services: [...invalid.services].reverse() }),
			now: () => NOW,
		});
		if (!controller) {
			throw new Error("status page shell did not initialize");
		}

		await controller.load();

		expect(document.querySelectorAll(".service-row-skeleton")).toHaveLength(2);
		expect(document.querySelector(".service-name")).toBeNull();
		expect(document.getElementById("services")?.getAttribute("aria-busy")).toBe("true");
		expect(controller.state.snapshot).toBeNull();
		controller.destroy();
	});

	it("retains the previous snapshot when a refresh has an invalid service set", async () => {
		let attempt = 0;
		const valid = snapshot();
		const controller = initStatusPage({
			autoLoad: false,
			autoRefresh: false,
			fetchFn: async () => {
				attempt += 1;
				return response(
					attempt === 1 ? valid : { ...valid, services: [valid.services[0], valid.services[0]] },
					`"status-v${attempt}"`,
				);
			},
			now: () => NOW,
		});
		if (!controller) {
			throw new Error("status page shell did not initialize");
		}

		await controller.load();
		await controller.load();

		expect(
			[...document.querySelectorAll(".service-name")].map((heading) => heading.textContent),
		).toEqual(["校园问答", "其他服务"]);
		expect(document.querySelectorAll(".service-row")).toHaveLength(2);
		expect(document.getElementById("monitoring-notice")?.textContent).toContain(
			"暂时无法更新监控数据，保留最近一次结果。",
		);
		expect(controller.state.etag).toBe('"status-v1"');
		controller.destroy();
	});

	it("shows unknown current status but keeps history after an expired read failure", async () => {
		let current = new Date("2026-08-07T00:05:00.000Z");
		const controller = initStatusPage({
			autoLoad: false,
			autoRefresh: false,
			fetchFn: async () => {
				if (current.getTime() > NOW.getTime()) {
					throw new Error("network unavailable");
				}
				return response(snapshot({ expiresAt: "2026-08-07T00:10:00.000Z" }));
			},
			now: () => current,
		});
		if (!controller) {
			throw new Error("status page shell did not initialize");
		}

		await controller.load();
		current = new Date("2026-08-07T00:11:00.000Z");
		await controller.load();

		expect(document.getElementById("monitoring-notice")?.hidden).toBe(false);
		expect(document.getElementById("monitoring-notice")?.textContent).toContain(
			"监控数据已过期，当前状态暂不可确认。",
		);
		expect(document.querySelector(".service-status")?.textContent).toContain("状态未知");
		expect(document.querySelector(".timeline-bar.operational")).toBeTruthy();
		controller.destroy();
	});

	it("expires current status at expiresAt without another request", async () => {
		vi.useFakeTimers();
		let current = new Date("2026-08-07T00:05:00.000Z");
		const controller = initStatusPage({
			autoLoad: false,
			autoRefresh: false,
			fetchFn: async () => response(snapshot({ expiresAt: "2026-08-07T00:05:01.000Z" })),
			now: () => current,
		});
		if (!controller) {
			throw new Error("status page shell did not initialize");
		}

		await controller.load();
		expect(document.querySelector(".service-status")?.textContent).toContain("运行正常");
		current = new Date("2026-08-07T00:05:01.000Z");
		await vi.advanceTimersByTimeAsync(1_000);

		expect(document.querySelector(".service-status")?.textContent).toContain("状态未知");
		expect(document.querySelector(".timeline-bar.operational")).toBeTruthy();
		expect(document.getElementById("monitoring-notice")?.textContent).toContain("监控数据已过期");
		controller.destroy();
	});

	it("replaces the expiry timer when a new snapshot arrives", async () => {
		vi.useFakeTimers();
		let current = new Date("2026-08-07T00:05:00.000Z");
		let attempt = 0;
		const controller = initStatusPage({
			autoLoad: false,
			autoRefresh: false,
			fetchFn: async () => {
				attempt += 1;
				return response(
					snapshot({
						expiresAt: attempt === 1 ? "2026-08-07T00:05:01.000Z" : "2026-08-07T00:05:03.000Z",
					}),
					`"status-v${attempt}"`,
				);
			},
			now: () => current,
		});
		if (!controller) {
			throw new Error("status page shell did not initialize");
		}

		await controller.load();
		current = new Date("2026-08-07T00:05:00.500Z");
		await vi.advanceTimersByTimeAsync(500);
		await controller.load();
		current = new Date("2026-08-07T00:05:01.000Z");
		await vi.advanceTimersByTimeAsync(500);
		expect(document.querySelector(".service-status")?.textContent).toContain("运行正常");

		current = new Date("2026-08-07T00:05:03.000Z");
		await vi.advanceTimersByTimeAsync(2_000);
		expect(document.querySelector(".service-status")?.textContent).toContain("状态未知");
		controller.destroy();
	});

	it("recalculates expiry immediately when the document becomes visible", async () => {
		let current = new Date("2026-08-07T00:05:00.000Z");
		const controller = initStatusPage({
			autoLoad: false,
			autoRefresh: false,
			fetchFn: async () => response(snapshot({ expiresAt: "2026-08-07T00:10:00.000Z" })),
			now: () => current,
		});
		if (!controller) {
			throw new Error("status page shell did not initialize");
		}

		await controller.load();
		current = new Date("2026-08-07T00:11:00.000Z");
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "visible",
		});
		document.dispatchEvent(new Event("visibilitychange"));

		expect(document.querySelector(".service-status")?.textContent).toContain("状态未知");
		expect(document.querySelector(".timeline-bar.operational")).toBeTruthy();
		controller.destroy();
	});

	it("uses one slider tab stop and bounded keyboard navigation for every viewport", async () => {
		installShell({ coarse: true });
		const controller = initStatusPage({
			autoLoad: false,
			autoRefresh: false,
			fetchFn: async () => response(snapshot()),
			now: () => NOW,
		});
		if (!controller) {
			throw new Error("status page shell did not initialize");
		}
		await controller.load();
		const row = document.querySelector(".service-row");
		const slider = row?.querySelector<HTMLElement>(".timeline-slider");
		const bars = [...(row?.querySelectorAll<HTMLElement>(".timeline-bar") ?? [])];
		const selected = slider;
		selected?.focus();

		selected?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" }));
		expect(document.activeElement).toBe(slider);
		expect(bars[0]?.dataset.active).toBe("true");
		expect(slider?.getAttribute("aria-valuenow")).toBe("1");

		slider?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
		expect(slider?.getAttribute("aria-valuenow")).toBe("2");
		slider?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
		expect(slider?.getAttribute("aria-valuenow")).toBe("3");
		slider?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
		expect(slider?.getAttribute("aria-valuenow")).toBe("2");
		slider?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
		expect(slider?.getAttribute("aria-valuenow")).toBe("30");
		slider?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
		expect(slider?.getAttribute("aria-valuenow")).toBe("30");
		controller.destroy();
	});

	it("updates the selected date while a fine pointer moves across the track", async () => {
		const controller = initStatusPage({
			autoLoad: false,
			autoRefresh: false,
			fetchFn: async () => response(snapshot()),
			now: () => NOW,
		});
		if (!controller) {
			throw new Error("status page shell did not initialize");
		}
		await controller.load();
		const slider = document.querySelector<HTMLElement>(".timeline-slider");
		if (!slider) {
			throw new Error("timeline slider did not render");
		}
		vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({
			bottom: 36,
			height: 36,
			left: 0,
			right: 300,
			top: 0,
			toJSON: () => ({}),
			width: 300,
			x: 0,
			y: 0,
		});

		slider.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 0 }));
		expect(slider.getAttribute("aria-valuenow")).toBe("1");
		slider.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 150 }));
		expect(Number(slider.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(15);
		slider.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 300 }));
		expect(slider.getAttribute("aria-valuenow")).toBe("30");
		controller.destroy();
	});

	it("shows one accessible tooltip for focus, hover, click, and exceptional history", async () => {
		const controller = initStatusPage({
			autoLoad: false,
			autoRefresh: false,
			fetchFn: async () =>
				response(
					snapshot({
						services: [
							{
								checkedAt: "2026-08-07T00:05:00.000Z",
								id: "campus.qa",
								name: "校园问答",
								status: "operational",
								timeline: [
									{ day: "2026-08-06", status: "unknown" },
									{ day: "2026-08-07", status: "operational" },
								],
							},
							{
								checkedAt: "2026-08-07T00:05:00.000Z",
								id: "campus.services",
								name: "其他服务",
								status: "operational",
								timeline: [],
							},
						],
					}),
				),
			now: () => NOW,
		});
		if (!controller) {
			throw new Error("status page shell did not initialize");
		}
		await controller.load();
		const tooltip = document.getElementById("timeline-tooltip") as HTMLElement;
		const latest = document.querySelector<HTMLElement>(".timeline-slider");
		if (!latest) {
			throw new Error("latest timeline bar did not render");
		}

		latest.focus();
		expect(tooltip.hidden).toBe(false);
		expect(tooltip.getAttribute("role")).toBe("tooltip");
		expect(tooltip.textContent).toContain("校园问答 · 2026年8月7日 周五");
		expect(tooltip.textContent).toContain("运行正常");
		expect(latest.getAttribute("aria-describedby")).toBe("timeline-tooltip");
		expect(tooltip.hasAttribute("aria-live")).toBe(false);

		const unknown = document.querySelector<HTMLElement>(".timeline-slider");
		unknown?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }));
		expect(tooltip.textContent).toContain("状态未知");
		expect(tooltip.textContent).toContain("这一天的探测结果未知。");

		document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
		expect(tooltip.hidden).toBe(true);
		expect(unknown?.hasAttribute("aria-describedby")).toBe(false);
		expect(document.activeElement).toBe(unknown);

		const missing = document.querySelector<HTMLElement>(".timeline-slider");
		missing?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" }));
		missing?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 1 }));
		missing?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
		expect(tooltip.hidden).toBe(false);
		expect(tooltip.textContent).toContain("无历史数据");
		expect(tooltip.textContent).toContain("这一天没有发布历史数据。");
		missing?.dispatchEvent(
			new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
		);
		missing?.blur();
		await Promise.resolve();
		expect(tooltip.hidden).toBe(true);

		missing?.click();
		expect(tooltip.hidden).toBe(false);
		document.body.click();
		expect(tooltip.hidden).toBe(true);
		controller.destroy();
	});

	it("ignores hover on coarse pointers but keeps tap access to the same timeline", async () => {
		installShell({ coarse: true });
		const controller = initStatusPage({
			autoLoad: false,
			autoRefresh: false,
			fetchFn: async () => response(snapshot()),
			now: () => NOW,
		});
		if (!controller) {
			throw new Error("status page shell did not initialize");
		}
		await controller.load();
		const bar = document.querySelector<HTMLElement>(".timeline-slider");
		const tooltip = document.getElementById("timeline-tooltip") as HTMLElement;

		bar?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
		expect(tooltip.hidden).toBe(true);
		bar?.click();
		expect(tooltip.hidden).toBe(false);
		expect(bar?.getAttribute("aria-describedby")).toBe("timeline-tooltip");
		expect(document.querySelector(".timeline-slider")?.getAttribute("role")).toBe("slider");
		controller.destroy();
	});

	it("announces only semantic snapshot changes", async () => {
		let attempt = 0;
		const initialServices = [
			{
				checkedAt: "2026-08-07T00:05:00.000Z",
				id: "campus.qa",
				name: "校园问答",
				status: "operational",
				timeline: [],
			},
			{
				checkedAt: "2026-08-07T00:05:00.000Z",
				id: "campus.services",
				name: "其他服务",
				status: "degraded",
				timeline: [],
			},
		];
		const controller = initStatusPage({
			autoLoad: false,
			autoRefresh: false,
			fetchFn: async () => {
				attempt += 1;
				if (attempt === 2) {
					return new Response(null, { headers: { etag: '"status-v1"' }, status: 304 });
				}
				return response(
					snapshot({
						generatedAt: attempt === 1 ? "2026-08-07T00:05:00.000Z" : "2026-08-07T00:06:00.000Z",
						services:
							attempt === 1
								? initialServices
								: initialServices.map((service) =>
										service.id === "campus.qa" ? { ...service, status: "unknown" } : service,
									),
					}),
					attempt === 1 ? '"status-v1"' : '"status-v2"',
				);
			},
			now: () => NOW,
		});
		if (!controller) {
			throw new Error("status page shell did not initialize");
		}

		await controller.load();
		expect(document.getElementById("status-announcement")?.textContent).toContain("状态数据已载入");
		const announcement = document.getElementById("status-announcement");
		if (!announcement) {
			throw new Error("announcement region is missing");
		}
		announcement.textContent = "unchanged";
		await controller.load();
		expect(announcement.textContent).toBe("unchanged");

		await controller.load();
		expect(announcement.textContent).toBe("校园问答由运行正常变为状态未知。");
		controller.destroy();
	});

	it("announces failure and recovery once without moving focus", async () => {
		let attempt = 0;
		const controller = initStatusPage({
			autoLoad: false,
			autoRefresh: false,
			fetchFn: async () => {
				attempt += 1;
				if (attempt === 2) {
					throw new Error("network unavailable");
				}
				return response(snapshot(), `"status-v${attempt}"`);
			},
			now: () => NOW,
		});
		if (!controller) {
			throw new Error("status page shell did not initialize");
		}
		await controller.load();
		const themeToggle = document.getElementById("theme-toggle");
		themeToggle?.focus();

		await controller.load();
		expect(document.getElementById("status-announcement")?.textContent).toContain("状态更新失败");
		expect(document.activeElement).toBe(themeToggle);
		await controller.load();
		expect(document.getElementById("status-announcement")?.textContent).toContain(
			"状态数据已恢复更新",
		);
		expect(document.activeElement).toBe(themeToggle);
		controller.destroy();
	});

	it("supports Campus three-mode theme selection and system changes", async () => {
		const { themeMedia } = installShell();
		const controller = initStatusPage({
			autoLoad: false,
			autoRefresh: false,
			fetchFn: async () => response(snapshot()),
			now: () => NOW,
		});
		if (!controller) {
			throw new Error("status page shell did not initialize");
		}

		const toggle = document.getElementById("theme-toggle");
		const menu = document.getElementById("theme-menu-content");
		const dark = document.querySelector<HTMLElement>('[data-theme-option="dark"]');
		const system = document.querySelector<HTMLElement>('[data-theme-option="system"]');
		if (!(toggle && menu && dark && system)) {
			throw new Error("theme controls are missing");
		}
		expect(toggle.getAttribute("aria-label")).toBe("外观，当前跟随系统");
		expect(document.querySelector<HTMLInputElement>('input[value="system"]')?.checked).toBe(true);

		toggle.click();
		expect(menu.hidden).toBe(false);
		dark.click();
		expect(document.documentElement.dataset.theme).toBe("dark");
		expect(document.documentElement.dataset.themeMode).toBe("dark");
		expect(window.localStorage.getItem("campus-agent.theme")).toBe("dark");
		expect(toggle.getAttribute("aria-label")).toBe("外观，当前深色");
		expect(menu.hidden).toBe(true);

		system.click();
		expect(document.documentElement.dataset.themeMode).toBe("system");
		expect(window.localStorage.getItem("campus-agent.theme")).toBe("system");
		themeMedia.setMatches(true);
		expect(document.documentElement.dataset.theme).toBe("dark");
		themeMedia.setMatches(false);
		expect(document.documentElement.dataset.theme).toBe("light");
		controller.destroy();
	});

	it("removes event and media listeners when destroyed", () => {
		const { coarseMedia, themeMedia } = installShell();
		const fetchFn = vi.fn(async () => response(snapshot()));
		const controller = initStatusPage({
			autoLoad: false,
			autoRefresh: false,
			fetchFn,
			now: () => NOW,
		});
		if (!controller) {
			throw new Error("status page shell did not initialize");
		}
		expect(coarseMedia.listenerCount()).toBe(0);
		expect(themeMedia.listenerCount()).toBe(1);
		controller.destroy();
		expect(coarseMedia.listenerCount()).toBe(0);
		expect(themeMedia.listenerCount()).toBe(0);
		document.getElementById("theme-toggle")?.click();
		expect(fetchFn).not.toHaveBeenCalled();
	});
});
