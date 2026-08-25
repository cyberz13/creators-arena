import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary:
          "bg-brand-500 text-[#14121f] shadow-sm shadow-brand-500/30 hover:bg-brand-400",
        secondary:
          "bg-brand-500/10 text-brand-300 hover:bg-brand-500/15 border border-brand-500/30",
        outline:
          "border border-white/15 bg-surface text-zinc-300 hover:bg-white/5",
        ghost: "text-zinc-400 hover:bg-white/10 hover:text-white",
        destructive: "bg-red-600 text-white hover:bg-red-700",
        gold: "bg-gradient-to-l from-amber-500 to-amber-400 text-amber-950 shadow-sm shadow-amber-500/30 hover:from-amber-600 hover:to-amber-500",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
