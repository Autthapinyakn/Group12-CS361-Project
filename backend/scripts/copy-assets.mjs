// Copy runtime files that tsc does not emit (the RDS CA bundle) into dist/.
import { cpSync } from 'fs';
cpSync('certs', 'dist/certs', { recursive: true });
console.log('copied certs -> dist/certs');
