import { useEffect } from "react";

const SIDEBAR_OPEN_SELECTOR = ".rp-doc-layout__sidebar--open";
const SIDEBAR_MASK_SELECTOR = ".rp-sidebar-menu__mask";
const SIDEBAR_MENU_BUTTON_SELECTOR = ".rp-sidebar-menu__left";

function isSidebarOpen(): boolean {
	return document.querySelector(SIDEBAR_OPEN_SELECTOR) !== null;
}

function clickSidebarMask(): boolean {
	const mask = document.querySelector<HTMLElement>(SIDEBAR_MASK_SELECTOR);
	if (!mask) {
		return false;
	}
	mask.click();
	return true;
}

function targetIsInside(target: EventTarget | null, selector: string): boolean {
	return target instanceof Element && target.closest(selector) !== null;
}

function enhanceSidebarMenuButtonAccessibility(): void {
	const button = document.querySelector<HTMLButtonElement>(SIDEBAR_MENU_BUTTON_SELECTOR);
	if (!button) {
		return;
	}
	const open = isSidebarOpen();
	const label = open ? "关闭文档目录" : "打开文档目录";
	const expanded = String(open);
	if (button.getAttribute("aria-label") !== label) {
		button.setAttribute("aria-label", label);
	}
	if (button.getAttribute("aria-expanded") !== expanded) {
		button.setAttribute("aria-expanded", expanded);
	}
}

export default function MobileSidebarGuard(): null {
	useEffect(() => {
		let frame = window.requestAnimationFrame(enhanceSidebarMenuButtonAccessibility);
		const scheduleEnhancement = () => {
			window.cancelAnimationFrame(frame);
			frame = window.requestAnimationFrame(enhanceSidebarMenuButtonAccessibility);
		};
		const observer = new MutationObserver(scheduleEnhancement);
		observer.observe(document.body, { attributes: true, childList: true, subtree: true });
		const handleClick = (event: MouseEvent) => {
			if (!(isSidebarOpen() && targetIsInside(event.target, SIDEBAR_MENU_BUTTON_SELECTOR))) {
				scheduleEnhancement();
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			clickSidebarMask();
			scheduleEnhancement();
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || !isSidebarOpen() || !clickSidebarMask()) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			scheduleEnhancement();
		};

		document.addEventListener("click", handleClick, { capture: true });
		document.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => {
			window.cancelAnimationFrame(frame);
			observer.disconnect();
			document.removeEventListener("click", handleClick, { capture: true });
			document.removeEventListener("keydown", handleKeyDown, { capture: true });
		};
	}, []);

	return null;
}
