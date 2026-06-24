import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const dir = dirname(fileURLToPath(import.meta.url));

const STRUCTURES = {
  standard: {
    label: "Standard",
    note: "Standard I/O · no Node helper class",
  },
  "linked-list": {
    label: "Linked List",
    note: "ListNode in description, split & LUA",
  },
  "binary-tree": {
    label: "Binary Tree",
    note: "TreeNode in description, split & LUA",
  },
};

function buildDiagram({ structure, questionType, mode }) {
  const isFunction = questionType === "function";
  const isPractice = mode === "practice";
  const isExam = mode === "exam";

  const wave1Fn = isExam
    ? `NAMING["Naming & signature"]
      TITLES["Titles"]
      DIFF["Difficulty"]
      DESC --> NAMING & TITLES & DIFF`
    : `NAMING["Naming & signature"]
      TITLES["Titles"]
      DIFF["Difficulty"]
      TOPICS["Topics"]
      DESC --> NAMING & TITLES & DIFF & TOPICS`;

  const wave1NonFn = isExam
    ? `TITLES["Titles"]
      DIFF["Difficulty"]
      DESC --> TITLES & DIFF`
    : `TITLES["Titles"]
      DIFF["Difficulty"]
      TOPICS["Topics"]
      DESC --> TITLES & DIFF & TOPICS`;

  const wave1Block = isFunction ? wave1Fn : wave1NonFn;

  const wave2Prereq = isFunction ? "NAMING" : "DESC";
  const wave2Block = `CPP["Translate C++"]
      JAVA["Translate Java"]
      NODEJS["Translate Node.js"]
      BF["Brute Force"]
      ${wave2Prereq} --> CPP & JAVA & NODEJS & BF`;

  const gqComplete = isFunction
    ? "NAMING & TITLES & DIFF" + (isExam ? "" : " & TOPICS") + " & CPP & JAVA & NODEJS & BF --> GQ_GATE"
    : "TITLES & DIFF" + (isExam ? "" : " & TOPICS") + " & CPP & JAVA & NODEJS & BF --> GQ_GATE";

  const afterHarden = isFunction
    ? `HARDEN --> SPLIT["Split Code<br/>parallel per language"]
      SPLIT --> EXEC["Execute Tests · Function<br/>parallel per language"]`
    : `HARDEN --> EXEC["Execute Tests · Non-function<br/>parallel per language"]`;

  const enrichBlock = isPractice
    ? `
      ENRICH["Generate Enrichment<br/>Real-life · Hints · Follow-ups"]
      GQ_GATE -.->|"may start early"| ENRICH`
    : "";

  const afterExec = isPractice
    ? `EXEC --> ENRICH --> PKG["Package for Platform<br/>requires title in config"]`
    : `EXEC --> PKG["Package for Platform<br/>requires title in config"]`;

  const examNotes = isExam
    ? `
      EXAM_NOTE["Exam notes:<br/>no Topics · no Enrichment<br/>no debuggers in Split · empty solutions"]`
    : "";

  return `flowchart TB
    START(["START"])
    END(["END"])

    STRUCT["Structure: ${structure.label}<br/>${structure.note}"]
    GQ_GATE{{"UNLOCK<br/>Generate Question complete"}}

    START --> STRUCT --> DESC["Description"]

    subgraph GQ["① GENERATE QUESTION"]
      direction TB
      ${wave1Block}
      ${wave2Block}
      ${gqComplete}
    end

    subgraph MAIN["② TEST & PACKAGE"]
      direction TB
      TC["Generate Test Cases"]
      WRONG["Wrong Solutions"]
      BENCH["Benchmark Tests"]
      HARDEN["Strengthen Tests"]

      GQ_GATE --> TC --> WRONG --> BENCH --> HARDEN
      ${afterHarden}
      ${enrichBlock}
      ${afterExec}
    end

    subgraph FINISH["③ PUBLISH"]
      direction TB
      ED["Generate Editorial<br/><i>Editorial tab</i>"]
      JSON["Prepare Platform JSON"]
      EXEC_ED["Execute Editorial Solutions<br/><i>Editorial tab</i>"]

      PKG --> ED & JSON
      ED --> EXEC_ED
    end
    ${examNotes ? examNotes + "\n    PKG -.-> EXAM_NOTE" : ""}

    JSON --> END
    EXEC_ED --> END

    classDef startEnd fill:#2563eb,stroke:#1d4ed8,color:#fff
    classDef note fill:#92400e,stroke:#f59e0b,color:#fff
    classDef step fill:#334155,stroke:#94a3b8,color:#f8fafc
    classDef gate fill:#047857,stroke:#34d399,color:#ecfdf5
    classDef parallel fill:#1e3a5f,stroke:#60a5fa,color:#e0f2fe

    class START,END startEnd
    class STRUCT note
    ${isExam ? "class EXAM_NOTE note" : ""}
    class DESC,NAMING,TITLES,DIFF,TOPICS,CPP,JAVA,NODEJS,BF,TC,WRONG,BENCH,HARDEN,ENRICH,PKG,ED,JSON,EXEC_ED step
    class SPLIT,EXEC parallel
    class GQ_GATE gate
`;
}

function parseMeta(base) {
  const mode = base.endsWith("-practice") ? "practice" : "exam";
  const rest = base.replace(/-(practice|exam)$/, "");
  const questionType = rest.endsWith("-nonfunction") ? "nonfunction" : "function";
  const structureKey = rest.replace(/-(function|nonfunction)$/, "");
  const structure = STRUCTURES[structureKey];
  const qLabel = questionType === "function" ? "Function-based" : "Non-function-based";
  const mLabel = mode === "practice" ? "Practice" : "Exam";
  return {
    base,
    structureKey,
    structure,
    questionType,
    mode,
    title: `${structure.label} · ${qLabel} · ${mLabel}`,
    groupTitle: `${qLabel} · ${mLabel}`,
  };
}

