const path = require('node:path');
try { process.loadEnvFile(path.resolve(__dirname, '../.env')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const args = process.argv.slice(2);
// Next forwards CLI Node flags to build workers; load env programmatically so
// --env-file-if-exists is never copied into unsupported NODE_OPTIONS.
process.env.NODE_ENV = args[0] === 'dev' ? 'development' : 'production';
const nextBin = require.resolve('next/dist/bin/next');
process.argv = [process.execPath, nextBin, ...args];
require(nextBin);
