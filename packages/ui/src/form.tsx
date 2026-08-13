import * as LabelPrimitive from "@radix-ui/react-label";
import { ChevronDown } from "lucide-react";
import {
	cloneElement,
	forwardRef,
	type HTMLAttributes,
	type InputHTMLAttributes,
	type ReactElement,
	type ReactNode,
	type SelectHTMLAttributes,
	type TextareaHTMLAttributes,
	useId,
} from "react";
import { cn } from "./cn";

const controlClass =
	"w-full rounded-md border border-input bg-background px-3 text-foreground shadow-[var(--shadow-xs)] transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:border-border-default disabled:bg-[var(--state-disabled-bg)] disabled:text-[var(--state-disabled-text)] aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
	({ className, type, ...props }, ref) => (
		<input
			className={cn(
				controlClass,
				"min-h-[var(--ui-control-height)] py-1 text-base file:border-0 file:bg-transparent file:text-sm file:font-medium md:text-sm",
				className,
			)}
			ref={ref}
			type={type}
			{...props}
		/>
	),
);
Input.displayName = "Input";

export const Textarea = forwardRef<
	HTMLTextAreaElement,
	TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
	<textarea
		className={cn(controlClass, "min-h-20 resize-y py-2 text-sm", className)}
		ref={ref}
		{...props}
	/>
));
Textarea.displayName = "Textarea";

export const NativeSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
	({ children, className, ...props }, ref) => (
		<div className="relative">
			<select
				className={cn(
					controlClass,
					"min-h-[var(--ui-control-height)] appearance-none pr-9 text-sm",
					className,
				)}
				ref={ref}
				{...props}
			>
				{children}
			</select>
			<ChevronDown
				aria-hidden="true"
				className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
			/>
		</div>
	),
);
NativeSelect.displayName = "NativeSelect";

export const Label = forwardRef<
	React.ElementRef<typeof LabelPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
	<LabelPrimitive.Root
		className={cn(
			"text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
			className,
		)}
		ref={ref}
		{...props}
	/>
));
Label.displayName = LabelPrimitive.Root.displayName;

interface FieldControlProps {
	"aria-describedby"?: string;
	"aria-invalid"?: boolean;
	id?: string;
}

export function Field({
	action,
	children,
	className,
	description,
	error,
	id,
	label,
}: {
	action?: ReactNode;
	children: ReactElement<FieldControlProps>;
	className?: string;
	description?: ReactNode;
	error?: ReactNode;
	id?: string;
	label: ReactNode;
}) {
	const generatedId = useId();
	const controlId = id ?? children.props.id ?? generatedId;
	const descriptionId = `${controlId}-description`;
	const errorId = `${controlId}-error`;
	const describedBy = [
		...new Set([
			children.props["aria-describedby"],
			description ? descriptionId : null,
			error ? errorId : null,
		]),
	]
		.filter(Boolean)
		.join(" ");
	const control = cloneElement(children, {
		...(describedBy ? { "aria-describedby": describedBy } : {}),
		...(error
			? { "aria-invalid": true }
			: children.props["aria-invalid"] === undefined
				? {}
				: { "aria-invalid": children.props["aria-invalid"] }),
		id: controlId,
	});

	return (
		<div className={cn("grid gap-1.5 text-sm", className)}>
			<Label htmlFor={controlId}>{label}</Label>
			{action ? (
				<div className="relative">
					{control}
					<div className="absolute inset-y-0 right-0 flex items-center">{action}</div>
				</div>
			) : (
				control
			)}
			{description ? (
				<div className="text-xs text-muted-foreground" id={descriptionId}>
					{description}
				</div>
			) : null}
			{error ? (
				<div className="text-danger text-xs" id={errorId}>
					{error}
				</div>
			) : null}
		</div>
	);
}

export function FieldGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("grid gap-4", className)} {...props} />;
}
