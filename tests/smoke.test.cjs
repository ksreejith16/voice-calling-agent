const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function start(args, cwd, env) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-8000); });
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-8000); });
  return { child, output: () => output };
}
async function stop(service) {
  if (!service || service.child.exitCode !== null) return;
  const exited = new Promise(resolve => service.child.once('exit', resolve));
  service.child.kill('SIGTERM');
  await Promise.race([exited, delay(5000)]);
  if (service.child.exitCode === null) { service.child.kill('SIGKILL'); await exited; }
}
async function waitFor(url, service) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (service.child.exitCode !== null) throw new Error(`Service exited: ${service.output()}`);
    try { const response = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (response.ok) return response; } catch { /* starting */ }
    await delay(250);
  }
  throw new Error(`Service did not become available at ${url}: ${service.output()}`);
}

test('built API and Next.js start and serve real health, readiness, overview and setup responses', { timeout: 120000 }, async () => {
  const apiPort = await freePort(), webPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`, webUrl = `http://127.0.0.1:${webPort}`;
  let api, web;
  try {
    api = start([path.resolve('apps/api/dist/src/main.js')], process.cwd(), { NODE_ENV: 'test', API_HOST: '127.0.0.1', API_PORT: String(apiPort), WEB_ORIGIN: webUrl });
    const health = await waitFor(`${apiUrl}/health`, api);
    assert.equal((await health.json()).status, 'ok');
    const ready = await fetch(`${apiUrl}/ready`, { signal: AbortSignal.timeout(10000) });
    assert.equal(ready.status, 200, 'Migrate the local DB and start Redis before smoke testing');
    assert.deepEqual((await ready.json()).checks, { database: 'up', redis: 'up' });
    web = start([path.resolve('node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(webPort)], path.resolve('apps/web'), { NODE_ENV: 'production', API_INTERNAL_URL: apiUrl });
    const overview = await waitFor(webUrl, web);
    const html = await overview.text();
    assert.match(html, /Your workspace starts here/);
    assert.match(html, /Responding/);
    assert.match(html, /Awaiting review/);
    assert.doesNotMatch(html, /local_app_only|local_migrator_only|postgresql:\/\//);
    const setup = await fetch(`${webUrl}/setup`);
    assert.equal(setup.status, 200);
    assert.match(await setup.text(), /Voice implementation waits for your review/);
  } finally { await stop(web); await stop(api); }
});
