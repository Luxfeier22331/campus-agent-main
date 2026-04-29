import { useEffect, useState } from "react";

const STORAGE_KEY = "public-docs:sidebar-collapsed:v1";
const COLLAPSED_STATE = "collapsed";
const EXPANDED_STATE = "expanded";

function readStoredCollapsed(): boolean {
	try {
		return window.localStorage.getItem(STORAGE_KEY) === COLLAPSED_STATE;
	} catch {
		return false;
	}
}

function writeStoredCollapsed(collapsed: boolean): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, collapsed ? COLLAPSED_STATE : EXPANDED_STATE);
	} catch {
		// Storage can be unavailable in private or locked-down browsing contexts.
	}
}

function syncSidebarAccessibility(collapsed: boolean): void {
	for (const sidebar of document.querySelectorAll<HTMLElement>(".rp-doc-layout__sidebar")) {
		if (collapsed) {
			sidebar.setAttribute("aria-hidden", "true");
			sidebar.setAttribute("inert", "");
		} else {
			sidebar.removeAttribute("aria-hidden");
			sidebar.removeAttribute("inert");
		}
	}
}

function applyDesktopSidebarState(collapsed: boolean): void {
	document.documentElement.setAttribute(
		"data-docs-sidebar",
		collapsed ? COLLAPSED_STATE : EXPANDED_STATE,
	);
	syncSidebarAccessibility(collapsed);
}

function clearDesktopSidebarState(): void {
	document.documentElement.removeAttribute("data-docs-sidebar");
	syncSidebarAccessibility(false);
}

export default function DesktopSidebarCollapseToggle() {
	const [isDesktop, setIsDesktop] = useState(false);
	const [collapsed, setCollapsed] = useState(false);

	useEffect(() => {
		const media = window.matchMedia("(min-width: 900px)");

		const syncFromEnvironment = () => {
			const nextIsDesktop = media.matches;
			const nextCollapsed = readStoredCollapsed();
			setIsDesktop(nextIsDesktop);
			setCollapsed(nextCollapsed);
			if (nextIsDesktop) {
				applyDesktopSidebarState(nextCollapsed);
			} else {
				clearDesktopSidebarState();
			}
		};

		syncFromEnvironment();
		media.addEventListener("change", syncFromEnvironment);
		return () => {
			media.removeEventListener("change", syncFromEnvironment);
			clearDesktopSidebarState();
		};
	}, []);

	if (!isDesktop) {
		return null;
	}

	const label = collapsed ? "展开目录" : "收起目录";

	return (
		<button
			type="button"
			className="docs-sidebar-collapse-toggle"
			data-state={collapsed ? COLLAPSED_STATE : EXPANDED_STATE}
			aria-label={label}
			aria-pressed={collapsed}
			onClick={() => {
				const nextCollapsed = !collapsed;
				setCollapsed(nextCollapsed);
				writeStoredCollapsed(nextCollapsed);
				applyDesktopSidebarState(nextCollapsed);
			}}
		>
			<span className="docs-sidebar-collapse-toggle__mark" aria-hidden="true" />
			<span className="docs-sidebar-collapse-toggle__label">{label}</span>
		</button>
	);
}
