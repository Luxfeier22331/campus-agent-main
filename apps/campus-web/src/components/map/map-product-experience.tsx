import type { ReactNode } from "react";
import { lazy, Suspense, useEffect, useState } from "react";
import { CampusTopNav } from "@/components/navigation/campus-top-nav";
import { readBrowserPathname } from "@/components/navigation/product-navigation";
import { MapProductNavMobileMenu } from "@/components/navigation/product-navigation-menu";
import { MapExperience, type MapExperienceProps } from "./map-experience";

const ProductAccountEntry = lazy(() =>
	import("@/components/auth/user/product-account-entry").then((module) => ({
		default: module.ProductAccountEntry,
	})),
);

export function MapProductExperience({
	accountAction,
	mobileAccountAction,
	...props
}: MapExperienceProps & {
	accountAction?: ReactNode;
	mobileAccountAction?: ((openAuthDialog: () => void) => ReactNode) | undefined;
}) {
	const showMobileProductMenu = useIsDesktopMap() || !props.selectedPlace;

	return (
		<div className="relative">
			<CampusTopNav
				accountAction={
					accountAction ?? (
						<Suspense fallback={<span aria-hidden="true" className="size-11" />}>
							<ProductAccountEntry />
						</Suspense>
					)
				}
				activePath={readBrowserPathname()}
				linkMode="anchor"
				showMobileMenu={false}
				variant="immersive"
			/>
			<MapExperience {...props} />
			{showMobileProductMenu ? (
				<div className="pointer-events-auto absolute bottom-12 right-3 z-[var(--layer-domain)] lg:hidden">
					<MapProductNavMobileMenu
						accountAction={
							mobileAccountAction ??
							((openAuthDialog) => (
								<Suspense fallback={<span aria-hidden="true" className="block h-11" />}>
									<ProductAccountEntry onLogin={openAuthDialog} presentation="label" />
								</Suspense>
							))
						}
					/>
				</div>
			) : null}
		</div>
	);
}

function useIsDesktopMap() {
	const [matches, setMatches] = useState(() =>
		typeof window === "undefined" ? false : window.matchMedia("(min-width: 960px)").matches,
	);

	useEffect(() => {
		const media = window.matchMedia("(min-width: 960px)");
		const updateMatches = () => setMatches(media.matches);
		updateMatches();
		media.addEventListener("change", updateMatches);
		return () => media.removeEventListener("change", updateMatches);
	}, []);

	return matches;
}
