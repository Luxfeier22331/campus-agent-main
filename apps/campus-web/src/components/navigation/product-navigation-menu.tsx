import {
	Button,
	cn,
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
	ThemeModeControl,
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@campus-agent/ui";
import {
	Activity,
	Bell,
	BookOpen,
	Bus,
	Home,
	MapIcon,
	Menu,
	Send,
	UsersRound,
	Utensils,
} from "lucide-react";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { AuthDialog } from "@/components/auth/auth-dialog";
import {
	type ProductNavigationLinkMode,
	ProductNavLink,
	readBrowserPathname,
} from "@/components/navigation/product-navigation";
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
	groups: UsersRound,
	map: MapIcon,
	notices: Bell,
	transport: Bus,
	status: Activity,
} satisfies Record<ProductNavItemId, typeof Home>;

export type ProductNavMobileMenuClose = (afterClose?: () => void) => void;
export type ProductNavMobileAccountAction = ReactNode | ((openAuthDialog: () => void) => ReactNode);
export type ProductNavMobileLocalActions =
	| ReactNode
	| ((closeMenu: ProductNavMobileMenuClose) => ReactNode);

export function ProductNavMobileMenu({
	accountAction,
	activePath,
	className,
	linkMode = "router",
	localActions,
	triggerClassName,
	variant = "default",
}: {
	accountAction?: ProductNavMobileAccountAction;
	activePath: string;
	className?: string;
	linkMode?: ProductNavigationLinkMode;
	localActions?: ProductNavMobileLocalActions;
	triggerClassName?: string;
	variant?: "default" | "map";
}) {
	const [authDialogOpen, setAuthDialogOpen] = useState(false);
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const afterCloseRef = useRef<(() => void) | null>(null);
	const closeMenu = useCallback<ProductNavMobileMenuClose>((afterClose) => {
		afterCloseRef.current = afterClose ?? null;
		setOpen(false);
	}, []);
	const openAuthDialog = useCallback(() => closeMenu(() => setAuthDialogOpen(true)), [closeMenu]);
	const renderedAccountAction =
		typeof accountAction === "function" ? accountAction(openAuthDialog) : accountAction;
	const renderedLocalActions =
		typeof localActions === "function" ? localActions(closeMenu) : localActions;
	return (
		<>
			<Sheet onOpenChange={setOpen} open={open}>
				<TooltipProvider delayDuration={300}>
					<Tooltip>
						<TooltipTrigger asChild>
							<SheetTrigger asChild>
								<Button
									aria-label="打开全局菜单"
									className={cn(triggerClassName)}
									data-slot="product-nav-mobile-trigger"
									ref={triggerRef}
									size="icon-lg"
									variant={variant === "map" ? "secondary" : "ghost"}
								>
									<Menu aria-hidden="true" className="size-4" />
								</Button>
							</SheetTrigger>
						</TooltipTrigger>
						<TooltipContent side="bottom">打开全局菜单</TooltipContent>
					</Tooltip>
				</TooltipProvider>
				<SheetContent
					aria-describedby={undefined}
					aria-label="校园问答导航"
					className={cn("flex w-[min(22rem,88vw)] flex-col gap-0 p-0", className)}
					onCloseAutoFocus={(event) => {
						if (triggerRef.current?.isConnected) {
							event.preventDefault();
							triggerRef.current.focus({ preventScroll: true });
						}
						const afterClose = afterCloseRef.current;
						afterCloseRef.current = null;
						if (afterClose) {
							window.requestAnimationFrame(afterClose);
						}
					}}
					side="right"
				>
					<SheetHeader className="border-b px-5 py-4 pr-14 text-left">
						<SheetTitle>校园问答导航</SheetTitle>
						<SheetDescription className="sr-only">
							在产品页面、账号和外观设置之间切换。
						</SheetDescription>
					</SheetHeader>
					<div className="min-h-0 flex-1 overflow-y-auto p-4">
						<section aria-labelledby="campus-mobile-product-label">
							<h2 className="ui-metadata mb-2 px-2" id="campus-mobile-product-label">
								产品导航
							</h2>
							<nav aria-label="产品导航" className="grid gap-1">
								{getProductNavItems().map((item) => {
									const Icon = productNavIcons[item.id];
									const active = isProductNavActive(activePath, item);
									return (
										<SheetClose asChild key={item.id}>
											<ProductNavLink
												aria-current={active ? "page" : undefined}
												className={cn(
													"flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-lg)] px-3 text-sm transition-[color,background-color] duration-[var(--motion-duration-fast)] ease-[var(--motion-easing-standard)] motion-reduce:transition-none hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
													active && "bg-selected font-semibold text-selected-foreground",
												)}
												item={item}
												linkMode={linkMode}
											>
												<Icon aria-hidden="true" className="size-4" />
												<span>{item.label}</span>
											</ProductNavLink>
										</SheetClose>
									);
								})}
							</nav>
						</section>
						{renderedAccountAction ? (
							<section aria-labelledby="campus-mobile-account-label" className="mt-6 border-t pt-5">
								<h2 className="ui-metadata mb-2 px-2" id="campus-mobile-account-label">
									账号
								</h2>
								<div className="w-full">{renderedAccountAction}</div>
							</section>
						) : null}
						{renderedLocalActions ? (
							<section aria-labelledby="campus-mobile-local-label" className="mt-6 border-t pt-5">
								<h2 className="ui-metadata mb-2 px-2" id="campus-mobile-local-label">
									当前页面
								</h2>
								<div className="flex flex-wrap gap-2">{renderedLocalActions}</div>
							</section>
						) : null}
						<section aria-labelledby="campus-mobile-theme-label" className="mt-6 border-t pt-5">
							<h2 className="ui-metadata mb-2 px-2" id="campus-mobile-theme-label">
								外观
							</h2>
							<ThemeModeControl aria-labelledby="campus-mobile-theme-label" label={null} />
						</section>
					</div>
				</SheetContent>
			</Sheet>
			{authDialogOpen ? <AuthDialog onOpenChange={setAuthDialogOpen} open /> : null}
		</>
	);
}

export function MapProductNavMobileMenu({
	accountAction,
}: {
	accountAction?: ProductNavMobileAccountAction;
}) {
	return (
		<ProductNavMobileMenu
			accountAction={accountAction}
			activePath={readBrowserPathname()}
			linkMode="anchor"
			triggerClassName="border border-[var(--map-overlay-border)] bg-[var(--map-overlay-surface)] shadow-[var(--map-overlay-shadow)] backdrop-blur-md lg:hidden"
			variant="map"
		/>
	);
}
