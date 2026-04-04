"use client";

import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    title: "Pipeline",
    description: "Run the coding question automation pipeline step by step with granular control over each operation.",
    href: "/pipeline",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>
    ),
  },
  {
    title: "Outputs",
    description: "Browse, view, edit and save all generated files including descriptions, test cases, code, and enrichment.",
    href: "/outputs",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
    ),
  },
];

export default function Home() {
  return (
    <div className="px-6 py-12">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold tracking-tight mb-4">
          Coding Question Automation
        </h1>
        <p className="text-lg text-muted-foreground">
          Automate the creation of multi-language coding interview questions.
          Generate descriptions, test cases, code translations, enrichment content,
          and platform-ready packages.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {FEATURES.map((feature) => (
          <Card key={feature.href} className="relative group hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="mb-2 text-muted-foreground">{feature.icon}</div>
              <CardTitle>{feature.title}</CardTitle>
              <CardDescription>{feature.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={feature.href}>
                <Button className="w-full">
                  Open {feature.title}
                </Button>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-12">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Supported Workflows</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="space-y-1">
                <p className="font-medium">Function-based Practice</p>
                <p className="text-muted-foreground">Generate &rarr; Test Cases &rarr; Split Code &rarr; Execute &rarr; Enrichment &rarr; Package</p>
              </div>
              <div className="space-y-1">
                <p className="font-medium">Function-based Exam</p>
                <p className="text-muted-foreground">Generate &rarr; Test Cases &rarr; Split Code &rarr; Execute &rarr; Package</p>
              </div>
              <div className="space-y-1">
                <p className="font-medium">Non-function Practice</p>
                <p className="text-muted-foreground">Generate &rarr; Test Cases &rarr; Execute &rarr; Enrichment &rarr; Package</p>
              </div>
              <div className="space-y-1">
                <p className="font-medium">Non-function Exam</p>
                <p className="text-muted-foreground">Generate &rarr; Test Cases &rarr; Execute &rarr; Package</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
