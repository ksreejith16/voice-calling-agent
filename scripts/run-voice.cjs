const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const python = path.join(root, 'apps/voice-worker/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!existsSync(python)) {
  console.error('Install the voice worker virtual environment first; see apps/voice-worker/README.md.');
  process.exit(1);
}
const child = spawn(python, ['-u', '-m', 'india_voice.worker', 'start'], { cwd: root, stdio: 'inherit', windowsHide: true });
child.on('error', () => { console.error('Could not launch the voice worker.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
