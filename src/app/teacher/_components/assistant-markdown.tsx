"use client";

import "katex/dist/katex.min.css";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import styles from "./activity-assistant.module.css";

function assistantUrlTransform(url: string): string {
  const transformed = defaultUrlTransform(url);
  if (!transformed) {
    return "";
  }
  if (transformed.startsWith("/") && !transformed.startsWith("//")) {
    return transformed;
  }
  if (transformed.startsWith("#")) {
    return transformed;
  }
  if (transformed.startsWith("https:") || transformed.startsWith("http:")) {
    return transformed;
  }
  return "";
}

export function AssistantMarkdown({ children }: { children: string }) {
  return (
    <div className={styles.markdown}>
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
        rehypePlugins={[[rehypeKatex, { errorColor: "#b42318", strict: "ignore" }]]}
        urlTransform={assistantUrlTransform}
      >
        {children}
      </Markdown>
    </div>
  );
}
