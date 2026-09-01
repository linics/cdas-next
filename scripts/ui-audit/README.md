# 界面审查

跨全部路由检查视觉一致性，不靠人眼逐页看。

```bash
python3 scripts/ui-audit/audit.py 1280 768 390
```

先运行本地演示种子。它会恢复下面列出的固定开发凭据；脚本不会把密码写入输出、发现结果或截图：

```bash
pnpm demo:seed -- --confirm-database '<database-name>'
pnpm dev
python3 scripts/ui-audit/audit.py 1280 768 390
```

脚本分别在独立的浏览器上下文中登录 `SCHARCHX/T-DEMO` 教师账号和
`SCHARCHX/700001` 学生账号，然后审查各自路由。固定账号见仓库根目录 README 的「本地演示账号」；
它们只用于本地演示，不能用于真实部署。

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
