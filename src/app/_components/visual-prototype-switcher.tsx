"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  VISUAL_PROTOTYPE_IDS,
  VISUAL_PROTOTYPE_LABELS,
  type VisualPrototypeId,
} from "./visual-prototype";
import styles from "./visual-prototype-switcher.module.css";

export function VisualPrototypeSwitcher({
  current,
}: {
  current: VisualPrototypeId;
}) {
  const pathname = usePathname();

  return (
    <nav className={styles.bar} aria-label="视觉原型（仅本分支）">
      <p>视觉原型（仅本分支）</p>
      <ul>
        {VISUAL_PROTOTYPE_IDS.map((id) => (
          <li key={id}>
            <Link
              aria-current={id === current ? "page" : undefined}
              href={`${pathname}?visual=${id}`}
            >
              {VISUAL_PROTOTYPE_LABELS[id]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
