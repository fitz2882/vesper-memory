#!/usr/bin/env node

/**
 * Postinstall script for Vesper
 *
 * Automatically sets up the MCP server when installed via npm.
 * Skips setup during development (when installed in the source repo itself).
 */

import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, '..');

/**
 * Detect if we're running in development mode
 * (i.e., npm install run within the source repository)
 */
function isDevMode() {
  // Check if we have the source directory (src/)
  const hasSrcDir = existsSync(join(packageRoot, 'src'));

  // Check if we're inside node_modules
  const inNodeModules = packageRoot.includes('node_modules');

  // Development mode: has src/ and NOT in node_modules
  return hasSrcDir && !inNodeModules;
}

/**
 * Check if dist/ directory exists (package is built)
 */
function isBuilt() {
  return existsSync(join(packageRoot, 'dist', 'cli.js'));
}

async function main() {
  // Skip if we're in development mode
  if (isDevMode()) {
    console.log('📦 Vesper: Running in development mode, skipping auto-setup');
    console.log('💡 To manually install: npm run build && vesper install');
    return;
  }

  // Skip if not built yet
  if (!isBuilt()) {
    console.warn('⚠️  Vesper: Package not built yet, skipping auto-setup');
    console.warn('💡 Run "npm run build" first, then "vesper install"');
    return;
  }

  console.log('🌟 Vesper: Configuring MCP server...\n');

  // Run the CLI configure command (sets up MCP config only)
  const cliPath = join(packageRoot, 'dist', 'cli.js');

  return new Promise((resolve, reject) => {
    const child = spawn('node', [cliPath, 'configure'], {
      stdio: 'inherit',
      cwd: packageRoot,
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log('\n✅ Vesper MCP configuration complete!');
        console.log('💡 Next: Start Docker services and restart Claude Code');
        console.log('   Run "vesper install" for full automated setup\n');
        resolve();
      } else {
        console.error('\n❌ Vesper configuration failed');
        console.error('💡 Try running manually: vesper configure\n');
        // Don't reject - postinstall failures shouldn't break npm install
        resolve();
      }
    });

    child.on('error', (err) => {
      console.error('❌ Failed to run installer:', err.message);
      console.error('💡 Try running manually: vesper install\n');
      // Don't reject - postinstall failures shouldn't break npm install
      resolve();
    });
  });
}

main().catch((err) => {
  console.error('❌ Postinstall error:', err);
  // Exit 0 to not break npm install
  process.exit(0);
});
