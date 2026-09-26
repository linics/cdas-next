import Link from "next/link";
import { BookOpenIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LocalizedDateTime } from "../../../_components/localized-date-time";
import type { ActivitySourceReferenceView } from "../../../../server/queries/activity-source-references";
import { withdrawSourceAction } from "./source-actions";

const originLabel = {
  AGENT_PROPOSAL: "AI 提案",
  TEACHER_SELECTION: "手工采纳",
} as const;

export function SourceReferences({
  draftId,
  currentVersion,
  references,
  editable,
}: {
  draftId: string;
  currentVersion: number;
  references: readonly ActivitySourceReferenceView[];
  editable: boolean;
}) {
  const active = references.filter((reference) => !reference.withdrawnAt);
  const withdrawn = references.filter((reference) => reference.withdrawnAt);

  return (
    <Card id="source-references">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpenIcon className="size-4" /> 课程依据
        </CardTitle>
        <CardDescription>
          {active.length > 0
            ? `已采纳 ${active.length} 条官方依据。`
            : "还没有记录依据。"}
        </CardDescription>
        {editable ? (
          <CardAction>
            <Button asChild size="sm" variant="outline">
              <Link href={`/teacher/knowledge?draft=${draftId}`}>从课程标准选取</Link>
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      {active.length > 0 || withdrawn.length > 0 ? (
        <CardContent className="grid gap-3">
          <ul className="grid gap-3">
            {active.map((reference) => (
              <li className="grid gap-1.5 rounded-xl border bg-background/60 p-3" key={reference.id}>
                <div className="flex flex-wrap items-center gap-2">
                  {reference.href && reference.corpusStatus === "MATCH" ? (
                    <Link
                      className="text-sm font-medium underline-offset-4 hover:underline"
                      href={reference.href}
                    >
                      {reference.citationLabel}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium">{reference.citationLabel}</span>
                  )}
                  <Badge variant="secondary">{originLabel[reference.origin]}</Badge>
                  <Badge variant="outline">采纳于第 {reference.adoptedAtVersion} 版</Badge>
                </div>
                <p className="type-body text-muted-foreground">{reference.rationale}</p>
                {reference.corpusStatus !== "MATCH" ? (
                  <p className="type-caption text-[var(--status-resubmit)]">
                    {reference.corpusStatus === "MISSING"
                      ? "语料中已没有这一章节，当时原文未留存。"
                      : "语料已更新，当前原文与采纳时不同，当时原文未留存。"}
                  </p>
                ) : null}
                {reference.adoptedAtVersion < currentVersion ? (
                  <p className="type-caption">
                    草稿此后已改到第 {currentVersion} 版，这条依据未随内容重新核对。
                  </p>
                ) : null}
                <div className="flex items-center justify-between gap-2">
                  <span className="type-caption">
                    <LocalizedDateTime dateTime={reference.adoptedAt} />
                  </span>
                  {editable ? (
                    <form action={withdrawSourceAction}>
                      <input name="draftId" type="hidden" value={draftId} />
                      <input name="referenceId" type="hidden" value={reference.id} />
                      <Button size="sm" type="submit" variant="ghost">
                        撤回
                      </Button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {withdrawn.length > 0 ? (
            <details className="type-caption">
              <summary className="cursor-pointer">已撤回 {withdrawn.length} 条</summary>
              <ul className="mt-2 grid gap-1">
                {withdrawn.map((reference) => (
                  <li key={reference.id}>
                    {reference.citationLabel}（{originLabel[reference.origin]}，第 {reference.adoptedAtVersion} 版）
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}
