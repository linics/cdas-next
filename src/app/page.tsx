import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRightIcon,
  GraduationCapIcon,
  PresentationIcon,
  SchoolIcon,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { revealChildren } from "./_components/reveal";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BrandMark } from "./_components/brand-mark";

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

const doors: readonly {
  href: string;
  role: string;
  title: string;
  detail: string;
  icon: LucideIcon;
}[] = [
  {
    href: "/teacher",
    role: "教师",
    title: "教师工作台",
    detail: "管理活动草稿和已发布的活动，处理等你反馈的学生提交。",
    icon: PresentationIcon,
  },
  {
    href: "/student",
    role: "学生",
    title: "学生工作台",
    detail: "查看要完成的活动、已经提交的证据和教师反馈。",
    icon: GraduationCapIcon,
  },
  {
    href: "/admin/login",
    role: "管理员",
    title: "学校管理",
    detail: "建立学校，启用或停用学校与教师，登记还没开通登录的本校教师。",
    icon: SchoolIcon,
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
          <Link
            aria-label="CDAS Next 首页"
            className="flex items-center gap-2 font-semibold"
            href="/"
          >
            <BrandMark className="size-7" />
            CDAS Next
          </Link>
          <p className="text-sm text-muted-foreground">选择工作台</p>
        </div>
      </header>

      <main
        className={cn("mx-auto flex w-full max-w-6xl flex-1 flex-col gap-16 px-6 py-16 md:py-24", revealChildren)}
        id="main-content"
      >
        <section aria-labelledby="home-title" className="flex max-w-3xl flex-col gap-6">
          <Badge className="w-fit" variant="secondary">
            面向 K12 教师与学生的跨学科学习活动工作台
          </Badge>
          <h1
            className="text-4xl font-semibold tracking-tight text-balance md:text-5xl"
            id="home-title"
          >
            让一次学习活动，从设计走到证据。
          </h1>
          <p className="text-lg text-muted-foreground">
            教师设计、发布活动并给出反馈，学生提交学习证据。每一版都有记录，随时可以回看。
          </p>
        </section>

        <nav aria-label="选择工作台" className="grid gap-4 md:grid-cols-3">
          {doors.map(({ href, role, title, detail, icon: Icon }) => (
            <Link
              className="group rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              href={href}
              key={href}
            >
              <Card className="h-full transition-all group-hover:-translate-y-0.5 group-hover:shadow-md">
                <CardHeader className="gap-3">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-muted">
                    <Icon className="size-5" />
                  </span>
                  <CardDescription>{role}</CardDescription>
                  <CardTitle className="type-section-title flex items-center justify-between">
                    {title}
                    <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">{detail}</p>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </nav>

        <section aria-labelledby="workflow-title" className="flex flex-col gap-6">
          <div className="space-y-1">
            <h2 className="type-section-title" id="workflow-title">
              完整的教学闭环
            </h2>
            <p className="text-sm text-muted-foreground">
              AI 只帮忙准备内容，正式决定都由教师来做。
            </p>
          </div>
          <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3 lg:grid-cols-6">
            {loopSteps.map((step, index) => (
              <li className="flex flex-col gap-2 bg-background p-4" key={step}>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="text-sm font-medium">{step}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
