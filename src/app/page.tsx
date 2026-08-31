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
      </header>
      <main className={styles.main} id="main-content">
        <section className={styles.intro} aria-labelledby="home-title">
          <h1 id="home-title">跨学科学习活动工作台</h1>
          <p>教师设计与发布学习任务，学生完成学习证据并获得反馈。</p>
        </section>
        <section className={styles.entries} aria-label="选择工作台">
          <Link className={styles.entry} href="/teacher">
            <h2>教师工作台</h2>
            <p>设计跨学科任务、管理班级并处理学生提交。</p>
            <span>进入教师端</span>
          </Link>
          <Link className={styles.entry} href="/student">
            <h2>学生工作台</h2>
            <p>查看学习任务，提交证据并阅读教师反馈。</p>
            <span>进入学生端</span>
          </Link>
        </section>
      </main>
    </div>
  );
}
