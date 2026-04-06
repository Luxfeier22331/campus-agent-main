import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chat-accent focus-visible:ring-offset-2 focus-visible:ring-offset-chat-bg disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      size: {
        default: "px-4 py-2.5",
        icon: "size-11 p-0",
        sm: "min-h-10 px-3 py-2",
      },
      variant: {
        ghost: "border-transparent bg-transparent text-chat-muted hover:bg-chat-rail",
        primary:
          "border-chat-ink bg-chat-ink text-chat-panel shadow-sm hover:border-chat-ink-strong hover:bg-chat-ink-strong",
        secondary:
          "border-chat-border bg-chat-panel text-chat-ink shadow-sm hover:border-chat-accent/40 hover:bg-chat-panel-strong",
      },
    },
    defaultVariants: {
      size: "default",
      variant: "primary",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  asChild = false,
  className,
  size,
  variant,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return <Comp className={cn(buttonVariants({ className, size, variant }))} {...props} />;
}

export { buttonVariants };
