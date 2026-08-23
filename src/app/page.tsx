import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, FileTextIcon, PencilSimpleIcon } from "./_components/flat-icons";
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
          <span aria-hidden="true">CD</span>
          CDAS Next
        </Link>
        <p>跨学科学习活动工作台</p>
      </header>
      <main className={styles.main} id="main-content">
        <section className={styles.intro} aria-labelledby="home-title">
          <p className={styles.kicker}>选择你的工作区</p>
          <h1 id="home-title">开始今天的学习活动</h1>
          <p>教师设计、发布并反馈；学生提交可核验的文字证据。每个正式动作都保留可追溯记录。</p>
        </section>
        <section className={styles.workspaceList} aria-label="工作区入口">
          <Link className={styles.workspaceLink} href="/teacher">
            <div>
              <span className={styles.workspaceIcon} aria-hidden="true">
                <PencilSimpleIcon />
              </span>
              <h2>教师工作台</h2>
              <p>查看活动草稿、已发布活动和需要反馈的学生提交。</p>
            </div>
            <span>进入教师端 <ArrowRightIcon /></span>
          </Link>
          <Link className={styles.workspaceLink} href="/student">
            <div>
              <span className={styles.workspaceIcon} aria-hidden="true">
                <FileTextIcon />
              </span>
              <h2>学生工作台</h2>
              <p>优先查看待完成活动、已提交证据和教师反馈。</p>
            </div>
            <span>进入学生端 <ArrowRightIcon /></span>
          </Link>
        </section>
        <section className={styles.note} aria-labelledby="workflow-title">
          <h2 id="workflow-title">本阶段支持的教学闭环</h2>
          <p>创建活动 → 明确确认发布 → 学生提交文字证据 → 教师确认反馈 → 学生回看反馈。AI 只能协助准备，不能代替教师发布或评价。</p>
        </section>
      </main>
    </div>
  );
}
