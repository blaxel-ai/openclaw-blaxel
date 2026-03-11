import { Type } from "@sinclair/typebox";
import type { BlaxelSandboxConfig } from "../config.js";
import { resolveConfig } from "../config.js";
import { getSandbox } from "../sandbox.js";

export const listFilesToolDef = {
  name: "sandbox_list_files",
  description:
    "List files and directories at a given path in a Blaxel sandbox. " +
    "The sandbox filesystem is shared across sandbox_exec and sandbox_run_code.",
  parameters: Type.Object({
    sandboxName: Type.String({ description: "Name of the sandbox to use. Use separate names to isolate unrelated projects." }),
    path: Type.Optional(
      Type.String({ description: "Absolute path to list. Defaults to /home." }),
    ),
  }),
};

export function createListFilesHandler(rawCfg: BlaxelSandboxConfig, logger?: any) {
  const cfg = resolveConfig(rawCfg);

  return async (_id: string, params: { sandboxName: string; path?: string }) => {
    const sandbox = await getSandbox(rawCfg, logger, params.sandboxName);
    const targetPath = params.path ?? cfg.workingDir;

    try {
      const result = await sandbox.fs.ls(targetPath);

      const lines: string[] = [];

      if (result.subdirectories?.length) {
        for (const dir of result.subdirectories) {
          lines.push(`[dir]  ${dir.name}/`);
        }
      }

      if (result.files?.length) {
        for (const file of result.files) {
          lines.push(`[file] ${file.name} (${file.size} bytes)`);
        }
      }

      if (!lines.length) {
        return { content: [{ type: "text" as const, text: `(empty directory: ${targetPath})` }] };
      }

      return {
        content: [{ type: "text" as const, text: `Contents of ${targetPath}:\n${lines.join("\n")}` }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text" as const, text: `Error listing files: ${err.message ?? err}` }],
        isError: true,
      };
    }
  };
}
