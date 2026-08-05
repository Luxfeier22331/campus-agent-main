import { ThemeModeMenu } from "@campus-agent/ui";
import { lazy, type ReactNode, Suspense } from "react";
import { cn } from "@/lib/utils";
import {
	ProductBrandLink,
	ProductNavActions,
	type ProductNavigationLinkMode,
} from "./product-navigation";
import type {
	ProductNavMobileAccountAction,
	ProductNavMobileLocalActions,
} from "./product-navigation-menu";

const ProductNavMobileMenu = lazy(() =>
	import("./product-navigation-menu").then((module) => ({
		default: module.ProductNavMobileMenu,
	})),
);

export type CampusTopNavVariant = "standard" | "workspace" | "immersive" | "focused";
export type CampusTopNavDensity = "default" | "compact";

export interface CampusTopNavProps {
	accountAction?: ReactNode;
	activePath?: string;
	contextLabel?: string;
	density?: CampusTopNavDensity;
	leadingAction?: ReactNode;
	linkMode?: ProductNavigationLinkMode;
	localActions?: ReactNode;
	mobileAccountAction?: ProductNavMobileAccountAction;
	mobileLocalActions?: ProductNavMobileLocalActions;
	showMobileMenu?: boolean;
	variant: CampusTopNavVariant;
}

export function CampusTopNav({
	accountAction,
	activePath = "/",
	contextLabel,
	density = "default",
	leadingAction,
	linkMode = "router",
	localActions,
	mobileAccountAction,
	mobileLocalActions,
	showMobileMenu = true,
	variant,
}: CampusTopNavProps) {
	const immersive = variant === "immersive";
	const focused = variant === "focused";
	const topNavHeight =
		density === "compact"
			? "h-[var(--layout-chat-topnav-height)]"
			: "h-[var(--layout-campus-topnav-height)]";
	const mobileAccount = mobileAccountAction ?? accountAction;
	return (
		<header
			className={cn(
				"campus-top-nav shrink-0",
				immersive
					? "pointer-events-auto absolute right-3 top-3 z-[var(--layer-domain)] hidden lg:block"
					: cn(
							"sticky top-0 z-[var(--layer-sticky)] border-b border-border bg-background",
							topNavHeight,
						),
			)}
			data-density={density}
			data-variant={variant}
		>
			<div
				className={cn(
					"campus-top-nav-inner flex items-center gap-2",
					!immersive && "h-full",
					variant === "standard" &&
						"mx-auto w-full max-w-[var(--layout-page-workspace-width)] px-3 sm:px-4 lg:px-6",
					variant === "workspace" && "w-full px-3 sm:px-4 lg:px-5",
					focused &&
						"mx-auto w-full max-w-[var(--layout-page-workspace-width)] justify-between px-3 sm:px-4 lg:px-6",
					immersive &&
						"min-h-0 rounded-lg border border-[var(--map-overlay-border)] bg-[var(--map-overlay-surface)] p-1.5 text-[var(--map-overlay-muted)] shadow-[var(--map-overlay-shadow)] backdrop-blur-md [&_a:hover]:text-[var(--map-overlay-text)]",
				)}
			>
				{focused ? (
					<ProductBrandLink linkMode={linkMode} />
				) : immersive ? null : (
					<div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
						{leadingAction}
						<ProductBrandLink className="h-full" linkMode={linkMode} subtitle={contextLabel} />
					</div>
				)}
				{focused ? null : (
					<ProductNavActions
						activePath={activePath}
						className={cn(
							"shrink-0 items-center gap-0.5",
							immersive
								? "flex text-[var(--map-overlay-muted)]"
								: "hidden text-muted-foreground lg:flex",
						)}
						linkMode={linkMode}
					/>
				)}
				<div className="flex shrink-0 items-center gap-1">
					{localActions ? (
						<div className="hidden items-center gap-1 lg:flex">{localActions}</div>
					) : null}
					{focused ? (
						<ThemeModeMenu />
					) : (
						<ThemeModeMenu
							className={cn(
								"shrink-0",
								immersive
									? "text-[var(--map-overlay-muted)] hover:bg-[var(--map-overlay-surface-hover)] hover:text-[var(--map-overlay-text)]"
									: "hidden lg:inline-flex",
							)}
						/>
					)}
					{!focused && showMobileMenu ? (
						<Suspense fallback={<span aria-hidden="true" className="size-11 lg:hidden" />}>
							<ProductNavMobileMenu
								accountAction={mobileAccount}
								activePath={activePath}
								linkMode={linkMode}
								localActions={mobileLocalActions}
								triggerClassName="lg:hidden"
							/>
						</Suspense>
					) : null}
					{!focused && accountAction ? (
						<div className="hidden items-center lg:flex">{accountAction}</div>
					) : null}
				</div>
			</div>
		</header>
	);
}

export function FocusedPageHeader({
	linkMode = "router",
}: {
	linkMode?: ProductNavigationLinkMode;
}) {
	return <CampusTopNav linkMode={linkMode} showMobileMenu={false} variant="focused" />;
}
