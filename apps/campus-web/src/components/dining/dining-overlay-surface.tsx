import { Drawer, DrawerContent, Sheet, SheetContent } from "@campus-agent/ui";
import type { ComponentProps, ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

interface AdaptiveSheetSurfaceProps {
	/** 桌面侧栏宽度类，默认 sm:max-w-lg。 */
	desktopClassName?: string;
	/** 移动端 Drawer 内容类。 */
	mobileClassName?: string;
	onOpenAutoFocus?: ComponentProps<typeof SheetContent>["onOpenAutoFocus"];
	onCloseAutoFocus?: ComponentProps<typeof SheetContent>["onCloseAutoFocus"];
	onOpenChange(open: boolean): void;
	open: boolean;
	children: ReactNode;
}

/**
 * 食堂弹层的自适应外壳：移动端（<1024px）用 vaul Drawer（底部 + 拖拽关闭），
 * 桌面端保持右侧 Sheet。两者都基于 Radix Dialog，aria 合同、焦点管理一致。
 */
export function AdaptiveSheetSurface(props: AdaptiveSheetSurfaceProps) {
	const isMobile = useIsMobile();
	if (isMobile) {
		return (
			<Drawer autoFocus onOpenChange={props.onOpenChange} open={props.open}>
				<DrawerContent
					className={props.mobileClassName}
					onCloseAutoFocus={props.onCloseAutoFocus}
					onOpenAutoFocus={props.onOpenAutoFocus}
				>
					{props.children}
				</DrawerContent>
			</Drawer>
		);
	}
	return (
		<Sheet onOpenChange={props.onOpenChange} open={props.open}>
			<SheetContent
				className={props.desktopClassName}
				onCloseAutoFocus={props.onCloseAutoFocus}
				onOpenAutoFocus={props.onOpenAutoFocus}
			>
				{props.children}
			</SheetContent>
		</Sheet>
	);
}
