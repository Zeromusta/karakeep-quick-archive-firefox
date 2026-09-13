import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";

await build({
  entryPoints: ["content/page-capture.js"],
  outfile: "content/page-capture.bundle.js",
  bundle: true, format: "iife", platform: "browser", target: "firefox142",
  minify: false, legalComments: "inline"
});
await build({
  entryPoints: ["background/capture-processor.js"],
  outfile: "background/capture-processor.bundle.js",
  bundle: true, format: "iife", platform: "browser", target: "firefox142",
  minify: false, legalComments: "inline"
});
await mkdir("licenses", { recursive: true });
await copyFile("node_modules/single-file-core/LICENSE", "licenses/SingleFile-AGPL-3.0.txt");
