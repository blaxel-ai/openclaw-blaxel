import { Type } from "@sinclair/typebox";
import type { BlaxelSandboxConfig } from "../config.js";
import { getSandbox } from "../sandbox.js";

export const writeFileToolDef = {
  name: "sandbox_write_file",
  description:
    "Write a file to a Blaxel sandbox. Creates parent directories automatically. " +
    "The sandbox filesystem is shared across sandbox_exec and sandbox_run_code.",
  parameters: Type.Object({
    sandboxName: Type.String({ description: "Name of the sandbox to use. Use separate names to isolate unrelated projects." }),
    path: Type.String({ description: "Absolute path in the sandbox (e.g. '/home/app.py')." }),
    content: Type.String({ description: "File content to write." }),
  }),
};

export function createWriteFileHandler(rawCfg: BlaxelSandboxConfig, logger?: any) {
  return async (_id: string, params: { sandboxName: string; path: string; content: string }) => {
    const sandbox = await getSandbox(rawCfg, logger, params.sandboxName);

    try {
      const dir = params.path.substring(0, params.path.lastIndexOf("/"));
      if (dir) {
        await sandbox.fs.mkdir(dir).catch(() => {});
      }

      await sandbox.fs.write(params.path, params.content);

      return {
        content: [{ type: "text" as const, text: `File written: ${params.path} (${params.content.length} bytes)` }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error writing file: ${err.message ?? err}` }],
        isError: true,
      };
    }
  };
}
