import { assertAgentBrowserPrerequisites } from "./prerequisites";
void assertAgentBrowserPrerequisites(process.env).then(()=>process.stdout.write('{"schema":"staging-agent-acceptance-browser-prerequisites.v1","decision":"GO"}\n')).catch(()=>{process.stdout.write('{"schema":"staging-agent-acceptance-browser-prerequisites.v1","decision":"NO_GO"}\n');process.exitCode=1;});
