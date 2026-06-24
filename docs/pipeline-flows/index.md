# Pipeline flow diagrams

Top-to-bottom flow diagrams matching the **Clear Picture** pipeline (wave graph + per-language Split/Execute).

Open Markdown Preview in Cursor to render:

- Mac: `Cmd+Shift+V` · Windows/Linux: `Ctrl+Shift+V`

Regenerate: `node docs/pipeline-flows/build-flows.mjs`

## How to read

| Shape | Meaning |
|-------|---------|
| Rounded `START` / `END` | Entry and exit |
| Rectangles | Pipeline steps |
| Blue rectangles | Split / Execute — one parallel run per enabled language |
| Green diamond | Gate — Generate Question (all waves + Brute Force) must finish |
| Dashed arrow | Optional early start (Enrichment after GQ in practice) |
| `A & B & C` branches | Parallel steps within a wave |

## Pipeline configuration (global)

| Control | Effect |
|---------|--------|
| **Languages** | Filters translate, split, execute, LUA, and JSON to selected langs only |
| **Title (short text)** | Required before Package / JSON; overwrites `Outputs/generated_titles.txt` on Save |
| **Generate title with AI** | When enabled, Titles sub-step runs LLM; otherwise manual title is used (shown as *skipped*) |
| **Test case count** | Passed to testcase generation |
| **Default tag names** | One tag per line; used in platform JSON when set |

Sub-steps (naming, difficulty, topics, translations) are **derived** from question type + mode + languages — not toggled individually in config.

## Generate Question waves

| Variant | Wave 1 (after Description) | Wave 2 |
|---------|---------------------------|--------|
| Function | Naming, Titles, Difficulty, Topics (practice) | Translate enabled langs + Brute Force (after Naming) |
| Non-function | Titles, Difficulty, Topics (practice) | Translate enabled langs + Brute Force (after Description) |
| Exam (both) | No Topics sub-step | Same wave 2 layout |

Brute Force is embedded in the GQ graph (wave 2), not a separate linear step in Run all.

## All flows

Grouped by question type and mode; each group has all three structure types (Standard, Linked List, Binary Tree).

### Function-based · Practice

