const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const manifestPath = path.join(rootDir, 'manifest.json');
const manifestOriginal = fs.readFileSync(manifestPath, 'utf8');

try {
  const manifest = JSON.parse(manifestOriginal);
  // Add scripts fallback for Firefox AMO package
  manifest.background = {
    service_worker: 'background.js',
    scripts: ['background.js']
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const action = process.argv[2] || 'build';
  if (action === 'lint') {
    execSync('npx web-ext lint', { stdio: 'inherit', cwd: rootDir });
  } else {
    execSync('npx web-ext build --overwrite-dest', { stdio: 'inherit', cwd: rootDir });
  }
} finally {
  // Always restore the clean, error-free Chrome Manifest V3 configuration
  fs.writeFileSync(manifestPath, manifestOriginal);
}
