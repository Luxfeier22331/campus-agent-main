import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";
import { buttonVariants } from "./button";
import { cn } from "./cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Overlay
		className={cn(
			"fixed inset-0 z-[var(--layer-overlay)] bg-[var(--sys-overlay)] duration-[var(--motion-duration-standard)] ease-[var(--motion-easing-standard)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
			className,
		)}
		ref={ref}
		{...props}
	/>
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

export interface DialogContentProps
	extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
	closeLabel?: string;
	showCloseButton?: boolean;
}

export const DialogContent = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Content>,
	DialogContentProps
>(({ children, className, closeLabel = "关闭", showCloseButton = true, ...props }, ref) => (
	<DialogPortal>
		<DialogOverlay />
		<DialogPrimitive.Content
			className={cn(
				"fixed left-1/2 top-1/2 z-[var(--layer-overlay)] grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-md border bg-background p-6 shadow-lg duration-[var(--motion-duration-standard)] ease-[var(--motion-easing-standard)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
				className,
			)}
			ref={ref}
			{...props}
		>
			{children}
			{showCloseButton ? (
				<DialogPrimitive.Close className="absolute right-3 top-3 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
					<X aria-hidden="true" className="size-4" />
					<span className="sr-only">{closeLabel}</span>
				</DialogPrimitive.Close>
			) : null}
		</DialogPrimitive.Content>
	</DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("flex flex-col gap-2 text-left", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
			{...props}
		/>
	);
}

export const DialogTitle = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Title className={cn("font-semibold text-lg", className)} ref={ref} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export const DialogDescription = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
	<DialogPrimitive.Description
		className={cn("text-sm text-muted-foreground", className)}
		ref={ref}
		{...props}
	/>
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

export const AlertDialogContent = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, ...props }, ref) => (
	<AlertDialogPrimitive.Portal>
		<AlertDialogPrimitive.Overlay className="fixed inset-0 z-[var(--layer-overlay)] bg-[var(--sys-overlay)]" />
		<AlertDialogPrimitive.Content
			className={cn(
				"fixed left-1/2 top-1/2 z-[var(--layer-overlay)] grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-md border bg-background p-6 shadow-lg",
				className,
			)}
			ref={ref}
			{...props}
		/>
	</AlertDialogPrimitive.Portal>
));
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

export const AlertDialogTitle = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
	<AlertDialogPrimitive.Title
		className={cn("font-semibold text-lg", className)}
		ref={ref}
		{...props}
	/>
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

export const AlertDialogDescription = React.forwardRef<
	React.ElementRef<typeof AlertDialogPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
	<AlertDialogPrimitive.Description
		className={cn("text-sm text-muted-foreground", className)}
		ref={ref}
		{...props}
	/>
));
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName;

export function AlertDialogHeader(props: React.HTMLAttributes<HTMLDivElement>) {
	return <div {...props} className={cn("flex flex-col gap-2 text-left", props.className)} />;
}

export function AlertDialogFooter(props: React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			{...props}
			className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", props.className)}
		/>
	);
}

export function AlertDialogAction({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
	return (
		<AlertDialogPrimitive.Action
			className={cn(buttonVariants({ variant: "destructive" }), className)}
			{...props}
		/>
	);
}

export function AlertDialogCancel({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
	return (
		<AlertDialogPrimitive.Cancel
			className={cn(buttonVariants({ variant: "outline" }), className)}
			{...props}
		/>
	);
}

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogTitle;
export const SheetDescription = DialogDescription;
export const SheetHeader = DialogHeader;
export const SheetFooter = DialogFooter;

const sheetVariants = cva(
	"fixed z-[var(--layer-overlay)] overflow-y-auto bg-background p-5 shadow-lg duration-[var(--motion-duration-standard)] ease-[var(--motion-easing-standard)] data-[state=open]:animate-in data-[state=closed]:animate-out",
	{
		variants: {
			side: {
				top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
				bottom:
					"inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
				left: "inset-y-0 left-0 h-full w-[min(22rem,88vw)] border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
				right:
					"inset-y-0 right-0 h-full w-[min(22rem,88vw)] border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
			},
		},
		defaultVariants: { side: "right" },
	},
);

export interface SheetContentProps
	extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
		VariantProps<typeof sheetVariants> {
	closeLabel?: string;
}

export const SheetContent = React.forwardRef<
	React.ElementRef<typeof DialogPrimitive.Content>,
	SheetContentProps
>(({ children, className, closeLabel = "关闭", side, ...props }, ref) => (
	<DialogPrimitive.Portal>
		<DialogOverlay />
		<DialogPrimitive.Content
			className={cn(sheetVariants({ className, side }))}
			ref={ref}
			{...props}
		>
			{children}
			<DialogPrimitive.Close className="absolute right-3 top-3 inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
				<X aria-hidden="true" className="size-4" />
				<span className="sr-only">{closeLabel}</span>
			</DialogPrimitive.Close>
		</DialogPrimitive.Content>
	</DialogPrimitive.Portal>
));
SheetContent.displayName = "SheetContent";
