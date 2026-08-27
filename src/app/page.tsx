import type { Metadata } from "next";
import Link from "next/link";
import styles from "./home.module.css";

export const metadata: Metadata = {
  title: "CDAS Next | 跨学科学习活动工作台",
  description: "教师发布活动、学生提交证据、教师反馈的可追溯工作台",
};

export default function HomePage() {
  return (
    <div className={styles.home}>
      <header className={styles.toolbar}>
        <Link className={styles.brand} href="/" aria-label="CDAS Next 首页">
          <strong>CDAS</strong>
          <span>Next</span>
        </Link>
        <p>跨学科学习活动工作台</p>
      </header>
      <main className={styles.main} id="main-content">
        <section className={styles.intro} aria-labelledby="home-title">
          <div>
            <p className={styles.kicker}>跨学科学习活动工作台</p>
            <h1 id="home-title">让一次学习活动，从设计走到证据。</h1>
            <p>
              教师设计、发布并反馈；学生提交可核验的学习证据。每个正式动作都保留清楚的版本与归属。
            </p>
          </div>
          <div className={styles.introMark} aria-hidden="true">
            <span>CDAS</span>
            <p>Design · Evidence · Feedback</p>
          </div>
        </section>
        <header className={styles.workspaceHeading}>
          <p>选择工作区</p>
          <span>使用与你当前账号一致的入口</span>
        </header>
        <section className={styles.workspaceList} aria-label="工作区入口">
          <Link className={styles.workspaceLink} href="/teacher">
            <span className={styles.workspaceIndex} aria-hidden="true">01</span>
            <div className={styles.workspaceCopy}>
              <h2>教师工作台</h2>
              <p>查看活动草稿、已发布活动和需要反馈的学生提交。</p>
            </div>
            <span className={styles.workspaceAction}>进入教师端 <i aria-hidden="true">→</i></span>
          </Link>
          <Link className={styles.workspaceLink} href="/student">
            <span className={styles.workspaceIndex} aria-hidden="true">02</span>
            <div className={styles.workspaceCopy}>
              <h2>学生工作台</h2>
              <p>优先查看待完成活动、已提交证据和教师反馈。</p>
            </div>
            <span className={styles.workspaceAction}>进入学生端 <i aria-hidden="true">→</i></span>
          </Link>
        </section>
        <section className={styles.note} aria-labelledby="workflow-title">
          <p className={styles.noteIndex}>工作边界</p>
          <div>
            <h2 id="workflow-title">当前支持的教学闭环</h2>
            <p>创建活动 → 明确确认发布 → 学生提交学习证据 → 教师确认反馈与评价 → 学生回看。AI 只协助准备，不能代替教师作出正式决定。</p>
          </div>
        </section>
      </main>
    </div>
  );
}
