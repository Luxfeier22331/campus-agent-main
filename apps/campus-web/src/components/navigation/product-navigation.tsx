import { Link } from "@tanstack/react-router";
import { BookOpen, Home, MapIcon, Menu, Send, Utensils } from "lucide-react";
import type { AnchorHTMLAttributes, ComponentType, ReactNode, SVGProps } from "react";
import { forwardRef } from "react";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
	getProductNavItems,
	isProductNavActive,
	type ProductNavItem,
	type ProductNavItemId,
} from "@/platform/navigation/product-nav";

const productNavIcons = {
	chat: Home,
	dining: Utensils,
	docs: BookOpen,
	feedback: Send,
	map: MapIcon,
} satisfies Record<ProductNavItemId, ComponentType<SVGProps<SVGSVGElement>>>;

type ProductNavigationVariant = "standard" | "chat" | "map";
type ProductNavigationLinkMode = "anchor" | "router";

export function ProductBrandLink({
	className,
	linkMode = "anchor",
	subtitle = "MUC Campus Q&A",
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
	linkMode = "router",
	showIcons = false,
	variant = "standard",
}: {
	activePath: string;
	className?: string;
	linkMode?: ProductNavigationLinkMode;
	showIcons?: boolean;
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
					showIcon={showIcons}
					variant={variant}
				/>
			))}
		</nav>
	);
}

export function ProductNavMobileMenu({
	activePath,
	className,
	linkMode = "router",
	triggerClassName,
	variant = "standard",
}: {
	activePath: string;
	className?: string;
	linkMode?: ProductNavigationLinkMode;
	triggerClassName?: string;
	variant?: ProductNavigationVariant;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label="打开产品导航"
					className={cn("size-11 rounded-md", triggerClassName)}
					size="icon"
					variant={variant === "map" ? "secondary" : "ghost"}
				>
					<Menu aria-hidden="true" className="size-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className={cn("min-w-44", className)}>
				{getProductNavItems().map((item) => {
					const Icon = productNavIcons[item.id];
					const active = isProductNavActive(activePath, item);
					return (
						<DropdownMenuItem asChild key={item.id}>
							<ProductNavLink
								className={cn(
									"flex min-h-10 w-full items-center gap-2 rounded-sm px-2 text-sm",
									active ? "bg-accent text-accent-foreground" : "",
								)}
								item={item}
								linkMode={linkMode}
							>
								<Icon aria-hidden="true" className="size-4" />
								<span>{item.label}</span>
							</ProductNavLink>
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function MapProductNavOverlay() {
	const activePath = readBrowserPathname();
	return (
		<div className="pointer-events-auto absolute right-3 top-3 z-30">
			<ProductNavActions
				activePath={activePath}
				className="hidden rounded-full border border-white/65 bg-white/78 px-1.5 py-1 text-sm font-medium text-[var(--sys-text-muted)] shadow-[var(--shadow-xs)] backdrop-blur-md md:flex"
				linkMode="anchor"
				variant="map"
			/>
			<ProductNavMobileMenu
				activePath={activePath}
				linkMode="anchor"
				triggerClassName="border border-white/65 bg-white/85 shadow-[var(--shadow-xs)] backdrop-blur-md md:hidden"
				variant="map"
			/>
		</div>
	);
}

function ProductNavButton({
	active,
	item,
	linkMode,
	showIcon,
	variant,
}: {
	active: boolean;
	item: ProductNavItem;
	linkMode: ProductNavigationLinkMode;
	showIcon: boolean;
	variant: ProductNavigationVariant;
}) {
	const Icon = productNavIcons[item.id];
	const className = cn(
		"min-h-8 rounded-md px-2.5 text-xs",
		variant === "chat" ? "text-muted-foreground" : "",
		variant === "map" ? "rounded-full bg-white/0 text-[var(--sys-text-muted)]" : "",
		active ? "bg-muted text-foreground" : "",
		active && item.id === "feedback"
			? "text-[var(--sys-brand-identity)] hover:text-[var(--sys-brand-identity)]"
			: "",
	);
	return (
		<Button asChild className={className} size="sm" variant="ghost">
			<ProductNavLink item={item} linkMode={linkMode}>
				{showIcon ? <Icon aria-hidden="true" className="size-4" /> : null}
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

const ProductNavLink = forwardRef<HTMLAnchorElement, ProductNavLinkProps>(
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

function readBrowserPathname(): string {
	if (typeof window === "undefined") {
		return "/";
	}
	return window.location.pathname;
}
