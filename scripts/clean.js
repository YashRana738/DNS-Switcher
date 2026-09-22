const { rmSync } = require("fs");

for (const dir of ["dist", "release"]) {
  try {
    rmSync(dir, { recursive: true, force: true });
    console.log("removed", dir);
  } catch (e) {
    console.error("failed to remove", dir, String(e));
  }
}
