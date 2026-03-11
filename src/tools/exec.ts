import { Type } from "@sinclair/typebox";
import type { BlaxelSandboxConfig } from "../config.js";
import { resolveConfig } from "../config.js";
import { getSandbox } from "../sandbox.js";

export const execToolDef = {
  name: "sandbox_exec",
  description:
    "Execute a shell command in a Blaxel sandbox (a persistent, network-accessible micro VM). " +
    "The sandbox filesystem and installed packages persist across calls, but shell variables do not. " +
    "Use for: installing packages, running scripts, builds, starting dev servers. " +
    "To expose ports for web servers, create the sandbox first with sandbox_create. " +
    "For iterative coding where variables and imports persist across calls, use sandbox_run_code instead.",
  parameters: Type.Object({
    sandboxName: Type.String({ description: "Name of the sandbox to use. Use separate names to isolate unrelated projects." }),
    command: Type.String({ description: "The shell command to execute." }),
    workingDir: Type.Optional(
      Type.String({ description: "Working directory for the command. Defaults to /home." }),
    ),
    envs: Type.Optional(
      Type.Record(Type.String(), Type.String(), { description: "Environment variables for this command (e.g. {\"NODE_ENV\": \"production\", \"PORT\": \"3000\"})." }),
    ),
    timeout: Type.Optional(
      Type.Number({ description: "Timeout in milliseconds. Defaults to 60000." }),
    ),
  }),
};

export function createExecHandler(rawCfg: BlaxelSandboxConfig, logger?: any) {
  const cfg = resolveConfig(rawCfg);

  return async (_id: string, params: {
    sandboxName: string;
    command: string;
    workingDir?: string;
    envs?: Record<string, string>;
    timeout?: number;
  }) => {
    const sandbox = await getSandbox(rawCfg, logger, params.sandboxName);
    const timeout = params.timeout ?? cfg.execTimeout;
    const workingDir = params.workingDir ?? cfg.workingDir;

    try {
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      const proc = await sandbox.process.exec({
        command: params.command,
        workingDir,
        waitForCompletion: true,
        timeout,
        ...(params.envs ? { env: params.envs } : {}),
        onStdout: (chunk: string) => stdoutChunks.push(chunk),
        onStderr: (chunk: string) => stderrChunks.push(chunk),
      });

      const response = proc as any;
      const stdout = stdoutChunks.join("") || response.stdout || "";
      const stderr = stderrChunks.join("") || response.stderr || "";
      const exitCode = response.exitCode ?? null;

      let output = "";
      if (stdout) output += stdout;
      if (stderr) output += (output ? "\n--- stderr ---\n" : "") + stderr;
      if (!output) output = `(no output, exit code: ${exitCode})`;
      if (exitCode !== null && exitCode !== 0) {
        output += `\n[exit code: ${exitCode}]`;
      }

      return { content: [{ type: "text" as const, text: output }] };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error executing command: ${err.message ?? err}` }],
        isError: true,
      };
    }
  };
}
