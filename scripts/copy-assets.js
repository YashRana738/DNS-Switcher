const { cpSync, mkdirSync } = require("fs");
const { join } = require("path");

const root = join(__dirname, "..");
mkdirSync(join(root, "dist", "renderer"), { recursive: true });
for (const f of ["index.html", "styles.css", "notify.html", "notify.css"]) {
  try {
    cpSync(join(root, "src", "renderer", f), join(root, "dist", "renderer", f));
    console.log("copied", f);
  } catch (e) {
    console.error("copy failed for", f, String(e));
    process.exit(1);
  }
}
mkdirSync(join(root, "dist", "assets"), { recursive: true });
try {
  cpSync(join(root, "assets"), join(root, "dist", "assets"), { recursive: true });
} catch {
  /* assets optional */
}
