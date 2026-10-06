import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getTeacherAgentPageContext } from "./teacher-agent-page-context";
import {
  productSurfaceControlLabels,
  studentProductSurfaces,
  teacherProductSurfaces,
} from "./teacher-product-surfaces";

/**
 * The assistant's map of the product is hand-written prose, and the pages it
 * describes keep moving. Twice now a page shipped without the map hearing about
 * it (activity copy, new classroom), and the assistant went on telling teachers
 * the product could not do what the page beside it did. These checks tie the
 * map to the routes and the labels the app actually has, so the drift fails
 * `pnpm test` the day it happens instead of surfacing in a teacher's chat.
 */

const appRoot = path.join(process.cwd(), "src", "app");

/** Pages reached before there is a workspace to talk about. */
const routesOutsideTheMap = new Map<string, string>([
  ["/teacher/login", "no session yet; the assistant is not mounted"],
  ["/teacher/register", "no session yet; the assistant is not mounted"],
  ["/teacher/password", "forced password change before the workspace opens"],
  ["/student/login", "no session yet"],
  ["/student/password", "forced password change before the workspace opens"],
]);

function pageRoutes(area: "teacher" | "student"): string[] {
  const routes: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      if (entry.startsWith("_")) continue;
      const full = path.join(directory, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry === "page.tsx") {
        const segments = path
          .relative(appRoot, directory)
          .split(path.sep)
          .filter((segment) => !/^\(.*\)$/.test(segment))
          .map((segment) => segment.replace(/^\[(.+)\]$/, "{$1}"));
        routes.push(`/${segments.join("/")}`);
      }
    }
  };
  walk(path.join(appRoot, area));
  return routes.sort();
}

function uiSource(): string {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const full = path.join(directory, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        files.push(full);
      }
    }
  };
  walk(appRoot);
  walk(path.join(process.cwd(), "src", "components"));
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

const sampleId = "30000000-0000-4000-8000-000000000003";

describe("teacher product surface map", () => {
  it("describes every teacher page the app serves, and only those", () => {
    const described = teacherProductSurfaces.map((surface) => surface.path).sort();
    const served = pageRoutes("teacher").filter(
      (route) => !routesOutsideTheMap.has(route),
    );

    expect(described).toEqual(served);
  });

  it("describes every student page the app serves, and only those", () => {
    const described = studentProductSurfaces.map((surface) => surface.path).sort();
    const served = pageRoutes("student").filter(
      (route) => !routesOutsideTheMap.has(route),
    );

    expect(described).toEqual(served);
  });

  it("recognises each described page as the page it describes", () => {
    for (const surface of teacherProductSurfaces) {
      const pathname = surface.path.replace(/\{[^}]+\}/g, sampleId);
      expect(getTeacherAgentPageContext(pathname).kind, surface.path).toBe(
        surface.kind,
      );
    }
  });

  it("names only buttons and headings the pages still render", () => {
    const source = uiSource();
    const missing = [...productSurfaceControlLabels].filter((label) => {
      // `N` is a number the page fills in: 「打印第 N 版」 is rendered as
      // `打印第 {draft.version} 版`.
      const pattern = label
        .split(" N ")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(String.raw`\s*\$?\{[^}]+\}\s*`);
      return !new RegExp(pattern).test(source);
    });

    expect(productSurfaceControlLabels.size).toBeGreaterThan(10);
    expect(missing).toEqual([]);
  });
});
