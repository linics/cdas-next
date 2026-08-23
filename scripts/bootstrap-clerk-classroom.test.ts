import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("Clerk bootstrap executable environment", () => {
  it("loads the documented root .env before resolving the database target", async () => {
    const projectRoot = fileURLToPath(new URL("..", import.meta.url));
    const tsxLoader = import.meta.resolve("tsx");
    const workingDirectory = await mkdtemp(
      `${tmpdir()}/cdas-bootstrap-environment-`,
    );
    temporaryDirectories.push(workingDirectory);
    await writeFile(
      `${workingDirectory}/.env`,
      "DATABASE_URL=postgresql://operator:secret@127.0.0.1:5432/cdas_from_env\n",
      "utf8",
    );

    await expect(
      execFileAsync(
        process.execPath,
        [
          "--import",
          tsxLoader,
          `${projectRoot}/scripts/bootstrap-clerk-classroom.ts`,
          "--teacher-subject",
          "user_teacher123",
          "--teacher-name",
          "Teacher",
          "--student-subject",
          "user_student123",
          "--student-name",
          "Student",
          "--classroom-id",
          "10000000-0000-4000-8000-000000000001",
          "--classroom-name",
          "Classroom",
          "--confirm-database",
          "intentionally_wrong",
        ],
        {
          cwd: workingDirectory,
          env: {
            NODE_ENV: "test",
            PATH: process.env.PATH,
            NODE_NO_WARNINGS: "1",
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("DATABASE_CONFIRMATION_MISMATCH"),
    });
  });
});
