"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { copyActivityDraftAction, type CopyActivityActionState } from "./actions";
import { CircleAlertIcon, CopyIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function CopyActivityForm({
  sourceKind,
  sourceId,
  sourceVersion,
  initialTitle,
  initialIdempotencyKey,
}: {
  sourceKind: "DRAFT" | "RELEASE";
  sourceId: string;
  sourceVersion: number;
  initialTitle: string;
  initialIdempotencyKey: string;
}) {
  const initialState: CopyActivityActionState = {
    status: "idle",
    message: "",
    values: {
      sourceKind,
      sourceId,
      sourceVersion: String(sourceVersion),
      title: initialTitle,
    },
    nextIdempotencyKey: initialIdempotencyKey,
  };
  const [state, formAction, pending] = useActionState(
    copyActivityDraftAction,
    initialState,
  );
  const [title, setTitle] = useState(initialTitle);

  return (
    <form className="flex flex-col gap-4" action={formAction}>
      <input type="hidden" name="sourceKind" value={state.values.sourceKind} />
      <input type="hidden" name="sourceId" value={state.values.sourceId} />
      <input
        type="hidden"
        name="sourceVersion"
        value={state.values.sourceVersion}
      />
      <input type="hidden" name="idempotencyKey" value={state.nextIdempotencyKey} />
      <Field>
        <FieldLabel htmlFor="copy-title">新草稿标题</FieldLabel>
        <Input
          id="copy-title"
          name="title"
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={120}
          required
        />
      </Field>
      {state.message ? (
        <Alert
          role="alert"
          variant={state.status === "conflict" ? "default" : "destructive"}
        >
          <CircleAlertIcon />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} type="submit">
          <CopyIcon />
          {pending ? "复制中…" : "确认复制为新草稿"}
        </Button>
        <Button asChild variant="outline">
          <Link href="/teacher/activities/copy">重新选择来源</Link>
        </Button>
      </div>
    </form>
  );
}
