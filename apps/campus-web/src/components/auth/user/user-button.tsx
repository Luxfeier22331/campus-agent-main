import { UserButton as BetterAuthHeroUIUserButton } from "@better-auth-ui/heroui";
import { useLayoutEffect, useRef } from "react";

import { CampusBrowserAuthUIProvider } from "../browser-auth-ui-provider";
import "../auth-styles.css";

export function UserButton() {
	const rootRef = useRef<HTMLSpanElement>(null);
	useLayoutEffect(() => {
		const trigger = rootRef.current?.querySelector<HTMLElement>('[data-slot="dropdown-trigger"]');
		if (!trigger) {
			return;
		}
		const syncAccessibleName = () => {
			const hasContentName = Boolean(
				trigger.textContent?.trim() ||
					trigger.querySelector('[aria-label]:not([aria-label=""])') ||
					trigger.querySelector('img[alt]:not([alt=""])'),
			);
			if (hasContentName) {
				trigger.removeAttribute("aria-label");
				return;
			}
			trigger.setAttribute("aria-label", "账号");
		};
		syncAccessibleName();
		const observer = new MutationObserver(syncAccessibleName);
		observer.observe(trigger, { characterData: true, childList: true, subtree: true });
		return () => observer.disconnect();
	}, []);

	return (
		<span className="contents" ref={rootRef}>
			<CampusBrowserAuthUIProvider>
				<BetterAuthHeroUIUserButton placement="bottom end" size="icon" variant="ghost" />
			</CampusBrowserAuthUIProvider>
		</span>
	);
}
