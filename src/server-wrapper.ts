#!/usr/bin/env node

/**
 * Vesper Server Wrapper
 *
 * Global bin entry point that:
 * - Detects package installation location
 * - Sets proper working directory for Docker, data, config access
 * - Checks Docker services before starting
 * - Starts the MCP server with correct context
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
};

function error(message: string) {
  console.error(`${colors.red}❌ ${message}${colors.reset}`);
}

function warning(message: string) {
  console.error(`${colors.yellow}⚠️  ${message}${colors.reset}`);
}

function info(message: string) {
  console.error(`${colors.blue}ℹ️  ${message}${colors.reset}`);
}

function success(message: string) {
  console.error(`${colors.green}✅ ${message}${colors.reset}`);
}

/**
 * Detect package root directory
 * This could be ~/.vesper or a local installation
 */
function getPackageRoot(): string {
  // dist/server-wrapper.js -> package root
  return dirname(__dirname);
}

/**
 * Check if Docker is running
 */
function isDockerRunning(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a Docker service is running and healthy
 */
function checkDockerService(serviceName: string, packageRoot: string): {
  running: boolean;
  healthy: boolean;
  error?: string;
} {
  try {
    const output = execSync(
      `docker-compose ps --format json ${serviceName}`,
      {
        cwd: packageRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }
    );

    if (!output.trim()) {
      return { running: false, healthy: false, error: 'Service not found' };
    }

    const service = JSON.parse(output.trim().split('\n')[0]);
    const running = service.State === 'running';
    const healthy = service.Health === 'healthy' || service.Health === '';

    return { running, healthy };
  } catch (err) {
    return { running: false, healthy: false, error: (err as Error).message };
  }
}

/**
 * Check all required Docker services
 * Note: This is informational only - the server will gracefully degrade if services are unavailable
 */
function checkRequiredServices(packageRoot: string): {
  allHealthy: boolean;
  errors: string[];
} {
  const requiredServices = ['redis', 'qdrant', 'embedding'];
  const errors: string[] = [];

  info('Checking required services...');

  // Only check if docker-compose.yml exists in package root
  const dockerComposePath = join(packageRoot, 'docker-compose.yml');
  if (!existsSync(dockerComposePath)) {
    info('docker-compose.yml not found - assuming services managed externally');
    info('The server will connect to services at configured URLs');
    return {
      allHealthy: true, // Don't block - let the server try to connect
      errors: [],
    };
  }

  for (const service of requiredServices) {
    const status = checkDockerService(service, packageRoot);

    if (!status.running) {
      errors.push(
        `${service}: Not running${status.error ? ` (${status.error})` : ''}`
      );
    } else if (!status.healthy) {
      warning(`${service}: Running but not healthy yet (may still be starting)`);
    } else {
      success(`${service}: Running and healthy`);
    }
  }

  return {
    allHealthy: errors.length === 0,
    errors,
  };
}

/**
 * Main entry point
 */
async function main() {
  const packageRoot = getPackageRoot();

  // Verify server.js exists
  const serverPath = join(packageRoot, 'dist', 'server.js');
  if (!existsSync(serverPath)) {
    error(`Server not found at ${serverPath}`);
    error('The package may not be properly installed.');
    error('Try reinstalling: npm install -g vesper');
    process.exit(1);
  }

  // Note: docker-compose.yml is optional - services can be managed externally
  // The server will connect to services via environment variables

  // Set working directory to package root
  // This allows Docker Compose and the server to find config files, data, etc.
  process.chdir(packageRoot);
  info(`Working directory: ${packageRoot}`);

  // Check if Docker is running
  if (!isDockerRunning()) {
    error('Docker is not running');
    console.error('');
    console.error('Please start Docker Desktop and try again.');
    console.error('');
    console.error('After starting Docker, run:');
    console.error(`  cd ${packageRoot}`);
    console.error('  docker-compose up -d redis qdrant embedding');
    console.error('');
    process.exit(1);
  }

  // Check required services (informational only)
  const servicesCheck = checkRequiredServices(packageRoot);

  if (!servicesCheck.allHealthy && servicesCheck.errors.length > 0) {
    warning('Some services may not be running:');
    servicesCheck.errors.forEach((err) => console.error(`  • ${err}`));
    console.error('');
    info('The server will run in degraded mode without unavailable services');
    info('To start services, ensure Docker is running and:');
    console.error(`  cd ${packageRoot}`);
    console.error('  docker-compose up -d redis qdrant embedding');
    console.error('');
  }

  // All checks passed, start the server
  info('Starting Vesper MCP server...');

  // Import and run the server
  // The server will inherit the working directory we set
  await import(serverPath);
}

// Run with error handling
main().catch((err) => {
  error(`Failed to start server: ${err.message}`);
  console.error('');
  console.error('For help, visit: https://github.com/fitz2882/vesper/issues');
  process.exit(1);
});