const GROUP_ORDER = [
  { questionType: "function", mode: "practice", title: "Function-based · Practice" },
  { questionType: "function", mode: "exam", title: "Function-based · Exam" },
  { questionType: "nonfunction", mode: "practice", title: "Non-function-based · Practice" },
  { questionType: "nonfunction", mode: "exam", title: "Non-function-based · Exam" },
];

const STRUCTURE_ORDER = ["standard", "linked-list", "binary-tree"];

function sortFlows(a, b) {
  const ga = GROUP_ORDER.findIndex(
    (g) => g.questionType === a.questionType && g.mode === a.mode
  );
  const gb = GROUP_ORDER.findIndex(
    (g) => g.questionType === b.questionType && g.mode === b.mode
  );
  if (ga !== gb) return ga - gb;
  return STRUCTURE_ORDER.indexOf(a.structureKey) - STRUCTURE_ORDER.indexOf(b.structureKey);
}

function mmdToMd(title, body) {
  return `# ${title}

Open **Markdown Preview** (\`Cmd+Shift+V\` / \`Ctrl+Shift+V\`) to view the flow diagram.

\`\`\`mermaid
${body.trim()}
\`\`\`
`;
}

const all = [];
for (const structureKey of Object.keys(STRUCTURES)) {
  for (const questionType of ["function", "nonfunction"]) {
    for (const mode of ["practice", "exam"]) {
      const base = `${structureKey}-${questionType}-${mode}`;
      const meta = parseMeta(base);
      const body = buildDiagram(meta);
      all.push({ ...meta, body });
      writeFileSync(join(dir, `${base}.mmd`), `%% ${meta.title}\n${body}`);
      writeFileSync(join(dir, `${base}.md`), mmdToMd(meta.title, body));
    }
  }
}

all.sort(sortFlows);

const tocLines = [];
for (const group of GROUP_ORDER) {
  tocLines.push(`### ${group.title}`, ``);
  for (const f of all.filter(
    (flow) => flow.questionType === group.questionType && flow.mode === group.mode
  )) {
    tocLines.push(`- [${f.structure.label}](#${f.base})`);
  }
  tocLines.push(``);
}

const index = [
  `# Pipeline flow diagrams`,
  ``,
  `Top-to-bottom flow diagrams matching the **Clear Picture** pipeline (wave graph + per-language Split/Execute).`,
  ``,
  `Open Markdown Preview in Cursor to render:`,
  ``,
  `- Mac: \`Cmd+Shift+V\` · Windows/Linux: \`Ctrl+Shift+V\``,
  ``,
  `Regenerate: \`node docs/pipeline-flows/build-flows.mjs\``,
  ``,
  `## How to read`,
  ``,
  `| Shape | Meaning |`,
  `|-------|---------|`,
  `| Rounded \`START\` / \`END\` | Entry and exit |`,
  `| Rectangles | Pipeline steps |`,
  `| Blue rectangles | Split / Execute — one parallel run per enabled language |`,
  `| Green diamond | Gate — Generate Question (all waves + Brute Force) must finish |`,
  `| Dashed arrow | Optional early start (Enrichment after GQ in practice) |`,
  `| \`A & B & C\` branches | Parallel steps within a wave |`,
  ``,
  `## Pipeline configuration (global)`,
  ``,
  `| Control | Effect |`,
  `|---------|--------|`,
  `| **Languages** | Filters translate, split, execute, LUA, and JSON to selected langs only |`,
  `| **Title (short text)** | Required before Package / JSON; overwrites \`Outputs/generated_titles.txt\` on Save |`,
  `| **Generate title with AI** | When enabled, Titles sub-step runs LLM; otherwise manual title is used (shown as *skipped*) |`,
  `| **Test case count** | Passed to testcase generation |`,
  `| **Default tag names** | One tag per line; used in platform JSON when set |`,
  ``,
  `Sub-steps (naming, difficulty, topics, translations) are **derived** from question type + mode + languages — not toggled individually in config.`,
  ``,
  `## Generate Question waves`,
  ``,
  `| Variant | Wave 1 (after Description) | Wave 2 |`,
  `|---------|---------------------------|--------|`,
  `| Function | Naming, Titles, Difficulty, Topics (practice) | Translate enabled langs + Brute Force (after Naming) |`,
  `| Non-function | Titles, Difficulty, Topics (practice) | Translate enabled langs + Brute Force (after Description) |`,
  `| Exam (both) | No Topics sub-step | Same wave 2 layout |`,
  ``,
  `Brute Force is embedded in the GQ graph (wave 2), not a separate linear step in Run all.`,
  ``,
  `## All flows`,
  ``,
  `Grouped by question type and mode; each group has all three structure types (Standard, Linked List, Binary Tree).`,
  ``,
  ...tocLines,
  `---`,
  ``,
  ...GROUP_ORDER.flatMap((group) => {
    const flows = all.filter(
      (f) => f.questionType === group.questionType && f.mode === group.mode
    );
    return [
      `## ${group.title}`,
      ``,
      ...flows.flatMap((f) => [
        `### ${f.structure.label}`,
        `<a id="${f.base}"></a>`,
        ``,
        `\`\`\`mermaid`,
        f.body.trim(),
        `\`\`\``,
        ``,
      ]),
      `---`,
      ``,
    ];
  }),
];

writeFileSync(join(dir, "index.md"), index.join("\n"));
console.log(`Generated ${all.length} flow diagrams`);
