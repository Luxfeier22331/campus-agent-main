import type { ReactNode } from "react";
import { DeferredProductAccountEntry } from "@/components/auth/user/deferred-product-account-entry";
import { CampusTopNav } from "@/components/navigation/campus-top-nav";
import { readBrowserPathname } from "@/components/navigation/product-navigation";
import { MapProductNavMobileMenu } from "@/components/navigation/product-navigation-menu";

export function MapStateShell({ children }: { children: ReactNode }) {
	return (
		<section className="relative grid min-h-dvh place-items-center bg-[var(--map-canvas-bg)] p-6">
			<CampusTopNav
				accountAction={<DeferredProductAccountEntry />}
				activePath={readBrowserPathname()}
				linkMode="anchor"
				showMobileMenu={false}
				variant="immersive"
			/>
			<div className="pointer-events-auto absolute bottom-12 right-3 z-[var(--layer-domain)] lg:hidden">
				<MapProductNavMobileMenu
					accountAction={(openAuthDialog) => (
						<DeferredProductAccountEntry onLogin={openAuthDialog} presentation="label" />
					)}
				/>
			</div>
			<div className="w-full max-w-md">{children}</div>
		</section>
	);
}

export function MapDataLoading() {
	return (
		<div aria-busy="true" aria-label="正在加载校园地图" className="grid gap-3" role="status">
			<div aria-hidden="true" className="grid gap-2">
				<div className="h-8 w-36 animate-pulse rounded-md bg-surface-muted motion-reduce:animate-none" />
				<div className="h-4 w-full animate-pulse rounded-md bg-surface-muted motion-reduce:animate-none" />
				<div className="h-4 w-4/5 animate-pulse rounded-md bg-surface-muted motion-reduce:animate-none" />
			</div>
		</div>
	);
}
