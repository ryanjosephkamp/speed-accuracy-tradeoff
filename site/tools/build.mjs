// Copies the page into a folder ready to deploy: index.html, css, js, data, fonts, img (the share
// card), and _headers. Leaves out site/tools and the README, and refuses to build if a PDF or any
// file outside those folders would ship.
//   node site/tools/build.mjs <out-dir>
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
if (!out) throw new Error("usage: node site/tools/build.mjs <out-dir>");
const SHIP = ["index.html", "_headers", "css", "js", "data", "fonts", "img"];
if (existsSync(out)) rmSync(out, { recursive: true });
mkdirSync(out, { recursive: true });
for (const name of SHIP) cpSync(join("site", name), join(out, name), { recursive: true });
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const files = walk(out);
const bad = files.filter((f) => /\.pdf$|\.tex$|\.py$|\.md$/i.test(f));
if (bad.length) throw new Error(`refusing to ship: ${bad.join(", ")}`);
const bytes = files.reduce((n, f) => n + statSync(f).size, 0);
console.log(`built ${files.length} files, ${(bytes / 1024).toFixed(0)} KB, into ${out}`);
