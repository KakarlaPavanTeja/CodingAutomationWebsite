"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WORKFLOW_STEPS = [
  {
    step: 1,
    title: "Upload Your Problem",
    description: "Start by uploading your problem statement (problem.md) and a reference solution file. The system accepts Python, C++, Java, and Node.js solutions.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
    ),
    color: "from-violet-500 to-purple-600",
    bgGlow: "bg-violet-500/10",
  },
  {
    step: 2,
    title: "Configure Workflow",
    description: "Choose your question type (Function-based or Non-function) and mode (Practice or Exam). Select which languages to target and customize sub-operations.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
    ),
    color: "from-blue-500 to-cyan-500",
    bgGlow: "bg-blue-500/10",
  },
  {
    step: 3,
    title: "Generate Question Content",
    description: "The AI generates a complete problem description, translates your solution into multiple languages, creates titles, estimates difficulty, and classifies topics.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/></svg>
    ),
    color: "from-emerald-500 to-teal-500",
    bgGlow: "bg-emerald-500/10",
  },
  {
    step: 4,
    title: "Create & Execute Tests",
    description: "Generate diverse test cases, split code into components, and execute against all target languages. View real-time progress with per-language pass/fail results.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
    ),
    color: "from-orange-500 to-amber-500",
    bgGlow: "bg-orange-500/10",
  },
  {
    step: 5,
    title: "Enrich & Package",
    description: "Add hints, real-life examples, and follow-up questions. Finally, package everything into platform-ready LUA and testcase files for immediate deployment.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
    ),
    color: "from-pink-500 to-rose-500",
    bgGlow: "bg-pink-500/10",
  },
];

const FEATURES = [
  {
    title: "Multi-Language Support",
    description: "Generate and test code in Python, C++, Java, and Node.js simultaneously.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
    ),
  },
  {
    title: "Granular Control",
    description: "Toggle individual operations on or off. Run only what you need.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20v-6M6 20V10M18 20V4"/></svg>
    ),
  },
  {
    title: "Real-time Progress",
    description: "Watch each step execute with live status updates and elapsed time tracking.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    ),
  },
  {
    title: "Inline Editor",
    description: "Browse, edit, and save generated files in a VS Code-like interface.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>
    ),
  },
  {
    title: "Step-by-Step Execution",
    description: "Run each pipeline stage independently. No forced sequential execution.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6L12 2l4 4"/><path d="M12 2v10.3"/><path d="M4 14l4 4 4-4"/><path d="M8 22v-4"/><path d="M16 18l4 4 4-4"/></svg>
    ),
  },
  {
    title: "AI-Powered Generation",
    description: "Leverages LLMs to create descriptions, test cases, hints, and enrichment.",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
    ),
  },
];

const WORKFLOWS = [
  { name: "Function-based Practice", steps: "Generate → Test Cases → Split Code → Execute → Enrichment → Package", badge: "Full" },
  { name: "Function-based Exam", steps: "Generate → Test Cases → Split Code → Execute → Package", badge: "Exam" },
  { name: "Non-function Practice", steps: "Generate → Test Cases → Execute → Enrichment → Package", badge: "Full" },
  { name: "Non-function Exam", steps: "Generate → Test Cases → Execute → Package", badge: "Exam" },
];

