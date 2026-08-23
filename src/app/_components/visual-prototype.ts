export const VISUAL_PROTOTYPE_IDS = [
  "warm-paper",
  "ink-structure",
  "soft-studio",
] as const;

export type VisualPrototypeId = (typeof VISUAL_PROTOTYPE_IDS)[number];

export const VISUAL_PROTOTYPE_LABELS: Record<VisualPrototypeId, string> = {
  "warm-paper": "暖纸工作台",
  "ink-structure": "墨结构",
  "soft-studio": "柔和教室",
};

export function parseVisualPrototype(
  value: string | string[] | undefined,
): VisualPrototypeId | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return VISUAL_PROTOTYPE_IDS.find((id) => id === raw);
}

export async function readVisualPrototype(
  searchParams?: Promise<Record<string, string | string[] | undefined>>,
): Promise<VisualPrototypeId | undefined> {
  if (!searchParams) {
    return undefined;
  }
  const params = await searchParams;
  return parseVisualPrototype(params.visual);
}
