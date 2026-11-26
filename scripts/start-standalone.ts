/**
 * `npm run start`: serves the production build the way the runner image does,
 * with `.next/standalone/server.js` (`next start` does not support
 * `output: "standalone"`). Run it after `npm run build`. The server reads
 * `PORT` and `HOSTNAME` from the environment.
 */
import { existsSync } from "node:fs";
import { cp } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const STANDALONE = resolve(".next/standalone");

// The standalone output does not copy the static assets; the Dockerfile
// `runner` stage copies the same two folders.
await cp(resolve(".next/static"), resolve(STANDALONE, ".next/static"), {
  recursive: true,
});
if (existsSync("public")) {
  await cp(resolve("public"), resolve(STANDALONE, "public"), {
    recursive: true,
  });
}

await import(pathToFileURL(resolve(STANDALONE, "server.js")).href);
