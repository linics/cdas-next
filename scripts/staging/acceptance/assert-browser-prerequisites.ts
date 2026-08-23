import { assertBrowserPrerequisites } from "./prerequisites";

void assertBrowserPrerequisites(process.env).then(() => {
  process.stdout.write('{"schema":"staging-synthetic-acceptance-browser-prerequisites.v1","decision":"GO"}\n');
}).catch(() => {
  process.stdout.write('{"schema":"staging-synthetic-acceptance-browser-prerequisites.v1","decision":"NO_GO"}\n');
  process.exitCode = 1;
});
