"use client";

import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WhatsNewList } from "@/components/whats-new/WhatsNewList";
import { WHATS_NEW } from "@/lib/whats-new";

export default function WhatsNewPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">What&apos;s New</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Recent features and improvements — grouped by area, explained in plain English.
            </p>
          </div>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Tap any item below to expand and read more. Updates are grouped by feature, not individual commits.
      </p>

      <WhatsNewList features={WHATS_NEW} />

      <div className="pt-2 text-center">
        <Link href="/problems">
          <Button variant="outline" size="sm">
            Go to Problems
          </Button>
        </Link>
      </div>
    </div>
  );
}
