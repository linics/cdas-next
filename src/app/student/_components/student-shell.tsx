import Link from "next/link";
import type { AuthenticationError } from "../../../server/auth/current-actor";
import { InlineAlert } from "../../_components/ui";
import gateStyles from "../../_components/access-gate.module.css";

export function StudentAccessGate({
  code,
  returnPath: _returnPath,
}: {
  code: AuthenticationError["code"];
  returnPath: string;
}) {
  // Kept for callers that preserve the requested route in their access state.
  void _returnPath;
  const copy = {
            title: "登录学生账号",
            detail: "使用学校代码、学号和密码继续。",
        };

  return (
    <div className={gateStyles.gate}>
      <main className={gateStyles.accessGate}>
        <div>
          <h2>{copy.title}</h2>
        </div>
        <InlineAlert tone="info">{copy.detail}</InlineAlert>
        <div className={gateStyles.actions}>
          {code === "UNAUTHENTICATED" ? <Link className={gateStyles.primaryButton} href="/student/login">登录学生账号</Link> : null}
          <Link className={gateStyles.backLink} href="/">返回首页</Link>
        </div>
      </main>
    </div>
  );
}
