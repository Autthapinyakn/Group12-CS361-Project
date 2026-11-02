// Build lambda.zip with compiled code + production dependencies only (no TypeScript, no tests).
// Upload it to the Lambda function; handler = functions/api.handler.
import { cpSync, rmSync, mkdirSync, statSync } from 'fs';
import { execSync } from 'child_process';

const stage = '.package';
rmSync(stage, { recursive: true, force: true });
rmSync('lambda.zip', { force: true });
mkdirSync(stage);
cpSync('dist', stage, { recursive: true });
cpSync('package.json', `${stage}/package.json`);
cpSync('package-lock.json', `${stage}/package-lock.json`);
execSync('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', { cwd: stage, stdio: 'inherit' });
// Windows 10+ ships bsdtar, which writes zip archives with -a; Linux/CloudShell has zip.
const cmd = process.platform === 'win32' ? 'tar -a -c -f ../lambda.zip *' : 'zip -qr ../lambda.zip .';
execSync(cmd, { cwd: stage, stdio: 'inherit', shell: true });
rmSync(stage, { recursive: true, force: true });
console.log(`lambda.zip ${(statSync('lambda.zip').size / 1024).toFixed(0)} KB`);
