import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const version = process.argv[2] || "0.2.1";

const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

const indexPath = path.join(root, "lib", "index.js");
let source = fs.readFileSync(indexPath, "utf8");
source = source.replace(/version: "\d+\.\d+\.\d+"/g, `version: "${version}"`);
fs.writeFileSync(indexPath, source, "utf8");

const healthLine = /version: "[\d.]+"/.exec(fs.readFileSync(indexPath, "utf8"));
console.log(`pkg=${JSON.parse(fs.readFileSync(pkgPath, "utf8")).version} health=${healthLine ? healthLine[0] : "?"}`);
