"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { WhatsNewFeature } from "@/lib/whats-new";

const TAG_COLORS: Record<WhatsNewFeature["tag"], string> = {
  Pipeline: "bg-blue-500/10 text-blue-600 dark:text-blue-300",
  Testing: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  Editorial: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
  Admin: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  Collaboration: "bg-pink-500/10 text-pink-600 dark:text-pink-300",
  Reliability: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
};

function formatDate(iso: string) {
  // Pin the locale (not the runtime default) so the server and client format
  // the date identically — otherwise en-US SSR ("Jul 1, 2026") vs en-GB browser
  // ("1 Jul 2026") triggers a hydration mismatch.
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function FeatureCard({ feature }: { feature: WhatsNewFeature }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-base">{feature.title}</h3>
              <Badge variant="outline" className={cn("text-[10px]", TAG_COLORS[feature.tag])}>
                {feature.tag}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{feature.summary}</p>
          </div>
          <time
            dateTime={feature.date}
            className="text-xs text-muted-foreground shrink-0 tabular-nums"
          >
            {formatDate(feature.date)}
          </time>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-2">
        {feature.items.map((item) => (
          <ItemRow key={item.title} title={item.title} summary={item.summary} details={item.details} />
        ))}
      </CardContent>
    </Card>
  );
}

function ItemRow({
  title,
  summary,
  details,
}: {
  title: string;
  summary: string;
  details: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-md border border-border/60 bg-muted/20">
        <CollapsibleTrigger
          className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors rounded-md"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 mt-0.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{title}</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{summary}</p>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3 pl-9 text-sm text-muted-foreground leading-relaxed border-t border-border/40 pt-2">
            {details}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/** Compact teaser row for the homepage — one feature, first item only */
export function WhatsNewTeaser({ feature }: { feature: WhatsNewFeature }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-border/50 bg-muted/20">
        <CollapsibleTrigger className="flex w-full items-start gap-2 px-3 py-3 text-left hover:bg-muted/40 transition-colors rounded-lg">
          <ChevronDown
            className={cn(
              "h-4 w-4 mt-0.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-0.5">
              <span className="text-sm font-medium">{feature.title}</span>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {formatDate(feature.date)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{feature.summary}</p>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3 pl-9 space-y-2 border-t border-border/40 pt-2">
            {feature.items.map((item) => (
              <div key={item.title}>
                <p className="text-xs font-medium">{item.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                  {item.details}
                </p>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

interface WhatsNewListProps {
  features: WhatsNewFeature[];
}

export function WhatsNewList({ features }: WhatsNewListProps) {
  return (
    <div className="space-y-4">
      {features.map((feature) => (
        <FeatureCard key={feature.id} feature={feature} />
      ))}
    </div>
  );
}
