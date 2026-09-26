import { ClipboardCheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LocalizedDateTime } from "../../../_components/localized-date-time";
import { diagnosisCategoryLabels } from "../../../../domain/activity/draft-diagnosis";
import type { DraftDiagnosisView } from "../../../../server/queries/activity-draft-diagnoses";
import { DiagnosisTrigger } from "./diagnosis-trigger";

function DiagnosisBody({ diagnosis }: { diagnosis: DraftDiagnosisView }) {
  return (
    <div className="grid gap-3">
      <p className="type-body">{diagnosis.summary}</p>
      {diagnosis.findings.length === 0 ? (
        <p className="type-caption">没有需要修改的具体问题。</p>
      ) : (
        <ol className="grid gap-3">
          {diagnosis.findings.map((finding) => (
            <li
              className="grid gap-1.5 rounded-xl border bg-background/60 p-3"
              key={`${finding.target}-${finding.category}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{finding.label}</span>
                <Badge variant="secondary">{diagnosisCategoryLabels[finding.category]}</Badge>
              </div>
              <p className="type-body text-muted-foreground">{finding.problem}</p>
              <p className="rounded-lg bg-primary/8 p-2 text-sm leading-relaxed">
                {finding.suggestion}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function DraftDiagnosis({
  draftId,
  currentVersion,
  diagnoses,
  canDiagnose,
}: {
  draftId: string;
  currentVersion: number;
  diagnoses: readonly DraftDiagnosisView[];
  canDiagnose: boolean;
}) {
  const current = diagnoses.find(
    (diagnosis) => diagnosis.revisionVersion === currentVersion,
  );
  const history = diagnoses.filter((diagnosis) => diagnosis !== current);
  const olderVersions = history.filter(
    (diagnosis) => diagnosis.revisionVersion < currentVersion,
  ).length;

  if (!canDiagnose && diagnoses.length === 0) return null;

  return (
    <Card id="draft-diagnosis">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheckIcon className="size-4" /> 版本检查
        </CardTitle>
        <CardDescription>
          {current ? (
            <>
              第 {current.revisionVersion} 版 · <LocalizedDateTime dateTime={current.createdAt} />
              。AI 建议仅供参考，修改仍在下方表单中完成。
            </>
          ) : (
            `第 ${currentVersion} 版还没有检查过。AI 只看已保存的版本，不会改动任务书。`
          )}
        </CardDescription>
        {canDiagnose ? (
          <CardAction>
            <DiagnosisTrigger draftId={draftId} version={currentVersion} />
          </CardAction>
        ) : null}
      </CardHeader>
      {current || history.length > 0 ? (
        <CardContent className="grid gap-4">
          {current ? <DiagnosisBody diagnosis={current} /> : null}
          {history.length > 0 ? (
            <details className="grid gap-3">
              <summary className="type-caption cursor-pointer">
                更早的检查 {history.length} 条
                {olderVersions > 0
                  ? `（其中 ${olderVersions} 条针对旧版本，不代表当前内容）`
                  : ""}
              </summary>
              {history.map((diagnosis) => (
                <div className="mt-3 grid gap-2 border-t pt-3" key={diagnosis.id}>
                  <p className="type-caption">
                    第 {diagnosis.revisionVersion} 版
                    {diagnosis.revisionVersion < currentVersion ? "（旧版本）" : ""} ·{" "}
                    <LocalizedDateTime dateTime={diagnosis.createdAt} />
                  </p>
                  <DiagnosisBody diagnosis={diagnosis} />
                </div>
              ))}
            </details>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}
