"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { InlineAlert } from "../../_components/ui";
import { adoptSourceAction } from "./actions";
import { initialAdoptSourceState } from "./adopt-source-state";

type Props = Readonly<{
  sourceId: string;
  sectionId: string;
  drafts: ReadonlyArray<{ id: string; title: string; version: number }>;
  defaultDraftId: string | null;
  idempotencyKey: string;
}>;

export function AdoptSourceForm({
  sourceId,
  sectionId,
  drafts,
  defaultDraftId,
  idempotencyKey,
}: Props) {
  const [state, action, pending] = useActionState(
    adoptSourceAction,
    initialAdoptSourceState,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="type-card-title">采纳为草稿依据</CardTitle>
        <CardDescription>
          记录在草稿当前版本上，标为手工选择；不会修改任务书内容。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {drafts.length === 0 ? (
          <p className="type-caption">没有可以记录依据的草稿（仅限未发布的新版任务书）。</p>
        ) : (
          <form action={action} className="grid gap-4">
            <input name="sourceId" type="hidden" value={sourceId} />
            <input name="sectionId" type="hidden" value={sectionId} />
            <input
              name="idempotencyKey"
              type="hidden"
              value={`${idempotencyKey}_${sectionId}`}
            />
            <div className="grid gap-2">
              <Label htmlFor="adopt-draft">草稿</Label>
              <NativeSelect
                defaultValue={defaultDraftId ?? ""}
                id="adopt-draft"
                name="draftId"
              >
                <NativeSelectOption disabled value="">
                  选择一份草稿
                </NativeSelectOption>
                {drafts.map((draft) => (
                  <NativeSelectOption key={draft.id} value={draft.id}>
                    {draft.title}（第 {draft.version} 版）
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="adopt-rationale">采用理由</Label>
              <Textarea
                id="adopt-rationale"
                maxLength={600}
                name="rationale"
                placeholder="这一条如何支撑活动的目标、任务或评价"
                rows={3}
              />
            </div>
            {state.status !== "idle" ? (
              <InlineAlert
                tone={
                  state.status === "adopted"
                    ? "success"
                    : state.status === "rejected"
                      ? "warning"
                      : "danger"
                }
              >
                {state.message}
                {state.draftId ? (
                  <>
                    {" "}
                    <Link
                      className="font-medium underline underline-offset-4"
                      href={`/teacher/activities/${state.draftId}#source-references`}
                    >
                      回到草稿
                    </Link>
                  </>
                ) : null}
              </InlineAlert>
            ) : null}
            <div>
              <Button disabled={pending || state.status === "adopted"} type="submit">
                {pending ? "记录中…" : "确认采纳"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
