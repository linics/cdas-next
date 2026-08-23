import { assertAgentIdentityPrerequisites } from "./prerequisites";

void assertAgentIdentityPrerequisites(process.env)
  .then(() => {
    process.stdout.write(
      '{"schema":"staging-agent-acceptance-gate-assertion.v1","decision":"GO"}\n',
    );
  })
  .catch(() => {
    process.stdout.write(
      '{"schema":"staging-agent-acceptance-gate-assertion.v1","decision":"NO_GO"}\n',
    );
    process.exitCode = 1;
  });
