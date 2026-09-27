/**
 * 阶段支架（`phase.support`）的学生端结构（D-080）。
 *
 * 支架仍是一段不超过 500 字的文本，任务书合同不变；起草提示词要求模型按下面
 * 的约定写，学生页据此把它拆成「分几步做」和「可以这样开头」：
 *
 *   1. 先……
 *   2. 再……
 *   可以这样写：「我们发现……」「数据说明……」
 *
 * 不符合约定的旧支架（教师手写、旧草稿、已发布快照）整段当作说明原样显示。
 */
export type SupportScaffold = {
  steps: string[];
  starters: string[];
  notes: string[];
};

// "1." "2、" "3）" or a circled numeral. A bare number ("3 个时间点") or a
// decimal ("3.5 米") is prose, not a step.
const stepPattern = /^\s*(?:\d{1,2}\s*[.、．)）](?!\d)|[①②③④⑤⑥⑦⑧⑨⑩][.、．]?)\s*/;
const starterPattern = /^\s*(?:可以这样(?:写|说|开头|表达)|句式|开头可以用)\s*[:：]\s*/;
const quotedPattern = /「([^「」]+)」/g;

export function parseSupportScaffold(support: string): SupportScaffold {
  const scaffold: SupportScaffold = { steps: [], starters: [], notes: [] };
  for (const rawLine of support.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (starterPattern.test(line)) {
      const quoted = [...line.matchAll(quotedPattern)]
        .map((match) => match[1].trim())
        .filter(Boolean);
      if (quoted.length > 0) {
        scaffold.starters.push(...quoted);
        continue;
      }
    }
    const step = line.match(stepPattern);
    if (step) {
      const text = line.slice(step[0].length).trim();
      if (text) {
        scaffold.steps.push(text);
        continue;
      }
    }
    scaffold.notes.push(line);
  }
  return scaffold;
}
