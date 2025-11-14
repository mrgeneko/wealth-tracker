const { execSync } = require('child_process');
try {
  const chromePath = '/opt/google/chrome/chrome';
  const result = execSync(`${chromePath} --version`).toString();
  console.log('Chrome-only test: success');
  console.log(result);
  process.exit(0);
} catch (e) {
  console.error('Chrome-only test: failed');
  console.error(e.message);
  process.exit(1);
}
