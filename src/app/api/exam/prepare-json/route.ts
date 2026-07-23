import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth/server";
import {
  buildExamJsonFromQuestions,
  parseQuestionInput,
  type PlatformQuestion,
} from "@/lib/exam-json-scale";

type PrepareBody = {
  totalExamMarks?: number;
  questions?: Array<{ marks?: number; questionJson?: unknown; fileName?: string }>;
};

export async function POST(request: NextRequest) {
  const auth = await requireAuthApi();
  if (auth.error) return auth.error;

  let body: PrepareBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const totalExamMarks = Number(body.totalExamMarks);
  const questions = body.questions ?? [];

  if (!Number.isFinite(totalExamMarks) || totalExamMarks <= 0) {
    return NextResponse.json({ error: "totalExamMarks must be a positive number" }, { status: 400 });
  }
  if (questions.length === 0) {
    return NextResponse.json({ error: "At least one question is required" }, { status: 400 });
  }

  const items: Array<{ question: PlatformQuestion; marks: number; fileName: string }> = [];

  for (let i = 0; i < questions.length; i++) {
    const row = questions[i];
    const marks = Number(row.marks);
    if (!Number.isFinite(marks) || marks <= 0) {
      return NextResponse.json(
        { error: `Question ${i + 1}: marks must be a positive number` },
        { status: 400 },
      );
    }

    let question: PlatformQuestion;
    try {
      if (typeof row.questionJson === "string") {
        question = parseQuestionInput(row.questionJson);
      } else if (row.questionJson && typeof row.questionJson === "object") {
        question = parseQuestionInput(JSON.stringify(row.questionJson));
      } else {
        throw new Error("questionJson is required");
      }
    } catch (e) {
      return NextResponse.json(
        { error: `Question ${i + 1}: ${(e as Error).message}` },
        { status: 400 },
      );
    }

    items.push({
      question,
      marks: Math.round(marks * 100) / 100,
      fileName: row.fileName?.trim() || `question-${i + 1}.json`,
    });
  }

  try {
    const { examJson, meta } = buildExamJsonFromQuestions(items, totalExamMarks);
    return NextResponse.json({
      totalExamMarks,
      questionCount: examJson.length,
      meta,
      examJson,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
