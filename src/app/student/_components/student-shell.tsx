import { SignInButton, SignOutButton } from "@clerk/nextjs";
import Link from "next/link";
import type { AuthenticationError } from "../../../server/auth/current-actor";
import { isClickthroughAuthEnabled } from "../../../server/auth/clickthrough-auth";
import { InlineAlert } from "../../_components/ui";
import gateStyles from "../../_components/access-gate.module.css";

export function StudentAccessGate({
  code,
  returnPath,
}: {
  code: AuthenticationError["code"];
  returnPath: string;
}) {
  const copy =
    code === "AUTH_NOT_CONFIGURED"
      ? {
          eyebrow: "登录服务未设置",
          title: "学生工作台当前没有开放",
          detail:
            "系统当前无法验证学生身份，不会读取任何班级活动、提交记录或教师反馈。完成登录服务配置后即可使用。",
        }
      : code === "USER_NOT_PROVISIONED"
        ? {
            eyebrow: "学生账号尚未创建",
            title: "找不到对应的学生身份",
            detail:
              "当前登录账号尚未关联学生身份。请联系管理员完成账号与班级配置。",
          }
        : {
            eyebrow: "需要登录",
            title: "先确认学生身份",
            detail:
              "未登录时不会读取任何班级活动、草稿或教师反馈。请登录后重新进入。",
          };

  return (
    <div className={gateStyles.gate}>
      <section className={gateStyles.gateAside}>
        <Link
          className={gateStyles.brand}
          href="/student"
          aria-label="CDAS Next 学生工作台"
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
        <InlineAlert tone="info">{copy.detail}</InlineAlert>
        <div className={gateStyles.actions}>
          {isClickthroughAuthEnabled() ? null : code === "UNAUTHENTICATED" ? (
            <SignInButton mode="modal" fallbackRedirectUrl={returnPath}>
              <button className={gateStyles.primaryButton} type="button">
                登录学生账号
              </button>
            </SignInButton>
          ) : code === "USER_NOT_PROVISIONED" ? (
            <SignOutButton redirectUrl={returnPath}>
              <button className={gateStyles.secondaryButton} type="button">
                退出当前账号
              </button>
            </SignOutButton>
          ) : null}
          <Link className={gateStyles.backLink} href="/">返回首页</Link>
        </div>
        <p className={gateStyles.gateNote}>
          学生工作台 · 身份确认前不会读取任何活动与提交数据。
        </p>
      </main>
    </div>
  );
}
