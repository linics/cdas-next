# 界面审查

跨全部路由检查视觉一致性，不靠人眼逐页看。

```bash
python3 scripts/ui-audit/audit.py 1280 768 390
```

需要先用同一组演示凭据运行种子、dev server 和审查脚本。密码只从进程环境读取，
不会写入输出、发现结果或截图：

```bash
DEV_TEST_DEMO_TEACHER_PASSWORD='…' \
DEV_TEST_DEMO_STUDENT_1_PASSWORD='…' \
  pnpm demo:seed -- --confirm-database '<database-name>'
DEV_TEST_DEMO_TEACHER_PASSWORD='…' \
DEV_TEST_DEMO_STUDENT_1_PASSWORD='…' \
  pnpm dev
DEV_TEST_DEMO_TEACHER_PASSWORD='…' \
DEV_TEST_DEMO_STUDENT_1_PASSWORD='…' \
  python3 scripts/ui-audit/audit.py 1280 768 390
```

实际使用时，三个进程必须使用相同的两个密码；上面的 `…` 只是 shell 占位符，
不要把真实密码提交到仓库。脚本分别在独立的浏览器上下文中登录
`SCHARCHX/T-DEMO` 教师账号和 `SCHARCHX/700001` 学生账号，然后审查各自路由。

## 检查项

| 项 | 判据 |
| --- | --- |
| `offScale` | 渲染字号不在 42/32/25/20/16/15/14/13/12 这九档内 |
| `contrast` | 正文 < 4.5:1，大字（≥24px 或 ≥19px 半粗）< 3:1，背景按 alpha 逐层合成 |
| `clipped` | 元素内容宽于容器且未开滚动 |
| `tinyTarget` | 按钮 / 链接 / 表单控件高度 < 28px |
| `longMeasure` | 正文行长 > 95ch |
| `pageOverflow` | 页面出现横向滚动 |

输出为空即通过。加路由或改字号阶时同步改脚本顶部的 `TEACHER_ROUTES` / `SCALE`。
