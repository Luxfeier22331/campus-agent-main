import { Link } from "@tanstack/react-router";
import type { AnchorHTMLAttributes, ComponentType, ReactNode, SVGProps } from "react";
import { forwardRef } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
	getProductNavItems,
	isProductNavActive,
	type ProductNavItem,
	type ProductNavItemId,
} from "@/platform/navigation/product-nav";
export type ProductNavigationVariant = "standard" | "chat" | "map";
export type ProductNavigationLinkMode = "anchor" | "router";

export function ProductBrandLink({
	className,
	linkMode = "anchor",
	subtitle = "",
}: {
	className?: string;
	linkMode?: ProductNavigationLinkMode;
	subtitle?: string;
}) {
	const classNames = cn("flex min-w-0 items-center gap-3", className);
	const children = (
		<span className="min-w-0">
			<span className="block truncate text-sm font-semibold tracking-normal text-[var(--sys-text-strong)]">
				中央民族大学校园问答
			</span>
			{subtitle ? (
				<span className="block truncate text-xs text-[var(--sys-text-subtle)]">{subtitle}</span>
			) : null}
		</span>
	);
	if (linkMode === "router") {
		return (
			<Link className={classNames} to="/">
				{children}
			</Link>
		);
	}
	return (
		<a className={classNames} href="/">
			{children}
		</a>
	);
}

export function ProductNavActions({
	activePath,
	className,
	icons,
	linkMode = "router",
	variant = "standard",
}: {
	activePath: string;
	className?: string;
	icons?: Partial<Record<ProductNavItemId, ComponentType<SVGProps<SVGSVGElement>>>>;
	linkMode?: ProductNavigationLinkMode;
	variant?: ProductNavigationVariant;
}) {
	return (
		<nav aria-label="产品导航" className={cn("items-center", className)}>
			{getProductNavItems().map((item) => (
				<ProductNavButton
					active={isProductNavActive(activePath, item)}
					item={item}
					key={item.id}
					linkMode={linkMode}
					Icon={icons?.[item.id]}
					variant={variant}
				/>
			))}
		</nav>
	);
}

export function MapProductNavOverlay() {
	const activePath = readBrowserPathname();
	return (
		<div className="pointer-events-auto absolute right-3 top-3 z-30 hidden md:block">
			<ProductNavActions
				activePath={activePath}
				className="flex rounded-full border border-white/65 bg-white/78 px-1.5 py-1 text-sm font-medium text-[var(--sys-text-muted)] shadow-[var(--shadow-xs)] backdrop-blur-md"
				linkMode="anchor"
				variant="map"
			/>
		</div>
	);
}

function ProductNavButton({
	active,
	Icon,
	item,
	linkMode,
	variant,
}: {
	active: boolean;
	Icon?: ComponentType<SVGProps<SVGSVGElement>>;
	item: ProductNavItem;
	linkMode: ProductNavigationLinkMode;
	variant: ProductNavigationVariant;
}) {
	const className = cn(
		"min-h-8 rounded-md px-2.5 text-xs",
		variant === "chat" ? "text-muted-foreground" : "",
		variant === "map" ? "rounded-full bg-white/0 text-[var(--sys-text-muted)]" : "",
		active ? "bg-surface-muted text-foreground" : "",
		active && item.id === "feedback"
			? "text-[var(--sys-brand-identity)] hover:text-[var(--sys-brand-identity)]"
			: "",
	);
	return (
		<Button asChild className={className} size="sm" variant="ghost">
			<ProductNavLink item={item} linkMode={linkMode}>
				{Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
				<span>{item.label}</span>
			</ProductNavLink>
		</Button>
	);
}

interface ProductNavLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
	children: ReactNode;
	item: ProductNavItem;
	linkMode: ProductNavigationLinkMode;
}

export const ProductNavLink = forwardRef<HTMLAnchorElement, ProductNavLinkProps>(
	({ children, className, item, linkMode, ...props }, ref) => {
		if (linkMode === "anchor" || item.id === "docs") {
			return (
				<a className={className} href={item.href} ref={ref} {...props}>
					{children}
				</a>
			);
		}
		return (
			<Link className={className} ref={ref} to={item.href} {...props}>
				{children}
			</Link>
		);
	},
);
ProductNavLink.displayName = "ProductNavLink";

export function readBrowserPathname(): string {
	if (typeof window === "undefined") {
		return "/";
	}
	return window.location.pathname;
}
