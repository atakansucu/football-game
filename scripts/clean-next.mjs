import { rmSync } from "node:fs";

// Next's development and production webpack caches can retain incompatible
// PostCSS module instances when both commands use the same .next directory.
// A clean build avoids registerPostcss/registerParse runtime failures without
// changing framework or styling dependency versions.
rmSync(".next", { recursive: true, force: true });
