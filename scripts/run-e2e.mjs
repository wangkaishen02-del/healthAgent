import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url));
let exitCode = 1;
try {
  const child = spawn(process.execPath, [cli, "test", ...process.argv.slice(2)], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
} finally {
  await writeFile(new URL("../next-env.d.ts", import.meta.url), `/// <reference types="next" />
/// <reference types="next/image-types/global" />
import "./.next/types/routes.d.ts";

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`);
}

process.exitCode = exitCode;
