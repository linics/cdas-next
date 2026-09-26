"use client";

import { useActionState, useState, useTransition } from "react";
import { SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { InlineAlert } from "../../../_components/ui";
import {
  adaptableAreaHints,
  adaptableTaskBookAreas,
  adaptationContextNoteMaxLength,
  type AdaptationChange,
} from "../../../../domain/activity/activity-adaptation";
import { taskBookAreaLabels } from "../../../../domain/activity/task-book-areas";
import {
  applyActivityAdaptationAction,
  discardActivityAdaptationAction,
  suggestActivityAdaptationAction,
} from "./adaptation-actions";
import {
  initialAdaptationSuggestionState,
  type AdaptationApplyState,
} from "./adaptation-action-state";

type Props = Readonly<{
  draftId: string;
  version: number;
  currentGrade: number;
  currentLessons: number;
  applyIdempotencyKey: string;
}>;

const grades = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const defaultAreas = new Set(["BACKGROUND", "TASK_INSTRUCTIONS", "PHASES"]);

function ChangeList({ changes }: { changes: readonly AdaptationChange[] }) {
  return (
    <ol className="grid gap-3">
      {changes.map((change) => (
        <li
          className="grid gap-2 rounded-xl border bg-background/60 p-3"
          key={`${change.area}-${change.label}`}
        >
          <p className="type-caption font-medium text-foreground">
            {change.label === change.areaLabel
              ? change.label
              : `${change.areaLabel} · ${change.label}`}
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            <p className="rounded-lg bg-muted/60 p-2 text-sm leading-relaxed text-muted-foreground line-through decoration-muted-foreground/40">
              {change.before}
            </p>
            <p className="rounded-lg bg-primary/8 p-2 text-sm leading-relaxed">
              {change.after}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function AdaptationPanel({
  draftId,
  version,
  currentGrade,
  currentLessons,
  applyIdempotencyKey,
}: Props) {
  const [open, setOpen] = useState(false);
  const [suggestion, suggestAction, suggesting] = useActionState(
    suggestActivityAdaptationAction,
    initialAdaptationSuggestionState,
  );
  const [applyState, applyAction, applying] = useActionState<
    AdaptationApplyState,
    FormData
  >(applyActivityAdaptationAction, { status: "idle", message: "" });
  const [discarded, setDiscarded] = useState<string | null>(null);
  const [discarding, startDiscard] = useTransition();

  const proposal =
    suggestion.suggestion && suggestion.suggestion.agentRunId !== discarded
      ? suggestion.suggestion
      : null;
  const busy = suggesting || applying || discarding;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setOpen(true)} type="button" variant="outline">
          <SparklesIcon data-icon="inline-start" />
          AI 适配到新班级
        </Button>
        <span className="type-caption text-muted-foreground">
          按年级、课时或新情境改写已保存的版本，逐处确认后才写入。
        </span>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparklesIcon className="size-4" /> AI 适配
        </CardTitle>
        <CardDescription>
          基于已保存的第 {version} 版。下方表单里尚未保存的修改不会包含在内。
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {proposal ? null : (
          <form action={suggestAction} className="grid gap-4">
            <input name="draftId" type="hidden" value={draftId} />
            <input name="expectedVersion" type="hidden" value={version} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="adaptation-grade">目标年级</Label>
                <NativeSelect
                  defaultValue=""
                  id="adaptation-grade"
                  name="targetGrade"
                >
                  <NativeSelectOption value="">
                    不变（{currentGrade} 年级）
                  </NativeSelectOption>
                  {grades
                    .filter((grade) => grade !== currentGrade)
                    .map((grade) => (
                      <NativeSelectOption key={grade} value={grade}>
                        {grade} 年级
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="adaptation-lessons">总课时</Label>
                <Input
                  id="adaptation-lessons"
                  inputMode="numeric"
                  max={64}
                  min={3}
                  name="totalLessons"
                  placeholder={`不变（${currentLessons} 课时）`}
                  type="number"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="adaptation-context">新班级或新情境</Label>
              <Textarea
                id="adaptation-context"
                maxLength={adaptationContextNoteMaxLength}
                name="contextNote"
                placeholder="例如：八年级，学校在城郊，改为调查社区公共用水"
                rows={3}
              />
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">
                允许 AI 改写的区域
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {adaptableTaskBookAreas.map((area) => (
                  <label
                    className="flex items-start gap-2 rounded-lg border p-2.5 text-sm"
                    key={area}
                  >
                    <Checkbox
                      aria-label={taskBookAreaLabels[area]}
                      className="mt-0.5"
                      defaultChecked={defaultAreas.has(area)}
                      name="areas"
                      value={area}
                    />
                    <span className="grid gap-0.5">
                      <span className="font-medium">
                        {taskBookAreaLabels[area]}
                      </span>
                      <span className="type-caption text-muted-foreground">
                        {adaptableAreaHints[area]}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="type-caption text-muted-foreground">
                目标、阶段、证据和评价维度的数量与对应关系保持不变；未勾选的区域原样保留。
              </p>
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} type="submit">
                {suggesting ? "生成中…" : "生成适配建议"}
              </Button>
              <Button
                disabled={busy}
                onClick={() => setOpen(false)}
                type="button"
                variant="ghost"
              >
                收起
              </Button>
            </div>
          </form>
        )}

        {suggestion.status !== "idle" && suggestion.status !== "suggested" ? (
          <InlineAlert
            tone={
              suggestion.status === "invalid_request" ||
              suggestion.status === "stale"
                ? "warning"
                : "danger"
            }
          >
            {suggestion.message}
          </InlineAlert>
        ) : null}

        {proposal ? (
          <div className="grid gap-4">
            <InlineAlert tone="info">{suggestion.message}</InlineAlert>
            <ChangeList changes={proposal.changes} />
            {applyState.status !== "idle" ? (
              <InlineAlert tone={applyState.status === "stale" ? "warning" : "danger"}>
                {applyState.message}
              </InlineAlert>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <form action={applyAction}>
                <input name="draftId" type="hidden" value={draftId} />
                <input
                  name="expectedVersion"
                  type="hidden"
                  value={proposal.baseVersion}
                />
                <input name="agentRunId" type="hidden" value={proposal.agentRunId} />
                <input
                  name="content"
                  type="hidden"
                  value={JSON.stringify(proposal.content)}
                />
                <input
                  name="idempotencyKey"
                  type="hidden"
                  value={`${applyIdempotencyKey}_${proposal.agentRunId}`}
                />
                <Button disabled={busy} type="submit">
                  {applying ? "写入中…" : `确认写入为第 ${proposal.baseVersion + 1} 版`}
                </Button>
              </form>
              <Button
                disabled={busy}
                onClick={() => {
                  const formData = new FormData();
                  formData.set("agentRunId", proposal.agentRunId);
                  startDiscard(async () => {
                    await discardActivityAdaptationAction(formData);
                    setDiscarded(proposal.agentRunId);
                  });
                }}
                type="button"
                variant="outline"
              >
                放弃这份建议
              </Button>
            </div>
            <p className="type-caption text-muted-foreground">
              写入后生成新版本，原版本保留在历史中；之后仍可在表单中继续修改，不会自动发布。
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
