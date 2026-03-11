import { Type } from "@sinclair/typebox";
import type { BlaxelSandboxConfig } from "../config.js";
import { getSandbox } from "../sandbox.js";

export const readFileToolDef = {
  name: "sandbox_read_file",
  description:
    "Read a file from a Blaxel sandbox. " +
    "The sandbox filesystem is shared across sandbox_exec and sandbox_run_code.",
  parameters: Type.Object({
    sandboxName: Type.String({ description: "Name of the sandbox to use. Use separate names to isolate unrelated projects." }),
    path: Type.String({ description: "Absolute path to the file in the sandbox (e.g. '/home/app.py')." }),
  }),
};

export function createReadFileHandler(rawCfg: BlaxelSandboxConfig, logger?: any) {
  return async (_id: string, params: { sandboxName: string; path: string }) => {
    const sandbox = await getSandbox(rawCfg, logger, params.sandboxName);

    try {
      const content = await sandbox.fs.read(params.path);

      return {
        content: [{ type: "text" as const, text: content }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error reading file: ${err.message ?? err}` }],
        isError: true,
      };
    }
  };
}
