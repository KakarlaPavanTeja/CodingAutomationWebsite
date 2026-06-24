import type { OutputFile } from "@/types/pipeline";

export type OutputGroupId =
  | "question"
  | "solutions"
  | "split-code"
  | "testcases"
  | "enrichment"
  | "platform"
  | "editorial"
  | "internal"
  | "other";

export interface OutputTreeNode {
  name: string;
  /** Real file path, folder path, or virtual `$group:<id>` for stage headers */
  path: string;
  isDirectory: boolean;
  isGroup?: boolean;
  description?: string;
  size: number;
  modifiedAt: string;
  children: OutputTreeNode[];
}

const GROUP_META: { id: OutputGroupId; label: string; description: string }[] = [
  {
    id: "question",
    label: "Question metadata",
    description: "Description, titles, difficulty, topics, signature",
  },
  {
    id: "solutions",
    label: "Full solutions",
    description: "Reference solutions per language + brute force",
  },
  {
    id: "split-code",
    label: "Split code",
    description: "Driver / solution / debugger files for execution",
  },
  {
    id: "testcases",
    label: "Test cases",
    description: "Generated cases, wrong solutions, benchmarks",
  },
  {
    id: "enrichment",
    label: "Enrichment",
    description: "Hints, follow-ups, real-life examples",
  },
  {
    id: "platform",
    label: "Platform package",
    description: "LUA + JSON ready for upload",
  },
  {
    id: "editorial",
    label: "Editorial",
    description: "Multi-solution write-up",
  },
  {
    id: "internal",
    label: "Usage & diagnostics",
    description: "LLM usage tracker and internal logs",
  },
  {
    id: "other",
    label: "Other",
    description: "Uncategorized output files",
  },
];

const QUESTION_ROOT_FILES = new Set([
  "generated_description.md",
  "generated_titles.txt",
  "generated_difficulty.txt",
  "generated_topics.json",
  "description_signature.json",
  "normalized_source.py",
  "Companies",
]);

export function outputGroupForPath(filePath: string): OutputGroupId {
  const name = filePath.split("/").pop() ?? filePath;

  if (filePath.startsWith("forJSONPreparation/")) return "platform";
  if (filePath.startsWith("generatedFullCode/")) return "solutions";
  if (filePath.startsWith("CodeContentFiles/")) return "split-code";
  if (
    filePath.startsWith("wrong_solutions/") ||
    filePath.startsWith("s3_blobs/") ||
    name === "testcases.json" ||
    name === "testcases_generator_script.py" ||
    name.startsWith("test_report") ||
    name.endsWith("_test_results.json")
  ) {
    return "testcases";
  }
  if (name === "enrichment.json") return "enrichment";
  if (name === "editorial.md") return "editorial";
  if (name === "usage_tracker.json") return "internal";
  if (QUESTION_ROOT_FILES.has(name) || QUESTION_ROOT_FILES.has(filePath)) return "question";

  return "other";
}

function buildTreeFromFiles(files: OutputFile[]): OutputTreeNode[] {
  const root: OutputTreeNode[] = [];
  const dirMap = new Map<string, OutputTreeNode>();

  for (const file of files) {
    if (file.isDirectory) continue;

    const parts = file.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join("/");
      if (dirMap.has(dirPath)) continue;
      const node: OutputTreeNode = {
        name: parts[i - 1],
        path: dirPath,
        isDirectory: true,
        size: 0,
        modifiedAt: "",
        children: [],
      };
      dirMap.set(dirPath, node);
      if (i === 1) root.push(node);
      else dirMap.get(parts.slice(0, i - 1).join("/"))?.children.push(node);
    }

    const fileNode: OutputTreeNode = {
      name: file.name,
      path: file.path,
      isDirectory: false,
      size: file.size,
      modifiedAt: file.modifiedAt,
      children: [],
    };

    if (parts.length === 1) {
      root.push(fileNode);
    } else {
      const parent = dirMap.get(parts.slice(0, -1).join("/"));
      if (parent) parent.children.push(fileNode);
      else root.push(fileNode);
    }
  }

  const sortNodes = (nodes: OutputTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children.length > 0) sortNodes(node.children);
    }
  };
  sortNodes(root);
  return root;
}

/** Group flat pipeline outputs into pipeline-stage folders for the UI. */
export function organizeOutputFiles(files: OutputFile[]): OutputTreeNode[] {
  const byGroup = new Map<OutputGroupId, OutputFile[]>();

  for (const file of files) {
    if (file.isDirectory) continue;
    const group = outputGroupForPath(file.path);
    const list = byGroup.get(group) ?? [];
    list.push(file);
    byGroup.set(group, list);
  }

  const tree: OutputTreeNode[] = [];

  for (const meta of GROUP_META) {
    const groupFiles = byGroup.get(meta.id);
    if (!groupFiles?.length) continue;

    tree.push({
      name: meta.label,
      path: `$group:${meta.id}`,
      isDirectory: true,
      isGroup: true,
      description: meta.description,
      size: 0,
      modifiedAt: "",
      children: buildTreeFromFiles(groupFiles),
    });
  }

  return tree;
}

export function isVirtualOutputGroupPath(path: string): boolean {
  return path.startsWith("$group:");
}

export function allExpandableOutputPaths(nodes: OutputTreeNode[]): string[] {
  const paths: string[] = [];
  const walk = (list: OutputTreeNode[]) => {
    for (const node of list) {
      if (node.isDirectory) {
        paths.push(node.path);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return paths;
}
