import { Button, cn } from "@campus-agent/ui";
import { Link } from "@tanstack/react-router";
import type { AriaAttributes, MouseEventHandler, ReactNode } from "react";
import { forwardRef } from "react";
import {
	getProductNavItems,
	isProductNavActive,
	type ProductNavItem,
	type ProductNavItemLinkMode,
} from "@/platform/navigation/product-nav";
export type ProductNavigationLinkMode = ProductNavItemLinkMode;

export function ProductBrandLink({
	className,
	compactLabel,
	desktopLabel = "中央民族大学校园问答",
	linkMode = "anchor",
	subtitle = "",
}: {
	className?: string;
	compactLabel?: string | undefined;
	desktopLabel?: string | undefined;
	linkMode?: ProductNavigationLinkMode;
	subtitle?: string | undefined;
}) {
	const classNames = cn("campus-product-brand flex min-w-0 items-center gap-3", className);
	const mobileLabel = compactLabel || subtitle || "校园问答";
	const children = (
		<span className="min-w-0">
			<span className="block truncate whitespace-nowrap text-sm font-semibold tracking-normal text-[var(--sys-text-strong)] lg:hidden">
				{mobileLabel}
			</span>
			<span className="hidden whitespace-nowrap text-sm font-semibold tracking-normal text-[var(--sys-text-strong)] lg:block">
				{desktopLabel}
			</span>
			{subtitle ? (
				<span className="hidden truncate text-xs text-[var(--sys-text-subtle)] lg:block">
					{subtitle}
				</span>
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
	linkMode = "router",
}: {
	activePath: string;
	className?: string;
	linkMode?: ProductNavigationLinkMode;
}) {
	return (
		<nav aria-label="产品导航" className={cn("items-center", className)}>
			{getProductNavItems().map((item) => (
				<ProductNavButton
					active={isProductNavActive(activePath, item)}
					item={item}
					key={item.id}
					linkMode={linkMode}
				/>
			))}
		</nav>
	);
}

function ProductNavButton({
	active,
	item,
	linkMode,
}: {
	active: boolean;
	item: ProductNavItem;
	linkMode: ProductNavigationLinkMode;
}) {
	const className = cn(
		"min-h-9 rounded-md bg-transparent px-2.5 text-xs text-inherit",
		active
			? "bg-selected font-semibold text-selected-foreground hover:bg-selected-hover hover:text-selected-foreground active:bg-selected-pressed"
			: "",
	);
	return (
		<Button asChild className={className} size="sm" variant="ghost">
			<ProductNavLink aria-current={active ? "page" : undefined} item={item} linkMode={linkMode}>
				<span>{item.label}</span>
			</ProductNavLink>
		</Button>
	);
}

interface ProductNavLinkProps {
	"aria-current"?: AriaAttributes["aria-current"];
	children: ReactNode;
	className?: string;
	item: ProductNavItem;
	linkMode: ProductNavigationLinkMode;
	onClick?: MouseEventHandler<HTMLAnchorElement>;
}

export const ProductNavLink = forwardRef<HTMLAnchorElement, ProductNavLinkProps>(
	({ children, className, item, linkMode, ...props }, ref) => {
		if (item.linkMode === "anchor" || linkMode === "anchor" || item.id === "docs") {
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
