#!/usr/bin/env node
// Run integration test scripts and emit JUnit-style XML files per test
// Usage: node scripts/ci/run_tests_with_junit.js --outdir=artifacts/test-results

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function parseArg(name, defaultValue) {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  if (!arg) return defaultValue;
  return arg.split('=')[1];
}

(async function main() {
  const outDir = parseArg('outdir', 'artifacts/test-results');
  const testsDir = parseArg('testsdir', 'tests/integration');

  // ensure output dir exists
  fs.mkdirSync(outDir, { recursive: true });

  // find test files ending in .js in testsDir
  // Skip certain tests that have their own dedicated workflows or require special setup:
  // - dashboard_integration.test.js: Jest test meant to run via npm test
  // - db_init_test.js: Requires docker-compose with init-db volume mount (see db-init-tests.yml)
  const skipFiles = new Set([
    'dashboard_integration.test.js',
    'db_init_test.js'
  ]);
  const files = fs.readdirSync(testsDir)
    .filter(f => f.endsWith('.js') && !skipFiles.has(f));
  if (!files.length) {
    console.error('No integration tests found in', testsDir);
    process.exit(1);
  }

  let overallExit = 0;
  for (const file of files) {
    const scriptPath = path.join(testsDir, file);
    console.log(`Running ${scriptPath} ...`);

    const start = Date.now();
    // All files in tests/integration are Jest tests. Always run through Jest so globals
    // like describe/test/expect are available (some tests alias describe, e.g. describeDb).
    const child = spawn(
      'npx',
      ['jest', '--config=jest.config.integration.js', '--runInBand', '--testTimeout=60000', scriptPath],
      { env: process.env }
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', d => { process.stdout.write(d); stdout += d; });
    child.stderr.on('data', d => { process.stderr.write(d); stderr += d; });

    // Print a heartbeat every 15s while the test is running so CI logs show progress
    const startTime = Date.now();
    const heartbeatMs = 15000; // 15 seconds
    const hb = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`[progress] ${scriptPath} still running (${elapsed}s elapsed)`);
    }, heartbeatMs);

    const code = await new Promise(resolve => child.on('exit', resolve));
    clearInterval(hb);
    const duration = (Date.now() - start) / 1000.0;

    const testName = path.basename(file, '.js');
    const xml = makeJUnitXml(testName, file, duration, code, stdout, stderr);
    const outFile = path.join(outDir, `${testName}.xml`);
    fs.writeFileSync(outFile, xml, 'utf8');
    console.log(`Wrote JUnit XML: ${outFile}`);

    // Only report as error if non-zero exit code, unless test was skipped
    // (integration tests that require Docker may be skipped intentionally)
    if (code !== 0 && !stderr.includes('skipped')) overallExit = code;
  }

  process.exit(overallExit);
})();

function escapeXml(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function makeJUnitXml(testName, filename, duration, exitCode, stdout, stderr) {
  // Simple junit testsuite with one testcase
  const tests = 1;
  const failures = exitCode === 0 ? 0 : 1;
  const time = duration.toFixed(3);
  const stdoutEsc = escapeXml(stdout);
  const stderrEsc = escapeXml(stderr);

  let failureBlock = '';
  if (failures) {
    const message = escapeXml(`Exit code ${exitCode}`);
    const details = escapeXml((stderr || '') + '\n' + (stdout || ''));
    failureBlock = `<failure message="${message}"><![CDATA[${details}]]></failure>`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuite name="${escapeXml(testName)}" tests="${tests}" failures="${failures}" time="${time}">\n` +
    `  <testcase classname="integration" name="${escapeXml(filename)}" time="${time}">\n` +
    `    ${failureBlock}\n` +
    `    <system-out><![CDATA[${stdoutEsc}]]></system-out>\n` +
    `    <system-err><![CDATA[${stderrEsc}]]></system-err>\n` +
    `  </testcase>\n` +
    `</testsuite>\n`;
  return xml;
}
