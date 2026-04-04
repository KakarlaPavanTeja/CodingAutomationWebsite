"use client"

import * as React from "react"

interface CollapsibleProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
}

function Collapsible({ open, onOpenChange, children, className }: CollapsibleProps) {
  return (
    <div data-state={open ? "open" : "closed"} className={className}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<{ open?: boolean; onToggle?: () => void }>, {
            open,
            onToggle: () => onOpenChange?.(!open),
          });
        }
        return child;
      })}
    </div>
  );
}

function CollapsibleTrigger({
  children,
  className,
  open,
  onToggle,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { open?: boolean; onToggle?: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={className}
      {...props}
    >
      {children}
    </button>
  );
}

function CollapsibleContent({
  children,
  className,
  open,
}: { children: React.ReactNode; className?: string; open?: boolean; onToggle?: () => void }) {
  if (!open) return null;
  return <div className={className}>{children}</div>;
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
