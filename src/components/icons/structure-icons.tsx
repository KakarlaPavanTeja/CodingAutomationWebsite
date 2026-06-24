import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

type StructureIconProps = SVGProps<SVGSVGElement>;

const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function PointerArrow({ from, to }: { from: number; to: number }) {
  return (
    <>
      <path d={`M${from} 12 H${to - 1.1}`} {...strokeProps} />
      <path d={`M${to - 1.1} 10.6 L${to} 12 L${to - 1.1} 13.4`} {...strokeProps} />
    </>
  );
}

/** Horizontal linked list: nodes connected by next pointers ending at null. */
export function LinkedListIcon({ className, ...props }: StructureIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("h-4 w-4", className)}
      {...props}
    >
      <circle cx="4.5" cy="12" r="2.5" {...strokeProps} />
      <circle cx="11.5" cy="12" r="2.5" {...strokeProps} />
      <circle cx="18.5" cy="12" r="2.5" {...strokeProps} />
      <PointerArrow from={7} to={9} />
      <PointerArrow from={14} to={16} />
      <path d="M21 12h1.25" {...strokeProps} />
      <path d="M22.75 10.25v3.5" {...strokeProps} />
    </svg>
  );
}

/** Binary tree with root, two children, and left subtree grandchildren. */
export function BinaryTreeIcon({ className, ...props }: StructureIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("h-4 w-4", className)}
      {...props}
    >
      <path
        d="M12 6.75v1.75M12 8.5L7.25 12.25M12 8.5l4.75 3.75M7.25 12.25v1.75M7.25 14l-2 2.75M7.25 14l2 2.75"
        {...strokeProps}
      />
      <circle cx="12" cy="5.5" r="2.25" {...strokeProps} />
      <circle cx="7.25" cy="14.25" r="2.25" {...strokeProps} />
      <circle cx="16.75" cy="14.25" r="2.25" {...strokeProps} />
      <circle cx="5.25" cy="19.25" r="1.85" {...strokeProps} />
      <circle cx="9.25" cy="19.25" r="1.85" {...strokeProps} />
    </svg>
  );
}
