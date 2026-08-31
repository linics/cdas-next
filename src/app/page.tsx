import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
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
        <nav className={styles.quickLinks} aria-label="快捷入口">
          <Link href="/teacher">教师端</Link>
          <Link href="/student">学生端</Link>
        </nav>
      </header>
      <main className={styles.main} id="main-content">
        <section className={styles.hero} aria-labelledby="home-title">
          <div className={styles.intro}>
            <p className={styles.kicker}>CDAS · 跨学科学习活动</p>
            <h1 id="home-title">让跨学科作业设计更轻松</h1>
            <p>面向中小学教师的作业设计、学生提交与反馈支持平台，让每一次学习都能留下清晰、可回看的成长证据。</p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryAction} href="/teacher">进入教师端 <span aria-hidden="true">→</span></Link>
              <Link className={styles.secondaryAction} href="/student">进入学生端</Link>
            </div>
            <p className={styles.heroNote}>任务设计 · 班级管理 · 学习证据 · 教师反馈</p>
          </div>
          <div className={styles.heroVisual}>
            <Image alt="跨学科学习场景插图" fill preload sizes="(max-width: 900px) 100vw, 52vw" src="/images/cdas-learning-login-hero-v1.png" />
            <div className={styles.heroVisualLabel}><span>探索、创造、协作</span></div>
          </div>
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
