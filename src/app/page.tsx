import type { Metadata } from "next";
import Link from "next/link";
import styles from "./home.module.css";

export const metadata: Metadata = {
  title: "CDAS Next | 跨学科学习活动工作台",
  description: "教师发布活动、学生提交证据、教师反馈的可追溯工作台",
};

const loopSteps = [
  "设计任务书",
  "确认发布",
  "学生提交证据",
  "反馈与量规评价",
  "回看与重交",
  "关闭活动",
] as const;

function DoorArrow() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="1em"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
      width="1em"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <div className={styles.home}>
      <header className={styles.toolbar}>
        <Link className={styles.brand} href="/" aria-label="CDAS Next 首页">
          <strong>CDAS</strong>
          <span>跨学科学习活动</span>
        </Link>
        <p>选择工作台</p>
      </header>
      <main className={styles.main} id="main-content">
        <section className={styles.preface} aria-labelledby="home-title">
          <div className={styles.prefaceBody}>
            <h1 id="home-title">让一次学习活动，从设计走到证据。</h1>
            <p className={styles.lead}>
              教师在这里设计、发布活动并给出反馈，学生提交学习证据。全过程保留版本记录，可随时回溯。
            </p>

            <section className={styles.loop} aria-labelledby="workflow-title">
              <h2 id="workflow-title">完整的教学闭环</h2>
              <ol className={styles.loopList}>
                {loopSteps.map((step, index) => (
                  <li key={step}>
                    <span aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
              <p className={styles.loopNote}>
                AI 仅辅助准备内容，正式决定始终由教师作出。
              </p>
            </section>
          </div>
        </section>

        <div className={styles.spine} aria-hidden="true">
          <span>跨学科学习活动工作台</span>
        </div>

        <section className={styles.doors} aria-label="选择工作台">
          <Link className={styles.door} href="/teacher">
            <p className={styles.doorEyebrow}>教师</p>
            <h2>教师工作台</h2>
            <p className={styles.doorDetail}>
              管理活动草稿与已发布活动，处理待反馈的学生提交。
            </p>
            <span className={styles.doorAction}>
              进入教师工作台
              <DoorArrow />
            </span>
          </Link>
          <Link className={styles.door} href="/student">
            <p className={styles.doorEyebrow}>学生</p>
            <h2>学生工作台</h2>
            <p className={styles.doorDetail}>
              查看待完成的活动、已提交的证据和教师反馈。
            </p>
            <span className={styles.doorAction}>
              进入学生工作台
              <DoorArrow />
            </span>
          </Link>
          <Link className={styles.door} href="/admin/login">
            <p className={styles.doorEyebrow}>管理员</p>
            <h2>学校管理</h2>
            <p className={styles.doorDetail}>
              建校、启停学校与教师，登记尚未开通登录的本校教师。
            </p>
            <span className={styles.doorAction}>
              进入管理员工作台
              <DoorArrow />
            </span>
          </Link>
        </section>
      </main>
    </div>
  );
}