- [Standard](#standard-function-practice)
- [Linked List](#linked-list-function-practice)
- [Binary Tree](#binary-tree-function-practice)

### Function-based · Exam

- [Standard](#standard-function-exam)
- [Linked List](#linked-list-function-exam)
- [Binary Tree](#binary-tree-function-exam)

### Non-function-based · Practice

- [Standard](#standard-nonfunction-practice)
- [Linked List](#linked-list-nonfunction-practice)
- [Binary Tree](#binary-tree-nonfunction-practice)

### Non-function-based · Exam

- [Standard](#standard-nonfunction-exam)
- [Linked List](#linked-list-nonfunction-exam)
- [Binary Tree](#binary-tree-nonfunction-exam)

---

## Function-based · Practice

### Standard
<a id="standard-function-practice"></a>

```mermaid
flowchart TB
    START(["START"])
    END(["END"])

    STRUCT["Structure: Standard<br/>Standard I/O · no Node helper class"]
    GQ_GATE{{"UNLOCK<br/>Generate Question complete"}}

    START --> STRUCT --> DESC["Description"]

    subgraph GQ["① GENERATE QUESTION"]
      direction TB
      NAMING["Naming & signature"]
      TITLES["Titles"]
      DIFF["Difficulty"]
      TOPICS["Topics"]
      DESC --> NAMING & TITLES & DIFF & TOPICS
      CPP["Translate C++"]
      JAVA["Translate Java"]
      NODEJS["Translate Node.js"]
      BF["Brute Force"]
      NAMING --> CPP & JAVA & NODEJS & BF
      NAMING & TITLES & DIFF & TOPICS & CPP & JAVA & NODEJS & BF --> GQ_GATE
    end

    subgraph MAIN["② TEST & PACKAGE"]
      direction TB
      TC["Generate Test Cases"]
      WRONG["Wrong Solutions"]
      BENCH["Benchmark Tests"]
      HARDEN["Strengthen Tests"]

      GQ_GATE --> TC --> WRONG --> BENCH --> HARDEN
      HARDEN --> SPLIT["Split Code<br/>parallel per language"]
      SPLIT --> EXEC["Execute Tests · Function<br/>parallel per language"]
      
      ENRICH["Generate Enrichment<br/>Real-life · Hints · Follow-ups"]
      GQ_GATE -.->|"may start early"| ENRICH
      EXEC --> ENRICH --> PKG["Package for Platform<br/>requires title in config"]
    end

    subgraph FINISH["③ PUBLISH"]
      direction TB
      ED["Generate Editorial<br/><i>Editorial tab</i>"]
      JSON["Prepare Platform JSON"]
      EXEC_ED["Execute Editorial Solutions<br/><i>Editorial tab</i>"]

      PKG --> ED & JSON
      ED --> EXEC_ED
    end
    

    JSON --> END
    EXEC_ED --> END

    classDef startEnd fill:#2563eb,stroke:#1d4ed8,color:#fff
    classDef note fill:#92400e,stroke:#f59e0b,color:#fff
    classDef step fill:#334155,stroke:#94a3b8,color:#f8fafc
    classDef gate fill:#047857,stroke:#34d399,color:#ecfdf5
    classDef parallel fill:#1e3a5f,stroke:#60a5fa,color:#e0f2fe

    class START,END startEnd
    class STRUCT note
    
    class DESC,NAMING,TITLES,DIFF,TOPICS,CPP,JAVA,NODEJS,BF,TC,WRONG,BENCH,HARDEN,ENRICH,PKG,ED,JSON,EXEC_ED step
    class SPLIT,EXEC parallel
    class GQ_GATE gate
```

### Linked List
<a id="linked-list-function-practice"></a>

```mermaid
flowchart TB
    START(["START"])
    END(["END"])

    STRUCT["Structure: Linked List<br/>ListNode in description, split & LUA"]
    GQ_GATE{{"UNLOCK<br/>Generate Question complete"}}

    START --> STRUCT --> DESC["Description"]

    subgraph GQ["① GENERATE QUESTION"]
      direction TB
      NAMING["Naming & signature"]
      TITLES["Titles"]
      DIFF["Difficulty"]
      TOPICS["Topics"]
      DESC --> NAMING & TITLES & DIFF & TOPICS
      CPP["Translate C++"]
      JAVA["Translate Java"]
      NODEJS["Translate Node.js"]
      BF["Brute Force"]
      NAMING --> CPP & JAVA & NODEJS & BF
      NAMING & TITLES & DIFF & TOPICS & CPP & JAVA & NODEJS & BF --> GQ_GATE
    end

    subgraph MAIN["② TEST & PACKAGE"]
      direction TB
      TC["Generate Test Cases"]
      WRONG["Wrong Solutions"]
      BENCH["Benchmark Tests"]
      HARDEN["Strengthen Tests"]

      GQ_GATE --> TC --> WRONG --> BENCH --> HARDEN
      HARDEN --> SPLIT["Split Code<br/>parallel per language"]
      SPLIT --> EXEC["Execute Tests · Function<br/>parallel per language"]
      
      ENRICH["Generate Enrichment<br/>Real-life · Hints · Follow-ups"]
      GQ_GATE -.->|"may start early"| ENRICH
      EXEC --> ENRICH --> PKG["Package for Platform<br/>requires title in config"]
    end

    subgraph FINISH["③ PUBLISH"]
      direction TB
      ED["Generate Editorial<br/><i>Editorial tab</i>"]
      JSON["Prepare Platform JSON"]
      EXEC_ED["Execute Editorial Solutions<br/><i>Editorial tab</i>"]

      PKG --> ED & JSON
      ED --> EXEC_ED
    end
    

    JSON --> END
    EXEC_ED --> END

    classDef startEnd fill:#2563eb,stroke:#1d4ed8,color:#fff
    classDef note fill:#92400e,stroke:#f59e0b,color:#fff
    classDef step fill:#334155,stroke:#94a3b8,color:#f8fafc
    classDef gate fill:#047857,stroke:#34d399,color:#ecfdf5
    classDef parallel fill:#1e3a5f,stroke:#60a5fa,color:#e0f2fe

    class START,END startEnd
    class STRUCT note
    
    class DESC,NAMING,TITLES,DIFF,TOPICS,CPP,JAVA,NODEJS,BF,TC,WRONG,BENCH,HARDEN,ENRICH,PKG,ED,JSON,EXEC_ED step
    class SPLIT,EXEC parallel
    class GQ_GATE gate
```

### Binary Tree
<a id="binary-tree-function-practice"></a>

```mermaid
flowchart TB
    START(["START"])
    END(["END"])

    STRUCT["Structure: Binary Tree<br/>TreeNode in description, split & LUA"]
    GQ_GATE{{"UNLOCK<br/>Generate Question complete"}}

    START --> STRUCT --> DESC["Description"]

    subgraph GQ["① GENERATE QUESTION"]
      direction TB
      NAMING["Naming & signature"]
      TITLES["Titles"]
      DIFF["Difficulty"]
      TOPICS["Topics"]
      DESC --> NAMING & TITLES & DIFF & TOPICS
      CPP["Translate C++"]
      JAVA["Translate Java"]
      NODEJS["Translate Node.js"]
      BF["Brute Force"]
      NAMING --> CPP & JAVA & NODEJS & BF
      NAMING & TITLES & DIFF & TOPICS & CPP & JAVA & NODEJS & BF --> GQ_GATE
    end

    subgraph MAIN["② TEST & PACKAGE"]
      direction TB
      TC["Generate Test Cases"]
      WRONG["Wrong Solutions"]
      BENCH["Benchmark Tests"]
      HARDEN["Strengthen Tests"]

      GQ_GATE --> TC --> WRONG --> BENCH --> HARDEN
      HARDEN --> SPLIT["Split Code<br/>parallel per language"]
      SPLIT --> EXEC["Execute Tests · Function<br/>parallel per language"]
      
      ENRICH["Generate Enrichment<br/>Real-life · Hints · Follow-ups"]
      GQ_GATE -.->|"may start early"| ENRICH
      EXEC --> ENRICH --> PKG["Package for Platform<br/>requires title in config"]
    end

    subgraph FINISH["③ PUBLISH"]
      direction TB
      ED["Generate Editorial<br/><i>Editorial tab</i>"]
      JSON["Prepare Platform JSON"]
      EXEC_ED["Execute Editorial Solutions<br/><i>Editorial tab</i>"]

      PKG --> ED & JSON
      ED --> EXEC_ED
    end
    

    JSON --> END
    EXEC_ED --> END

    classDef startEnd fill:#2563eb,stroke:#1d4ed8,color:#fff
    classDef note fill:#92400e,stroke:#f59e0b,color:#fff
    classDef step fill:#334155,stroke:#94a3b8,color:#f8fafc
    classDef gate fill:#047857,stroke:#34d399,color:#ecfdf5
    classDef parallel fill:#1e3a5f,stroke:#60a5fa,color:#e0f2fe

    class START,END startEnd
    class STRUCT note
    
    class DESC,NAMING,TITLES,DIFF,TOPICS,CPP,JAVA,NODEJS,BF,TC,WRONG,BENCH,HARDEN,ENRICH,PKG,ED,JSON,EXEC_ED step
    class SPLIT,EXEC parallel
    class GQ_GATE gate
```

---

## Function-based · Exam

### Standard
<a id="standard-function-exam"></a>

```mermaid
flowchart TB
    START(["START"])
    END(["END"])

    STRUCT["Structure: Standard<br/>Standard I/O · no Node helper class"]
    GQ_GATE{{"UNLOCK<br/>Generate Question complete"}}

    START --> STRUCT --> DESC["Description"]

    subgraph GQ["① GENERATE QUESTION"]
      direction TB
      NAMING["Naming & signature"]
      TITLES["Titles"]
      DIFF["Difficulty"]
      DESC --> NAMING & TITLES & DIFF
      CPP["Translate C++"]
      JAVA["Translate Java"]
      NODEJS["Translate Node.js"]
      BF["Brute Force"]
      NAMING --> CPP & JAVA & NODEJS & BF
      NAMING & TITLES & DIFF & CPP & JAVA & NODEJS & BF --> GQ_GATE
    end

    subgraph MAIN["② TEST & PACKAGE"]
      direction TB
      TC["Generate Test Cases"]
      WRONG["Wrong Solutions"]
      BENCH["Benchmark Tests"]
      HARDEN["Strengthen Tests"]

      GQ_GATE --> TC --> WRONG --> BENCH --> HARDEN
      HARDEN --> SPLIT["Split Code<br/>parallel per language"]
      SPLIT --> EXEC["Execute Tests · Function<br/>parallel per language"]
      
      EXEC --> PKG["Package for Platform<br/>requires title in config"]
    end

    subgraph FINISH["③ PUBLISH"]
      direction TB
      ED["Generate Editorial<br/><i>Editorial tab</i>"]
      JSON["Prepare Platform JSON"]
      EXEC_ED["Execute Editorial Solutions<br/><i>Editorial tab</i>"]

      PKG --> ED & JSON
      ED --> EXEC_ED
    end
    
      EXAM_NOTE["Exam notes:<br/>no Topics · no Enrichment<br/>no debuggers in Split · empty solutions"]
    PKG -.-> EXAM_NOTE

    JSON --> END
    EXEC_ED --> END

    classDef startEnd fill:#2563eb,stroke:#1d4ed8,color:#fff
    classDef note fill:#92400e,stroke:#f59e0b,color:#fff
    classDef step fill:#334155,stroke:#94a3b8,color:#f8fafc
    classDef gate fill:#047857,stroke:#34d399,color:#ecfdf5
    classDef parallel fill:#1e3a5f,stroke:#60a5fa,color:#e0f2fe

    class START,END startEnd
    class STRUCT note
    class EXAM_NOTE note
    class DESC,NAMING,TITLES,DIFF,TOPICS,CPP,JAVA,NODEJS,BF,TC,WRONG,BENCH,HARDEN,ENRICH,PKG,ED,JSON,EXEC_ED step
    class SPLIT,EXEC parallel
    class GQ_GATE gate
```

### Linked List
<a id="linked-list-function-exam"></a>

```mermaid
flowchart TB
    START(["START"])
    END(["END"])

    STRUCT["Structure: Linked List<br/>ListNode in description, split & LUA"]
    GQ_GATE{{"UNLOCK<br/>Generate Question complete"}}

    START --> STRUCT --> DESC["Description"]

    subgraph GQ["① GENERATE QUESTION"]
      direction TB
      NAMING["Naming & signature"]
      TITLES["Titles"]
      DIFF["Difficulty"]
      DESC --> NAMING & TITLES & DIFF
      CPP["Translate C++"]
      JAVA["Translate Java"]
      NODEJS["Translate Node.js"]
      BF["Brute Force"]
      NAMING --> CPP & JAVA & NODEJS & BF
      NAMING & TITLES & DIFF & CPP & JAVA & NODEJS & BF --> GQ_GATE
    end

    subgraph MAIN["② TEST & PACKAGE"]
      direction TB
      TC["Generate Test Cases"]
      WRONG["Wrong Solutions"]
      BENCH["Benchmark Tests"]
      HARDEN["Strengthen Tests"]

      GQ_GATE --> TC --> WRONG --> BENCH --> HARDEN
      HARDEN --> SPLIT["Split Code<br/>parallel per language"]
      SPLIT --> EXEC["Execute Tests · Function<br/>parallel per language"]
      
      EXEC --> PKG["Package for Platform<br/>requires title in config"]
    end

    subgraph FINISH["③ PUBLISH"]
      direction TB
      ED["Generate Editorial<br/><i>Editorial tab</i>"]
      JSON["Prepare Platform JSON"]
      EXEC_ED["Execute Editorial Solutions<br/><i>Editorial tab</i>"]

      PKG --> ED & JSON
      ED --> EXEC_ED
    end
    
      EXAM_NOTE["Exam notes:<br/>no Topics · no Enrichment<br/>no debuggers in Split · empty solutions"]
    PKG -.-> EXAM_NOTE

    JSON --> END
    EXEC_ED --> END

    classDef startEnd fill:#2563eb,stroke:#1d4ed8,color:#fff
    classDef note fill:#92400e,stroke:#f59e0b,color:#fff
    classDef step fill:#334155,stroke:#94a3b8,color:#f8fafc
    classDef gate fill:#047857,stroke:#34d399,color:#ecfdf5
    classDef parallel fill:#1e3a5f,stroke:#60a5fa,color:#e0f2fe

    class START,END startEnd
    class STRUCT note
    class EXAM_NOTE note
    class DESC,NAMING,TITLES,DIFF,TOPICS,CPP,JAVA,NODEJS,BF,TC,WRONG,BENCH,HARDEN,ENRICH,PKG,ED,JSON,EXEC_ED step
    class SPLIT,EXEC parallel
    class GQ_GATE gate
```

### Binary Tree
<a id="binary-tree-function-exam"></a>

```mermaid
flowchart TB
    START(["START"])
    END(["END"])

    STRUCT["Structure: Binary Tree<br/>TreeNode in description, split & LUA"]
    GQ_GATE{{"UNLOCK<br/>Generate Question complete"}}

    START --> STRUCT --> DESC["Description"]

    subgraph GQ["① GENERATE QUESTION"]
      direction TB
      NAMING["Naming & signature"]
      TITLES["Titles"]
      DIFF["Difficulty"]
      DESC --> NAMING & TITLES & DIFF
      CPP["Translate C++"]
      JAVA["Translate Java"]
      NODEJS["Translate Node.js"]
      BF["Brute Force"]
      NAMING --> CPP & JAVA & NODEJS & BF
      NAMING & TITLES & DIFF & CPP & JAVA & NODEJS & BF --> GQ_GATE
    end

    subgraph MAIN["② TEST & PACKAGE"]
      direction TB
      TC["Generate Test Cases"]
      WRONG["Wrong Solutions"]
      BENCH["Benchmark Tests"]
      HARDEN["Strengthen Tests"]

      GQ_GATE --> TC --> WRONG --> BENCH --> HARDEN
      HARDEN --> SPLIT["Split Code<br/>parallel per language"]
      SPLIT --> EXEC["Execute Tests · Function<br/>parallel per language"]
      
      EXEC --> PKG["Package for Platform<br/>requires title in config"]
    end

    subgraph FINISH["③ PUBLISH"]
      direction TB
      ED["Generate Editorial<br/><i>Editorial tab</i>"]
      JSON["Prepare Platform JSON"]
      EXEC_ED["Execute Editorial Solutions<br/><i>Editorial tab</i>"]

      PKG --> ED & JSON
      ED --> EXEC_ED
    end
    
      EXAM_NOTE["Exam notes:<br/>no Topics · no Enrichment<br/>no debuggers in Split · empty solutions"]
    PKG -.-> EXAM_NOTE

    JSON --> END
    EXEC_ED --> END

    classDef startEnd fill:#2563eb,stroke:#1d4ed8,color:#fff
    classDef note fill:#92400e,stroke:#f59e0b,color:#fff
    classDef step fill:#334155,stroke:#94a3b8,color:#f8fafc
    classDef gate fill:#047857,stroke:#34d399,color:#ecfdf5
    classDef parallel fill:#1e3a5f,stroke:#60a5fa,color:#e0f2fe

    class START,END startEnd
    class STRUCT note
    class EXAM_NOTE note
    class DESC,NAMING,TITLES,DIFF,TOPICS,CPP,JAVA,NODEJS,BF,TC,WRONG,BENCH,HARDEN,ENRICH,PKG,ED,JSON,EXEC_ED step
    class SPLIT,EXEC parallel
    class GQ_GATE gate
```

---

## Non-function-based · Practice

### Standard
<a id="standard-nonfunction-practice"></a>

```mermaid
flowchart TB
    START(["START"])
    END(["END"])

    STRUCT["Structure: Standard<br/>Standard I/O · no Node helper class"]
    GQ_GATE{{"UNLOCK<br/>Generate Question complete"}}

    START --> STRUCT --> DESC["Description"]

    subgraph GQ["① GENERATE QUESTION"]
      direction TB
      TITLES["Titles"]
      DIFF["Difficulty"]
      TOPICS["Topics"]
      DESC --> TITLES & DIFF & TOPICS
      CPP["Translate C++"]
      JAVA["Translate Java"]
      NODEJS["Translate Node.js"]
      BF["Brute Force"]
      DESC --> CPP & JAVA & NODEJS & BF
      TITLES & DIFF & TOPICS & CPP & JAVA & NODEJS & BF --> GQ_GATE
    end

    subgraph MAIN["② TEST & PACKAGE"]
      direction TB
      TC["Generate Test Cases"]
      WRONG["Wrong Solutions"]
      BENCH["Benchmark Tests"]
      HARDEN["Strengthen Tests"]

      GQ_GATE --> TC --> WRONG --> BENCH --> HARDEN
      HARDEN --> EXEC["Execute Tests · Non-function<br/>parallel per language"]
      
      ENRICH["Generate Enrichment<br/>Real-life · Hints · Follow-ups"]
      GQ_GATE -.->|"may start early"| ENRICH
      EXEC --> ENRICH --> PKG["Package for Platform<br/>requires title in config"]
    end

    subgraph FINISH["③ PUBLISH"]
      direction TB
      ED["Generate Editorial<br/><i>Editorial tab</i>"]
      JSON["Prepare Platform JSON"]
      EXEC_ED["Execute Editorial Solutions<br/><i>Editorial tab</i>"]

      PKG --> ED & JSON
      ED --> EXEC_ED
    end
    

    JSON --> END
    EXEC_ED --> END

    classDef startEnd fill:#2563eb,stroke:#1d4ed8,color:#fff
    classDef note fill:#92400e,stroke:#f59e0b,color:#fff
    classDef step fill:#334155,stroke:#94a3b8,color:#f8fafc
    classDef gate fill:#047857,stroke:#34d399,color:#ecfdf5
    classDef parallel fill:#1e3a5f,stroke:#60a5fa,color:#e0f2fe

    class START,END startEnd
    class STRUCT note
    
    class DESC,NAMING,TITLES,DIFF,TOPICS,CPP,JAVA,NODEJS,BF,TC,WRONG,BENCH,HARDEN,ENRICH,PKG,ED,JSON,EXEC_ED step
    class SPLIT,EXEC parallel
    class GQ_GATE gate
```

### Linked List
<a id="linked-list-nonfunction-practice"></a>

```mermaid
flowchart TB
    START(["START"])
    END(["END"])

    STRUCT["Structure: Linked List<br/>ListNode in description, split & LUA"]
    GQ_GATE{{"UNLOCK<br/>Generate Question complete"}}

    START --> STRUCT --> DESC["Description"]

    subgraph GQ["① GENERATE QUESTION"]
      direction TB
      TITLES["Titles"]
      DIFF["Difficulty"]
      TOPICS["Topics"]
      DESC --> TITLES & DIFF & TOPICS
      CPP["Translate C++"]
      JAVA["Translate Java"]
      NODEJS["Translate Node.js"]
      BF["Brute Force"]
      DESC --> CPP & JAVA & NODEJS & BF
      TITLES & DIFF & TOPICS & CPP & JAVA & NODEJS & BF --> GQ_GATE
    end

    subgraph MAIN["② TEST & PACKAGE"]
      direction TB
      TC["Generate Test Cases"]
      WRONG["Wrong Solutions"]
      BENCH["Benchmark Tests"]
      HARDEN["Strengthen Tests"]

      GQ_GATE --> TC --> WRONG --> BENCH --> HARDEN
      HARDEN --> EXEC["Execute Tests · Non-function<br/>parallel per language"]
      
      ENRICH["Generate Enrichment<br/>Real-life · Hints · Follow-ups"]
      GQ_GATE -.->|"may start early"| ENRICH
      EXEC --> ENRICH --> PKG["Package for Platform<br/>requires title in config"]
    end

    subgraph FINISH["③ PUBLISH"]
      direction TB
      ED["Generate Editorial<br/><i>Editorial tab</i>"]
      JSON["Prepare Platform JSON"]
      EXEC_ED["Execute Editorial Solutions<br/><i>Editorial tab</i>"]

      PKG --> ED & JSON
      ED --> EXEC_ED
    end
    

    JSON --> END
    EXEC_ED --> END

    classDef startEnd fill:#2563eb,stroke:#1d4ed8,color:#fff
    classDef note fill:#92400e,stroke:#f59e0b,color:#fff
    classDef step fill:#334155,stroke:#94a3b8,color:#f8fafc
    classDef gate fill:#047857,stroke:#34d399,color:#ecfdf5
    classDef parallel fill:#1e3a5f,stroke:#60a5fa,color:#e0f2fe

    class START,END startEnd
    class STRUCT note
    
    class DESC,NAMING,TITLES,DIFF,TOPICS,CPP,JAVA,NODEJS,BF,TC,WRONG,BENCH,HARDEN,ENRICH,PKG,ED,JSON,EXEC_ED step
    class SPLIT,EXEC parallel
    class GQ_GATE gate
```

### Binary Tree
<a id="binary-tree-nonfunction-practice"></a>

```mermaid
flowchart TB
    START(["START"])
    END(["END"])

    STRUCT["Structure: Binary Tree<br/>TreeNode in description, split & LUA"]
    GQ_GATE{{"UNLOCK<br/>Generate Question complete"}}

    START --> STRUCT --> DESC["Description"]

    subgraph GQ["① GENERATE QUESTION"]
      direction TB
      TITLES["Titles"]
      DIFF["Difficulty"]
      TOPICS["Topics"]
      DESC --> TITLES & DIFF & TOPICS
      CPP["Translate C++"]
      JAVA["Translate Java"]
      NODEJS["Translate Node.js"]
      BF["Brute Force"]
      DESC --> CPP & JAVA & NODEJS & BF
      TITLES & DIFF & TOPICS & CPP & JAVA & NODEJS & BF --> GQ_GATE
    end

    subgraph MAIN["② TEST & PACKAGE"]
      direction TB
      TC["Generate Test Cases"]
      WRONG["Wrong Solutions"]
      BENCH["Benchmark Tests"]
      HARDEN["Strengthen Tests"]

      GQ_GATE --> TC --> WRONG --> BENCH --> HARDEN
      HARDEN --> EXEC["Execute Tests · Non-function<br/>parallel per language"]
      
      ENRICH["Generate Enrichment<br/>Real-life · Hints · Follow-ups"]
      GQ_GATE -.->|"may start early"| ENRICH
      EXEC --> ENRICH --> PKG["Package for Platform<br/>requires title in config"]
    end

    subgraph FINISH["③ PUBLISH"]
      direction TB
      ED["Generate Editorial<br/><i>Editorial tab</i>"]
      JSON["Prepare Platform JSON"]
      EXEC_ED["Execute Editorial Solutions<br/><i>Editorial tab</i>"]

      PKG --> ED & JSON
      ED --> EXEC_ED
    end
    

    JSON --> END
    EXEC_ED --> END

    classDef startEnd fill:#2563eb,stroke:#1d4ed8,color:#fff
    classDef note fill:#92400e,stroke:#f59e0b,color:#fff
    classDef step fill:#334155,stroke:#94a3b8,color:#f8fafc
    classDef gate fill:#047857,stroke:#34d399,color:#ecfdf5
    classDef parallel fill:#1e3a5f,stroke:#60a5fa,color:#e0f2fe

    class START,END startEnd
    class STRUCT note
    
    class DESC,NAMING,TITLES,DIFF,TOPICS,CPP,JAVA,NODEJS,BF,TC,WRONG,BENCH,HARDEN,ENRICH,PKG,ED,JSON,EXEC_ED step
    class SPLIT,EXEC parallel
    class GQ_GATE gate
```

---

## Non-function-based · Exam

### Standard
<a id="standard-nonfunction-exam"></a>

```mermaid
flowchart TB
    START(["START"])
    END(["END"])

    STRUCT["Structure: Standard<br/>Standard I/O · no Node helper class"]
    GQ_GATE{{"UNLOCK<br/>Generate Question complete"}}

    START --> STRUCT --> DESC["Description"]

    subgraph GQ["① GENERATE QUESTION"]
      direction TB
      TITLES["Titles"]
      DIFF["Difficulty"]
      DESC --> TITLES & DIFF
      CPP["Translate C++"]
      JAVA["Translate Java"]
      NODEJS["Translate Node.js"]
      BF["Brute Force"]
      DESC --> CPP & JAVA & NODEJS & BF
      TITLES & DIFF & CPP & JAVA & NODEJS & BF --> GQ_GATE
    end

    subgraph MAIN["② TEST & PACKAGE"]
      direction TB
      TC["Generate Test Cases"]
      WRONG["Wrong Solutions"]
      BENCH["Benchmark Tests"]
      HARDEN["Strengthen Tests"]

      GQ_GATE --> TC --> WRONG --> BENCH --> HARDEN
      HARDEN --> EXEC["Execute Tests · Non-function<br/>parallel per language"]
      
      EXEC --> PKG["Package for Platform<br/>requires title in config"]
    end

    subgraph FINISH["③ PUBLISH"]
      direction TB
      ED["Generate Editorial<br/><i>Editorial tab</i>"]
      JSON["Prepare Platform JSON"]
      EXEC_ED["Execute Editorial Solutions<br/><i>Editorial tab</i>"]

      PKG --> ED & JSON
      ED --> EXEC_ED
    end
    
      EXAM_NOTE["Exam notes:<br/>no Topics · no Enrichment<br/>no debuggers in Split · empty solutions"]
    PKG -.-> EXAM_NOTE

    JSON --> END
    EXEC_ED --> END

    classDef startEnd fill:#2563eb,stroke:#1d4ed8,color:#fff
    classDef note fill:#92400e,stroke:#f59e0b,color:#fff
    classDef step fill:#334155,stroke:#94a3b8,color:#f8fafc
    classDef gate fill:#047857,stroke:#34d399,color:#ecfdf5
    classDef parallel fill:#1e3a5f,stroke:#60a5fa,color:#e0f2fe

    class START,END startEnd
    class STRUCT note
    class EXAM_NOTE note
    class DESC,NAMING,TITLES,DIFF,TOPICS,CPP,JAVA,NODEJS,BF,TC,WRONG,BENCH,HARDEN,ENRICH,PKG,ED,JSON,EXEC_ED step
    class SPLIT,EXEC parallel
    class GQ_GATE gate
```

### Linked List
<a id="linked-list-nonfunction-exam"></a>

```mermaid
flowchart TB
    START(["START"])
    END(["END"])

    STRUCT["Structure: Linked List<br/>ListNode in description, split & LUA"]
    GQ_GATE{{"UNLOCK<br/>Generate Question complete"}}

    START --> STRUCT --> DESC["Description"]

    subgraph GQ["① GENERATE QUESTION"]
      direction TB
      TITLES["Titles"]
      DIFF["Difficulty"]
      DESC --> TITLES & DIFF
      CPP["Translate C++"]
      JAVA["Translate Java"]
      NODEJS["Translate Node.js"]
      BF["Brute Force"]
      DESC --> CPP & JAVA & NODEJS & BF
      TITLES & DIFF & CPP & JAVA & NODEJS & BF --> GQ_GATE
    end

    subgraph MAIN["② TEST & PACKAGE"]
      direction TB
      TC["Generate Test Cases"]
      WRONG["Wrong Solutions"]
      BENCH["Benchmark Tests"]
      HARDEN["Strengthen Tests"]

      GQ_GATE --> TC --> WRONG --> BENCH --> HARDEN
      HARDEN --> EXEC["Execute Tests · Non-function<br/>parallel per language"]
      
      EXEC --> PKG["Package for Platform<br/>requires title in config"]
    end

    subgraph FINISH["③ PUBLISH"]
      direction TB
      ED["Generate Editorial<br/><i>Editorial tab</i>"]
      JSON["Prepare Platform JSON"]
      EXEC_ED["Execute Editorial Solutions<br/><i>Editorial tab</i>"]

      PKG --> ED & JSON
      ED --> EXEC_ED
    end
    
      EXAM_NOTE["Exam notes:<br/>no Topics · no Enrichment<br/>no debuggers in Split · empty solutions"]
    PKG -.-> EXAM_NOTE

    JSON --> END
    EXEC_ED --> END

    classDef startEnd fill:#2563eb,stroke:#1d4ed8,color:#fff
    classDef note fill:#92400e,stroke:#f59e0b,color:#fff
    classDef step fill:#334155,stroke:#94a3b8,color:#f8fafc
    classDef gate fill:#047857,stroke:#34d399,color:#ecfdf5
    classDef parallel fill:#1e3a5f,stroke:#60a5fa,color:#e0f2fe

    class START,END startEnd
    class STRUCT note
    class EXAM_NOTE note
    class DESC,NAMING,TITLES,DIFF,TOPICS,CPP,JAVA,NODEJS,BF,TC,WRONG,BENCH,HARDEN,ENRICH,PKG,ED,JSON,EXEC_ED step
    class SPLIT,EXEC parallel
    class GQ_GATE gate
```

### Binary Tree
<a id="binary-tree-nonfunction-exam"></a>

```mermaid
flowchart TB
    START(["START"])
    END(["END"])

    STRUCT["Structure: Binary Tree<br/>TreeNode in description, split & LUA"]
    GQ_GATE{{"UNLOCK<br/>Generate Question complete"}}

    START --> STRUCT --> DESC["Description"]

    subgraph GQ["① GENERATE QUESTION"]
      direction TB
      TITLES["Titles"]
      DIFF["Difficulty"]
      DESC --> TITLES & DIFF
      CPP["Translate C++"]
      JAVA["Translate Java"]
      NODEJS["Translate Node.js"]
      BF["Brute Force"]
      DESC --> CPP & JAVA & NODEJS & BF
      TITLES & DIFF & CPP & JAVA & NODEJS & BF --> GQ_GATE
    end

    subgraph MAIN["② TEST & PACKAGE"]
      direction TB
      TC["Generate Test Cases"]
      WRONG["Wrong Solutions"]
      BENCH["Benchmark Tests"]
      HARDEN["Strengthen Tests"]

      GQ_GATE --> TC --> WRONG --> BENCH --> HARDEN
      HARDEN --> EXEC["Execute Tests · Non-function<br/>parallel per language"]
      
      EXEC --> PKG["Package for Platform<br/>requires title in config"]
    end

    subgraph FINISH["③ PUBLISH"]
      direction TB
      ED["Generate Editorial<br/><i>Editorial tab</i>"]
      JSON["Prepare Platform JSON"]
      EXEC_ED["Execute Editorial Solutions<br/><i>Editorial tab</i>"]

      PKG --> ED & JSON
      ED --> EXEC_ED
    end
    
      EXAM_NOTE["Exam notes:<br/>no Topics · no Enrichment<br/>no debuggers in Split · empty solutions"]
    PKG -.-> EXAM_NOTE

    JSON --> END
    EXEC_ED --> END

    classDef startEnd fill:#2563eb,stroke:#1d4ed8,color:#fff
    classDef note fill:#92400e,stroke:#f59e0b,color:#fff
    classDef step fill:#334155,stroke:#94a3b8,color:#f8fafc
    classDef gate fill:#047857,stroke:#34d399,color:#ecfdf5
    classDef parallel fill:#1e3a5f,stroke:#60a5fa,color:#e0f2fe

    class START,END startEnd
    class STRUCT note
    class EXAM_NOTE note
    class DESC,NAMING,TITLES,DIFF,TOPICS,CPP,JAVA,NODEJS,BF,TC,WRONG,BENCH,HARDEN,ENRICH,PKG,ED,JSON,EXEC_ED step
    class SPLIT,EXEC parallel
    class GQ_GATE gate
```

---
