import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkLabAssets(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await checkLabAssets(path);
    else if (/\.(js|json|html|map)$/.test(path)) {
      const source = await readFile(path, "utf8");
      if (/AIza[0-9A-Za-z_-]{35}/.test(source) || source.includes("excalidraw-oss-dev.firebaseapp.com")) {
        throw new Error("Upstream credential/configuration detected in " + path);
      }
    }
  }
}