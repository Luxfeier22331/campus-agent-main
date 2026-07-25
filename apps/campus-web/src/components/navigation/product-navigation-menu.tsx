import { Button } from "@campus-agent/ui";
import { BookOpen, Home, MapIcon, Menu, Send, Utensils } from "lucide-react";
import {
	ProductNavActions,
	type ProductNavigationLinkMode,
	type ProductNavigationVariant,
	ProductNavLink,
	readBrowserPathname,
} from "@/components/navigation/product-navigation";
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
	type ProductNavItemId,
} from "@/platform/navigation/product-nav";

const productNavIcons = {
	chat: Home,
	dining: Utensils,
	docs: BookOpen,
	feedback: Send,
	map: MapIcon,
} satisfies Record<ProductNavItemId, typeof Home>;

export function ProductNavActionsWithIcons({
	activePath,
	className,
	linkMode = "router",
	variant = "standard",
}: {
	activePath: string;
	className?: string;
	linkMode?: ProductNavigationLinkMode;
	variant?: ProductNavigationVariant;
}) {
	return (
		<ProductNavActions
			activePath={activePath}
			className={className}
			icons={productNavIcons}
			linkMode={linkMode}
			variant={variant}
		/>
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
					className={cn("rounded-md", triggerClassName)}
					size="icon-lg"
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
									"flex min-h-11 w-full items-center gap-2 rounded-sm px-2 text-sm",
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

export function MapProductNavMobileMenu() {
	return (
		<ProductNavMobileMenu
			activePath={readBrowserPathname()}
			linkMode="anchor"
			triggerClassName="border border-white/65 bg-white/72 shadow-[var(--shadow-xs)] backdrop-blur-md md:hidden"
			variant="map"
		/>
	);
}
