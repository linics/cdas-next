import Link from "next/link";
import type { AuthenticationError } from "../../../server/auth/current-actor";
import { LocalLoginForm } from "../../auth/local-login-form";
import gateStyles from "../../_components/access-gate.module.css";
import { isDevelopmentQuickLoginEnabled } from "../../../server/auth/development-quick-login";

export function StudentAccessGate({
  code,
  returnPath,
}: {
  code: AuthenticationError["code"];
  returnPath: string;
}) {
  void returnPath;
  const copy =
    code === "AUTH_NOT_CONFIGURED"
      ? {
          eyebrow: "登录服务未设置",
          title: "学生工作台当前没有开放",
        }
      : code === "ACCOUNT_DISABLED" || code === "SCHOOL_DISABLED"
        ? {
            eyebrow: "账号或学校已停用",
            title: "学生工作台当前不能进入",
          }
        : code === "USER_NOT_PROVISIONED"
        ? {
            eyebrow: "学生账号尚未创建",
            title: "找不到对应的学生身份",
          }
        : {
            eyebrow: "需要登录",
            title: "先确认学生身份",
          };

  return (
    <div className={gateStyles.gate}>
      <section className={gateStyles.gateAside}>
        <Link
          className={gateStyles.brand}
          href="/"
          aria-label="返回 CDAS Next 首页"
        >
          <strong>CDAS</strong>
          <small>跨学科学习活动</small>
        </Link>
        <div className={gateStyles.pitch}>
          <p className={gateStyles.eyebrow}>学生工作台</p>
          <h1>查看活动、提交证据、获得教师反馈</h1>
          <p>
            这里只显示发布给你所在班级的活动。每次正式提交都会保留版本，收到教师反馈后可以继续修改或推进。
          </p>
        </div>
        <ol className={gateStyles.steps}>
          <li>
            <span>01</span>查看活动
          </li>
          <li>
            <span>02</span>提交证据
          </li>
          <li>
            <span>03</span>阅读反馈
          </li>
          <li>
            <span>04</span>按需重交
          </li>
        </ol>
      </section>
      <main className={gateStyles.accessGate}>
        <div>
          <p className={gateStyles.eyebrow}>{copy.eyebrow}</p>
          <h2>{copy.title}</h2>
        </div>
        {code === "UNAUTHENTICATED" || code === "USER_NOT_PROVISIONED" ? (
          <LocalLoginForm role="STUDENT" quickLogin={isDevelopmentQuickLoginEnabled()} />
        ) : code === "PASSWORD_CHANGE_REQUIRED" ? (
          <div className={gateStyles.actions}>
            <Link className={gateStyles.primaryButton} href="/student/password">修改密码后继续</Link>
          </div>
        ) : null}
      </main>
    </div>
  );
}
