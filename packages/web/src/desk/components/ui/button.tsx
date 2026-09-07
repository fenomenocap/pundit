import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors duration-150 ease-out disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary:
          "bg-fg text-bg hover:bg-accent hover:text-accent-fg",
        accent: "bg-accent text-accent-fg hover:bg-accent/90",
        ghost:
          "bg-transparent text-fg hover:bg-elevated border border-border",
        subtle: "bg-elevated text-fg hover:bg-panel border border-border",
        live: "bg-live text-fg hover:bg-live/90",
        danger: "text-down hover:bg-down/10",
      },
      size: {
        sm: "h-8 px-3 text-xs rounded-sm",
        md: "h-10 px-4 text-sm rounded-md",
        lg: "h-11 px-5 text-sm rounded-md",
        icon: "size-10 rounded-md",
        "icon-sm": "size-8 rounded-sm",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
