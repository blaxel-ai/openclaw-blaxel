import type { BlaxelSandboxConfig } from "./src/config.js";
import { resolveConfig } from "./src/config.js";
import { clearCachedSandbox, getSandbox } from "./src/sandbox.js";
import { execToolDef, createExecHandler } from "./src/tools/exec.js";
import { writeFileToolDef, createWriteFileHandler } from "./src/tools/write-file.js";
import { readFileToolDef, createReadFileHandler } from "./src/tools/read-file.js";
import { listFilesToolDef, createListFilesHandler } from "./src/tools/list-files.js";
import { runCodeToolDef, createRunCodeHandler } from "./src/tools/run-code.js";
import { createToolDef, createCreateHandler } from "./src/tools/create.js";
import { previewToolDef, createPreviewHandler } from "./src/tools/preview.js";
import { deleteToolDef, createDeleteHandler } from "./src/tools/delete.js";

export const id = "blaxel-sandbox";
export const name = "Blaxel Sandbox";

export function register(api: any) {
  const cfg: BlaxelSandboxConfig = api.config?.plugins?.entries?.["blaxel-sandbox"]?.config ?? {};
  const resolved = resolveConfig(cfg);
  const logger = api.logger;

  // -- Tools available in both modes (CodeInterpreter extends SandboxInstance) --

  api.registerTool({
    ...createToolDef,
    execute: createCreateHandler(cfg, logger),
  });

  api.registerTool({
    ...previewToolDef,
    execute: createPreviewHandler(cfg, logger),
  });

  api.registerTool({
    ...execToolDef,
    execute: createExecHandler(cfg, logger),
  });

  api.registerTool({
    ...writeFileToolDef,
    execute: createWriteFileHandler(cfg, logger),
  });

  api.registerTool({
    ...readFileToolDef,
    execute: createReadFileHandler(cfg, logger),
  });

  api.registerTool({
    ...listFilesToolDef,
    execute: createListFilesHandler(cfg, logger),
  });

  api.registerTool({
    ...deleteToolDef,
    execute: createDeleteHandler(logger),
  });

  // -- Interpreter-only: Jupyter code execution --

  if (resolved.mode === "interpreter") {
    api.registerTool({
      ...runCodeToolDef,
      execute: createRunCodeHandler(cfg, logger),
    });
  }

  // -- CLI --

  api.registerCli(
    ({ program }: any) => {
      const sandbox = program.command("sandbox").description("Blaxel Sandbox management");

      sandbox
        .command("status")
        .description("Show sandbox connection status")
        .requiredOption("-n, --name <name>", "Sandbox name")
        .action(async (opts: any) => {
          try {
            const sbx = await getSandbox(cfg, logger, opts.name);
            console.log(`Mode: ${resolved.mode}`);
            console.log(`Sandbox: "${opts.name}"`);

            const result = await sbx.fs.ls("/");
            console.log(`Root filesystem: ${(result.files?.length ?? 0) + (result.subdirectories?.length ?? 0)} entries`);
            console.log("Status: connected");
          } catch (err: any) {
            console.error(`Failed to connect: ${err.message ?? err}`);
            process.exit(1);
          }
        });

      sandbox
        .command("exec <command>")
        .description("Execute a shell command in a sandbox")
        .requiredOption("-n, --name <name>", "Sandbox name")
        .option("-d, --dir <dir>", "Working directory")
        .option("-t, --timeout <ms>", "Timeout in ms", "60000")
        .action(async (command: string, opts: any) => {
          try {
            const sbx = await getSandbox(cfg, logger, opts.name);
            const proc = await sbx.process.exec({
              command,
              workingDir: opts.dir,
              waitForCompletion: true,
              timeout: parseInt(opts.timeout, 10),
            });

            const response = proc as any;
            if (response.stdout) process.stdout.write(response.stdout);
            if (response.stderr) process.stderr.write(response.stderr);

            if (response.exitCode !== null && response.exitCode !== undefined && response.exitCode !== 0) {
              process.exit(response.exitCode);
            }
          } catch (err: any) {
            console.error(`Error: ${err.message ?? err}`);
            process.exit(1);
          }
        });

      sandbox
        .command("run <code>")
        .description("Run code via the Jupyter interpreter (interpreter mode only)")
        .requiredOption("-n, --name <name>", "Sandbox name")
        .option("-l, --language <lang>", "Language", "python")
        .action(async (code: string, opts: any) => {
          if (resolved.mode !== "interpreter") {
            console.error('The "run" command requires mode: "interpreter".');
            process.exit(1);
          }

          try {
            const { getInterpreter } = await import("./src/sandbox.js");
            const interpreter = await getInterpreter(cfg, logger, opts.name);
            const execution = await interpreter.runCode(code, {
              language: opts.language,
            });

            if (execution.logs.stdout.length) console.log(execution.logs.stdout.join(""));
            if (execution.logs.stderr.length) console.error(execution.logs.stderr.join(""));
            if (execution.error) {
              console.error(`${execution.error.name}: ${execution.error.value}`);
              process.exit(1);
            }
          } catch (err: any) {
            console.error(`Error: ${err.message ?? err}`);
            process.exit(1);
          }
        });

      sandbox
        .command("destroy")
        .description("Delete a sandbox")
        .requiredOption("-n, --name <name>", "Sandbox name")
        .action(async (opts: any) => {
          const { SandboxInstance } = await import("@blaxel/core");

          try {
            await SandboxInstance.delete(opts.name);
            clearCachedSandbox(opts.name);
            console.log(`Sandbox "${opts.name}" deleted.`);
          } catch (err: any) {
            console.error(`Failed to delete sandbox: ${err.message ?? err}`);
            process.exit(1);
          }
        });
    },
    { commands: ["sandbox"] },
  );

  // -- Background service --

  api.registerService({
    id: "blaxel-sandbox",
    start: () => logger?.info(`[blaxel-sandbox] Plugin loaded (mode: ${resolved.mode}).`),
    stop: () => {
      clearCachedSandbox();
      logger?.info("[blaxel-sandbox] Plugin stopped.");
    },
  });

  // -- Gateway RPC --

  api.registerGatewayMethod("sandbox.status", async ({ respond, params }: any) => {
    const sandboxName = params?.sandboxName;
    if (!sandboxName) {
      respond(false, { error: "sandboxName is required" });
      return;
    }

    try {
      const sbx = await getSandbox(cfg, logger, sandboxName);
      const result = await sbx.fs.ls("/");
      respond(true, {
        connected: true,
        mode: resolved.mode,
        sandboxName,
        rootEntries: (result.files?.length ?? 0) + (result.subdirectories?.length ?? 0),
      });
    } catch (err: any) {
      respond(false, { connected: false, error: err.message ?? String(err) });
    }
  });
}

export default { id, name, register };
