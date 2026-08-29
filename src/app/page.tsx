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
          <span>跨学科学习活动</span>
        </Link>
        <p>跨学科学习活动工作台</p>
      </header>
      <main className={styles.main} id="main-content">
        <p className={styles.kicker}>选择工作台</p>
        <h1 id="home-title">让一次学习活动，从设计走到证据。</h1>
        <p className={styles.lead}>
          教师在这里设计、发布活动并给出反馈，学生提交学习证据。全过程保留版本记录，可随时回溯。
        </p>

        <section className={styles.workspaceList} aria-labelledby="home-title">
          <Link className={styles.workspaceLink} href="/teacher">
            <h2>教师工作台</h2>
            <p>管理活动草稿与已发布活动，处理待反馈的学生提交。</p>
            <span className={styles.workspaceAction}>
              进入教师工作台
              <svg
                aria-hidden="true"
                fill="none"
                height="14"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.75"
                viewBox="0 0 24 24"
                width="14"
              >
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </span>
          </Link>
          <Link className={styles.workspaceLink} href="/student">
            <h2>学生工作台</h2>
            <p>查看待完成的活动、已提交的证据和教师反馈。</p>
            <span className={styles.workspaceAction}>
              进入学生工作台
              <svg
                aria-hidden="true"
                fill="none"
                height="14"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.75"
                viewBox="0 0 24 24"
                width="14"
              >
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </span>
          </Link>
        </section>

        <p className={styles.flow}>
          设计任务书 · 确认发布 · 学生提交证据 · 教师反馈与评价 · 关闭活动
        </p>

        <section className={styles.note} aria-labelledby="workflow-title">
          <p className={styles.noteIndex}>平台边界</p>
          <div>
            <h2 id="workflow-title">完整的教学闭环</h2>
            <p>
              从创建活动、确认发布，到学生提交证据、教师反馈与评价，再到学生回看，全程可追溯。AI
              仅辅助准备内容，正式决定始终由教师作出。
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
