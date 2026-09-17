import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { cn } from "./cn";

// vaul 基于 Radix Dialog：focus 管理、Escape、aria 合同与 Sheet 对齐，
// 移动端额外提供拖拽把手与拖动关闭。restraints 拉满避免内容自身滚动被误判为拖拽关闭。
export const Drawer = ({
	shouldScaleBackground = false,
	...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) => (
	<DrawerPrimitive.Root shouldScaleBackground={shouldScaleBackground} {...props} />
);
Drawer.displayName = "Drawer";

export const DrawerTrigger = DrawerPrimitive.Trigger;
export const DrawerClose = DrawerPrimitive.Close;
export const DrawerTitle = DialogPrimitive.Title;
export const DrawerDescription = DialogPrimitive.Description;

export function DrawerHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div className={cn("flex flex-col gap-1.5 text-center sm:text-left", className)} {...props} />
	);
}

export function DrawerFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("mt-auto flex flex-col gap-2", className)} {...props} />;
}

export interface DrawerContentProps
	extends React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content> {
	closeLabel?: string;
	hideHandle?: boolean;
}

export const DrawerContent = React.forwardRef<
	React.ElementRef<typeof DrawerPrimitive.Content>,
	DrawerContentProps
>(({ children, className, closeLabel = "关闭", hideHandle = false, ...props }, ref) => (
	<DrawerPrimitive.Portal>
		<DrawerPrimitive.Overlay
			className={cn(
				"fixed inset-0 z-[var(--layer-overlay)] bg-black/40 duration-[var(--motion-duration-standard)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none",
			)}
		/>
		<DrawerPrimitive.Content
			className={cn(
				"fixed inset-x-0 bottom-0 z-[var(--layer-overlay)] flex max-h-[92dvh] flex-col rounded-t-[var(--radius-xl)] border bg-background pb-[max(0px,env(safe-area-inset-bottom))] shadow-lg duration-[var(--motion-duration-slow)] ease-[var(--motion-easing-spring)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none",
				className,
			)}
			ref={ref}
			{...props}
		>
			{hideHandle ? null : (
				<div aria-hidden="true" className="mx-auto flex h-8 w-full items-center justify-center">
					<div className="h-1.5 w-10 rounded-full bg-border-default" />
				</div>
			)}
			{children}
			<DrawerPrimitive.Close
				className={cn(
					"absolute right-3 top-3 rounded-[var(--radius-md)] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
				)}
			>
				<X aria-hidden="true" className="size-4" />
				<span className="sr-only">{closeLabel}</span>
			</DrawerPrimitive.Close>
		</DrawerPrimitive.Content>
	</DrawerPrimitive.Portal>
));
DrawerContent.displayName = "DrawerContent";
