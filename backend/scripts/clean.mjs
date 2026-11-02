// Remove build output folders given as arguments (cross-platform rm -rf).
import { rmSync } from 'fs';
for (const dir of process.argv.slice(2)) rmSync(dir, { recursive: true, force: true });
