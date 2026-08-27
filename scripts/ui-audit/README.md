# 界面审查

跨全部路由检查视觉一致性，不靠人眼逐页看。

```bash
python3 scripts/ui-audit/audit.py 1280 768 390
```

需要 dev server 在 :3000，直接 `pnpm dev` 即可 —— 脚本靠 `.env.local` 里的
`DEV_CLICKTHROUGH_AUTH=1` 免登录访问 `/teacher` 与 `/student`。

**不要**给 dev server 设 `E2E_RUN_MARKER`：`isClickthroughAuthEnabled` 见到它
就会关掉免登录通道，页面会全部落到门禁页，审查结果随之失真。

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