export default function GuidePage() {
  const [activeWorkflow, setActiveWorkflow] = useState(0);

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background gradient effects */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-purple-500/10 blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-emerald-500/5 blur-3xl" />
        </div>

        <div className="relative px-6 py-20 sm:py-28">
          <div className="max-w-4xl mx-auto text-center">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border/50 bg-card/50 backdrop-blur-sm text-sm text-muted-foreground mb-8">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Coding Question Automation Pipeline
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
              From Solution to{" "}
              <span className="bg-gradient-to-r from-violet-400 via-blue-400 to-emerald-400 bg-clip-text text-transparent">
                Platform-Ready
              </span>
              {" "}in Minutes
            </h1>

            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
              Transform a single code solution into a complete, multi-language coding interview question
              with descriptions, test cases, enrichment content, and deployment packages — all automated.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link href="/pipeline">
                <Button size="lg" className="h-12 px-8 text-base">
                  Open Pipeline
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                </Button>
              </Link>
              <Link href="/outputs">
                <Button variant="outline" size="lg" className="h-12 px-8 text-base">
                  Browse Outputs
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="px-6 py-20 border-t border-border/50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">How It Works</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Five simple steps to go from a raw solution to a fully packaged coding question
            </p>
          </div>

          <div className="relative">
            {/* Vertical line connector */}
            <div className="absolute left-8 top-8 bottom-8 w-px bg-gradient-to-b from-violet-500/50 via-blue-500/50 to-pink-500/50 hidden lg:block" />

            <div className="space-y-6">
              {WORKFLOW_STEPS.map((item, index) => (
                <div key={index} className="relative group">
                  <div className={cn(
                    "flex flex-col lg:flex-row items-start gap-5 p-6 rounded-2xl border border-border/50 transition-all duration-300",
                    "hover:border-border hover:shadow-lg hover:shadow-black/5",
                    item.bgGlow
                  )}>
                    {/* Step number with gradient */}
                    <div className={cn(
                      "relative flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br shrink-0",
                      item.color
                    )}>
                      <div className="text-white">{item.icon}</div>
                      <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-background border-2 border-border flex items-center justify-center text-xs font-bold">
                        {item.step}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-semibold mb-1.5">{item.title}</h3>
                      <p className="text-muted-foreground leading-relaxed">{item.description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="px-6 py-20 border-t border-border/50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Key Features</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Built for efficiency with a developer-first experience
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((feature, index) => (
              <div
                key={index}
                className="group p-5 rounded-xl border border-border/50 bg-card/30 hover:bg-card/60 hover:border-border transition-all duration-300 hover:shadow-lg hover:shadow-black/5"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-4 group-hover:scale-110 transition-transform">
                  {feature.icon}
                </div>
                <h3 className="font-semibold mb-1.5">{feature.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Workflows Section */}
      <section className="px-6 py-20 border-t border-border/50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Supported Workflows</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Four workflow configurations to match your needs
            </p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
            {WORKFLOWS.map((wf, index) => (
              <button
                key={index}
                onClick={() => setActiveWorkflow(index)}
                className={cn(
                  "p-4 rounded-xl border text-left transition-all duration-200",
                  activeWorkflow === index
                    ? "border-primary bg-primary/10 shadow-md"
                    : "border-border/50 bg-card/30 hover:border-border hover:bg-card/60"
                )}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={cn(
                    "text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
                    wf.badge === "Full"
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "bg-amber-500/20 text-amber-400"
                  )}>
                    {wf.badge}
                  </span>
                </div>
                <span className="text-sm font-medium">{wf.name}</span>
              </button>
            ))}
          </div>

          {/* Active workflow steps */}
          <div className="p-6 rounded-2xl border border-border/50 bg-card/30">
            <h3 className="font-semibold mb-4">{WORKFLOWS[activeWorkflow].name}</h3>
            <div className="flex flex-wrap items-center gap-2">
              {WORKFLOWS[activeWorkflow].steps.split(" → ").map((step, i, arr) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-sm font-medium">
                    {step}
                  </span>
                  {i < arr.length - 1 && (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Languages Section */}
      <section className="px-6 py-20 border-t border-border/50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">Supported Languages</h2>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { name: "Python", color: "from-yellow-500 to-yellow-600", abbr: "PY", desc: "Python 3.10+" },
              { name: "C++", color: "from-blue-500 to-blue-600", abbr: "C++", desc: "C++17 standard" },
              { name: "Java", color: "from-orange-500 to-red-500", abbr: "JV", desc: "Java 11+" },
              { name: "Node.js", color: "from-green-500 to-emerald-600", abbr: "JS", desc: "Node.js runtime" },
            ].map((lang) => (
              <div key={lang.name} className="group p-6 rounded-xl border border-border/50 bg-card/30 hover:bg-card/60 transition-all duration-300 text-center hover:shadow-lg hover:shadow-black/5">
                <div className={cn(
                  "w-14 h-14 rounded-2xl bg-gradient-to-br mx-auto mb-4 flex items-center justify-center group-hover:scale-110 transition-transform",
                  lang.color
                )}>
                  <span className="text-white text-sm font-bold">{lang.abbr}</span>
                </div>
                <h3 className="font-semibold mb-1">{lang.name}</h3>
                <p className="text-xs text-muted-foreground">{lang.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="px-6 py-20 border-t border-border/50">
        <div className="max-w-3xl mx-auto text-center">
          <div className="relative p-10 rounded-3xl border border-border/50 overflow-hidden">
            {/* Background glow */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-0 left-1/4 w-64 h-64 rounded-full bg-violet-500/10 blur-3xl" />
              <div className="absolute bottom-0 right-1/4 w-64 h-64 rounded-full bg-blue-500/10 blur-3xl" />
            </div>

            <div className="relative">
              <h2 className="text-2xl sm:text-3xl font-bold mb-3">Ready to Get Started?</h2>
              <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
                Upload your solution and let the pipeline handle the rest. Create complete coding questions in minutes, not hours.
              </p>
              <Link href="/pipeline">
                <Button size="lg" className="h-12 px-10 text-base">
                  Launch Pipeline
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
