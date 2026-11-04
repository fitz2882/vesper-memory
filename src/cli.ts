#!/usr/bin/env node

/**
 * Vesper CLI
 *
 * Command-line interface for installing and managing Vesper
 */

import { execFileSync, execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, copyFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { createInterface } from 'readline';
import { getSqlitePath, getVesperHome, ensureDirectories } from './utils/paths.js';
import { buildVesperServerEnv, registerClaudeMcpServer } from './utils/claude-mcp-config.js';
import {
  CodexConfigError,
  codexAgentsPath,
  codexConfigPath,
  getCodexHome,
  hasCodexServer,
  hasUnmanagedVesperRules,
  installCodexRules,
  installCodexServer,
  parseClients,
  uninstallCodexRules,
  uninstallCodexServer,
  type FileChange,
  type McpClient,
} from './utils/codex-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Installation directory
const INSTALL_DIR = process.env.VESPER_INSTALL_DIR || join(homedir(), '.vesper');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function header(message: string) {
  log(`\n${message}`, colors.bright + colors.cyan);
}

function success(message: string) {
  log(`✅ ${message}`, colors.green);
}

function error(message: string) {
  log(`❌ ${message}`, colors.red);
}

function warning(message: string) {
  log(`⚠️  ${message}`, colors.yellow);
}

function info(message: string) {
  log(`ℹ️  ${message}`, colors.blue);
}

// Generate secure random password
function generatePassword(): string {
  return randomBytes(32).toString('base64');
}

// Check if Docker is running
function reportFileChange(change: FileChange, what: string) {
  if (change.status === 'unchanged') {
    success(`${what} already up to date (${change.path})`);
  } else if (change.status === 'absent') {
    info(`${what}: nothing to remove in ${change.path}`);
  } else {
    success(`${what} ${change.status} (${change.path})`);
  }
  if (change.backupPath) info(`Previous version saved to ${change.backupPath}`);
}

function commandExists(command: string): boolean {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Register Vesper with Codex by editing only the [mcp_servers.vesper] table of config.toml
function configureCodex(serverPath: string, environment: Record<string, string>) {
  info('Configuring Codex MCP integration...');
  const codexHome = getCodexHome();
  if (!existsSync(codexHome) && !commandExists('codex')) {
    warning(`Codex not detected (no ${codexHome} and no codex on PATH); writing its config anyway`);
  }
  try {
    reportFileChange(installCodexServer({ serverPath, environment }, codexHome), 'Codex MCP config');
  } catch (err) {
    if (err instanceof CodexConfigError) {
      error(err.message);
      error(`Codex config: ${codexConfigPath(codexHome)}`);
    }
    throw err;
  }
}

function claudeCliOrExit() {
  if (!commandExists('claude')) {
    error('Claude Code CLI not found in PATH');
    error('Please install Claude Code from: https://claude.ai/download');
    error('To set up only Codex, run the command again with --client codex');
    throw new Error('Claude CLI not found');
  }
}

function checkDocker(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Install Vesper
async function install(clients: McpClient[]) {
  header('🌟 Installing Vesper - AI Memory System for coding agents');

  // Check prerequisites
  info('Checking prerequisites...');

  // Fail before any setup work if the Claude Code CLI is needed but missing
  if (clients.includes('claude')) claudeCliOrExit();

  try {
    execSync('node --version', { stdio: 'ignore' });
    success('Node.js found');
  } catch {
    error('Node.js 20+ required. Install from https://nodejs.org');
    process.exit(1);
  }

  if (!checkDocker()) {
    error('Docker not running. Please start Docker Desktop');
    process.exit(1);
  }
  success('Docker found');

  // Create installation directory and user-level data directories
  info(`Installing to ${INSTALL_DIR}...`);

  if (existsSync(INSTALL_DIR)) {
    warning(`Directory ${INSTALL_DIR} already exists`);
    info('Updating existing installation...');
  } else {
    mkdirSync(INSTALL_DIR, { recursive: true });
  }

  // Create user-level data directories (~/.vesper/data, ~/.vesper/docker-data, etc.)
  info('Creating user-level data directories...');
  try {
    ensureDirectories();
    success(`Data directories created at ${getVesperHome()}`);
  } catch (err) {
    error(`Failed to create data directories: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }

  // Copy files from npm package to install directory
  const packageRoot = join(__dirname, '..');

  info('Copying files...');
  const filesToCopy = [
    'dist',
    'config',
    'embedding-service',
    'scripts',
    'docker-compose.yml',
    '.env.example',
    'package.json',
  ];

  for (const file of filesToCopy) {
    const src = join(packageRoot, file);
    const dest = join(INSTALL_DIR, file);

    if (existsSync(src)) {
      cpSync(src, dest, { recursive: true });
    }
  }
  success('Files copied');

  // Create .env if it doesn't exist
  const envFile = join(INSTALL_DIR, '.env');
  if (!existsSync(envFile)) {
    info('Creating .env configuration...');
    cpSync(join(INSTALL_DIR, '.env.example'), envFile);
    success('.env created');
  }

  // Install dependencies in install directory
  info('Installing dependencies...');
  try {
    execSync('npm install --production --silent', {
      cwd: INSTALL_DIR,
      stdio: 'inherit',
    });
    success('Dependencies installed');
  } catch (err) {
    error('Failed to install dependencies');
    throw err;
  }

  // Start Docker services (3 services: redis, qdrant, embedding)
  info('Starting infrastructure services...');
  try {
    execSync('docker-compose up -d', {
      cwd: INSTALL_DIR,
      stdio: 'inherit',
    });
    success('Services started (redis, qdrant, embedding)');
  } catch (err) {
    error('Failed to start services');
    throw err;
  }

  // Wait for services
  info('Waiting for services to be ready...');
  await new Promise(resolve => setTimeout(resolve, 10000));

  const serverPath = join(INSTALL_DIR, 'dist', 'server.js');

  if (clients.includes('codex')) {
    configureCodex(serverPath, { NODE_ENV: 'production' });
  }

  if (clients.includes('claude')) {
    installClaude(serverPath);
  }

  // Success message
  header('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  success('✨ Vesper installation complete!');
  header('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const clientNames = clients.map((c) => (c === 'claude' ? 'Claude Code' : 'Codex')).join(' and ');
  log('\n🎯 Next steps:', colors.bright);
  log(`   1. Restart ${clientNames} to load Vesper`);
  log(`   2. Run: vesper init --client ${clients.length > 1 ? 'all' : clients[0]}   (memory usage rules)`);
  log('   3. Test it: "Store a memory: I love TypeScript"');

  log('\n📖 Documentation:', colors.bright);
  log(`   • Installation: ${INSTALL_DIR}`);
  if (clients.includes('claude')) log(`   • View Claude Code config: claude mcp get vesper`);
  if (clients.includes('codex')) log(`   • View Codex config: ${codexConfigPath()} ([mcp_servers.vesper])`);
  log(`   • Logs: cd ${INSTALL_DIR} && docker-compose logs`);

  log('\n💡 Tip: Ask your agent to "store a memory" to test!\n');
}

// Register Vesper with Claude Code and add its SessionStart hook
function installClaude(serverPath: string) {
  // Configure MCP using the official claude CLI
  info('Configuring Claude Code MCP integration...');

  // Remove old MCP server if it exists (to ensure clean install)
  try {
    execSync('claude mcp remove vesper', { stdio: 'ignore' });
  } catch {
    // Ignore errors if server doesn't exist
  }

  // Add Vesper using the proper claude mcp add command
  try {
    execSync(
      `claude mcp add vesper --transport stdio --scope user -e NODE_ENV=production -- node "${serverPath}"`,
      { stdio: 'inherit' }
    );
    success('MCP server configured successfully');
  } catch (err) {
    error('Failed to configure Vesper MCP server');
    error(`You can manually configure it later with:`);
    error(`claude mcp add vesper --transport stdio --scope user -e NODE_ENV=production -- node "${serverPath}"`);
    throw err;
  }

  // Configure startup hook (optional - ensures Docker services are running)
  info('Configuring startup hook...');

  const settingsPath = join(homedir(), '.claude', 'settings.json');
  let settings: any = { hooks: {} };

  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch (err) {
      warning('Could not parse settings.json, creating new one');
      settings = { hooks: {} };
    }
  }

  // Ensure hooks structure exists
  settings.hooks = settings.hooks || {};
  settings.hooks.SessionStart = settings.hooks.SessionStart || [];

  // Add or update Vesper startup hook (just for Docker services)
  const hookScript = join(INSTALL_DIR, 'scripts', 'ensure-infrastructure.sh');
  const vesperHook = {
    description: 'Ensure Vesper memory infrastructure is running',
    hooks: [{
      type: 'command',
      command: `if [ -f ${hookScript} ]; then ${hookScript} 2>&1; fi`,
      continueOnError: true
    }]
  };

  // Remove any existing Vesper hooks and add new one
  settings.hooks.SessionStart = settings.hooks.SessionStart.filter(
    (h: any) => !h.description?.includes('Vesper') && !h.description?.includes('memory infrastructure')
  );
  settings.hooks.SessionStart.push(vesperHook);

  // Ensure directory exists
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  success('Startup hook configured');
  info('Note: Permissions are handled automatically by claude mcp add');
}

// Uninstall Vesper
async function uninstall() {
  header('🗑️  Uninstalling Vesper');

  if (!existsSync(INSTALL_DIR)) {
    warning('Vesper not installed');
    return;
  }

  // Stop services
  info('Stopping services...');
  try {
    execSync('docker-compose down -v', {
      cwd: INSTALL_DIR,
      stdio: 'inherit',
    });
    success('Services stopped');
  } catch {
    warning('Could not stop services (may not be running)');
  }

  // Remove from MCP config using claude CLI
  info('Removing from MCP config...');
  try {
    execSync('claude mcp remove vesper', { stdio: 'inherit' });
    success('Removed from MCP config');
  } catch {
    warning('Could not remove from MCP config (may not be configured)');
  }

  // Remove the Codex registration and managed rules, if any, so Codex does not launch a deleted server
  for (const [label, remove] of [
    ['Codex MCP config', uninstallCodexServer],
    ['Codex rules in AGENTS.md', uninstallCodexRules],
  ] as const) {
    try {
      const change = remove();
      if (change.status !== 'absent') reportFileChange(change, label);
    } catch (err) {
      warning(`Could not update ${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Remove startup hook
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  if (existsSync(settingsPath)) {
    info('Removing startup hook...');
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      if (settings.hooks?.SessionStart) {
        settings.hooks.SessionStart = settings.hooks.SessionStart.filter(
          (h: any) => !h.description?.includes('Vesper') && !h.description?.includes('memory infrastructure')
        );
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        success('Startup hook removed');
      }
    } catch (err) {
      warning('Could not update settings.json');
    }
  }

  // Remove installation directory
  info('Removing files...');
  try {
    rmSync(INSTALL_DIR, { recursive: true, force: true });
    success('Files removed');
  } catch (err) {
    error(`Failed to remove ${INSTALL_DIR}: ${err instanceof Error ? err.message : String(err)}`);
  }

  log('\n✅ Vesper uninstalled successfully\n');
  info('Restart Claude Code or Codex to complete removal');
}

// Load environment variables from .env file
// If .env doesn't exist, create it from .env.example with secure generated passwords
function loadEnvFile(packageRoot: string): Record<string, string> {
  const envPath = join(packageRoot, '.env');
  const envExamplePath = join(packageRoot, '.env.example');

  let envContent: string;
  let shouldGeneratePasswords = false;

  if (!existsSync(envPath)) {
    if (existsSync(envExamplePath)) {
      info('Creating .env from .env.example...');
      envContent = readFileSync(envExamplePath, 'utf-8');
      shouldGeneratePasswords = true;
    } else {
      warning('.env and .env.example not found, using default values');
      return {};
    }
  } else {
    envContent = readFileSync(envPath, 'utf-8');
  }

  const env: Record<string, string> = {};

  // Parse environment variables
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        env[key.trim()] = value.trim();
      }
    }
  }

  // Generate secure passwords if creating new .env
  if (shouldGeneratePasswords) {
    info('Generating secure passwords...');

    const redisPassword = generatePassword();
    const qdrantKey = generatePassword();
    const postgresPassword = generatePassword();

    // Replace placeholder passwords in content
    envContent = envContent.replace(
      /REDIS_PASSWORD=.*/,
      `REDIS_PASSWORD=${redisPassword}`
    );
    envContent = envContent.replace(
      /QDRANT_API_KEY=.*/,
      `QDRANT_API_KEY=${qdrantKey}`
    );
    envContent = envContent.replace(
      /POSTGRES_PASSWORD=.*/,
      `POSTGRES_PASSWORD=${postgresPassword}`
    );

    // Write new .env file
    writeFileSync(envPath, envContent);
    success('.env created with secure passwords');

    // Update env object with generated passwords
    env.REDIS_PASSWORD = redisPassword;
    env.QDRANT_API_KEY = qdrantKey;
    env.POSTGRES_PASSWORD = postgresPassword;
  }

  return env;
}

// Configure MCP only (no Docker services)
async function configure(clients: McpClient[]) {
  header('⚙️  Configuring Vesper MCP Server');

  // Determine package location (could be in node_modules or ~/.vesper)
  const packageRoot = dirname(dirname(__filename));
  const serverPath = join(packageRoot, 'dist', 'server.js');

  if (!existsSync(serverPath)) {
    error(`Server not found at ${serverPath}`);
    error('Run "npm run build" first');
    process.exit(1);
  }

  info('Loading environment configuration...');
  const envVars = loadEnvFile(packageRoot);

  // Ensure user-level data directories exist
  try {
    ensureDirectories();
  } catch (err) {
    warning(`Could not create data directories: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Resolve SQLite DB path: use env var if set, otherwise user-level path
  // New default: ~/.vesper/data/memory.db (not ./data/memory.db)
  let absoluteSqliteDb: string;
  if (envVars.SQLITE_DB) {
    // Explicit env var - resolve relative to package root if needed
    absoluteSqliteDb = envVars.SQLITE_DB.startsWith('/')
      ? envVars.SQLITE_DB
      : envVars.SQLITE_DB === ':memory:'
        ? ':memory:'
        : join(packageRoot, envVars.SQLITE_DB);
  } else {
    // Default to user-level storage
    absoluteSqliteDb = getSqlitePath();
  }

  if (clients.includes('codex')) {
    configureCodex(serverPath, buildVesperServerEnv(envVars, absoluteSqliteDb));
  }

  if (clients.includes('claude')) {
    info('Configuring Claude Code MCP integration...');
    claudeCliOrExit();

    // Remove old MCP server if it exists (to ensure clean install)
    try {
      execFileSync('claude', ['mcp', 'remove', 'vesper'], { stdio: 'ignore' });
    } catch {
      // Ignore errors if server doesn't exist
    }

    try {
      registerClaudeMcpServer(envVars, absoluteSqliteDb, serverPath);
      success('MCP server configured successfully');
    } catch (err) {
      error('Failed to configure Vesper MCP server');
      error('Correct the configuration and run vesper configure again.');
      throw err;
    }
    info('Permissions are handled automatically by claude mcp add');
  }

  log(`\n📍 Server path: ${serverPath}`);
  log(`📁 Package root: ${packageRoot}`);

  success('✨ Vesper MCP server configured!');
  log('\n🎯 Next steps:', colors.bright);
  log('   1. Ensure Docker services are running:');
  log(`      cd ${packageRoot} && docker-compose up -d`);
  log(`   2. Restart ${clients.map((c) => (c === 'claude' ? 'Claude Code' : 'Codex')).join(' and ')} to load Vesper`);
  log('   3. Test: Ask "What MCP servers are available?"\n');
}

// Enable Vesper
async function enableVesper() {
  header('✅ Enabling Vesper Memory System');

  if (!existsSync(INSTALL_DIR)) {
    error('Vesper not installed');
    log('\nRun: vesper install');
    return;
  }

  // Re-run configure to enable (this will add the MCP server)
  info('Reconfiguring Vesper to enable...');
  await configure(['claude']);

  log('\n💡 Restart Claude Code for changes to take effect\n');
}

// Disable Vesper
async function disableVesper() {
  header('⏸️  Disabling Vesper Memory System');

  // Remove the MCP server to disable it
  info('Removing Vesper MCP server...');
  try {
    execSync('claude mcp remove vesper', { stdio: 'inherit' });
    success('Vesper memory system disabled');
  } catch {
    warning('Vesper not configured or already disabled');
  }

  log('\n📊 Useful for benchmarking or debugging');
  log('💡 Run "vesper enable" to re-enable');
  log('💡 Restart Claude Code for changes to take effect\n');
}

// Show status
function status() {
  header('📊 Vesper Status');

  // Check installation
  log(`\n📁 Installation: ${INSTALL_DIR}`);
  if (existsSync(INSTALL_DIR)) {
    success('Installed');
  } else {
    error('Not installed');
    log('\nRun: vesper install');
    return;
  }

  // Check user-level data directory
  const vesperHome = getVesperHome();
  log(`\n📂 Data Directory: ${vesperHome}`);
  if (existsSync(vesperHome)) {
    success('Data directory exists');

    // Check for SQLite database
    const sqlitePath = getSqlitePath();
    if (existsSync(sqlitePath)) {
      try {
        const stats = statSync(sqlitePath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        success(`SQLite database: ${sizeMB} MB`);
      } catch {
        success('SQLite database exists');
      }
    } else {
      info('SQLite database: not yet created (will be created on first use)');
    }

    // Check for old data that could be migrated
    const oldDataPath = join(INSTALL_DIR, 'data', 'memory.db');
    if (existsSync(oldDataPath) && oldDataPath !== sqlitePath) {
      warning('Old data found at installation directory');
      info('Run "vesper migrate" to move data to user-level storage');
    }
  } else {
    warning('Data directory not created yet');
    info('Run "vesper configure" or "vesper install" to create');
  }

  // Check MCP config using claude CLI
  log('\n🤖 MCP Configuration:');
  try {
    const output = execSync('claude mcp get vesper', { encoding: 'utf-8', stdio: 'pipe' });
    if (output.includes('"vesper"') || output.toLowerCase().includes('vesper')) {
      success('Configured in Claude Code');
      success('Memory system: ENABLED');
    } else {
      warning('Not configured in Claude Code');
      log('   Run "vesper configure" to set up');
    }
  } catch {
    warning('Not configured in Claude Code');
    log('   Run "vesper configure" to set up');
  }

  const codexConfig = codexConfigPath();
  if (existsSync(codexConfig) && hasCodexServer(readFileSync(codexConfig, 'utf-8'))) {
    success(`Configured in Codex (${codexConfig})`);
  } else if (existsSync(getCodexHome())) {
    info('Not configured in Codex. Run "vesper configure --client codex" to set up');
  }

  // Check services
  log('\n🐳 Docker Services:');
  if (checkDocker()) {
    try {
      const output = execSync('docker-compose ps --format json', {
        cwd: INSTALL_DIR,
        encoding: 'utf-8',
      });

      const services = output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));

      for (const service of services) {
        if (service.State === 'running') {
          success(`${service.Service}: running`);
        } else {
          warning(`${service.Service}: ${service.State}`);
        }
      }
    } catch {
      warning('Could not check service status');
    }
  } else {
    error('Docker not running');
  }

  log('');
}

// Helper function to prompt for user confirmation
function promptConfirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`${question} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

const RULE_FILES = ['vesper.md', 'memory-discipline.md'];

// Locate the packaged rule files, exiting if the installation is broken
function ruleSourceDir(): string {
  const sourceDir = join(__dirname, '..', 'config', 'claude-rules');
  for (const file of RULE_FILES) {
    if (!existsSync(join(sourceDir, file))) {
      error(`Source rule file not found: ${join(sourceDir, file)}`);
      error('This may indicate a broken installation. Try reinstalling vesper-memory.');
      process.exit(1);
    }
  }
  return sourceDir;
}

// Initialize agent rules for optimal Vesper usage
async function initRules(clients: McpClient[]) {
  if (clients.includes('claude')) await initClaudeRules();
  if (clients.includes('codex')) await initCodexRules();
}

// Put the rules in a marked block of $CODEX_HOME/AGENTS.md; re-running replaces only that block
async function initCodexRules() {
  header('📋 Setting up Codex rules for Vesper');

  const sourceDir = ruleSourceDir();
  const rules = RULE_FILES.map((file) => readFileSync(join(sourceDir, file), 'utf-8').trim()).join('\n\n');
  const agentsPath = codexAgentsPath();

  try {
    if (existsSync(agentsPath) && hasUnmanagedVesperRules(readFileSync(agentsPath, 'utf-8'))) {
      warning(`${agentsPath} already contains Vesper rules outside the managed block`);
      info('They were probably appended by hand. Adding the managed copy would duplicate them.');
      const proceed = await promptConfirm('Add the managed copy anyway? (remove the old copy afterwards)');
      if (!proceed) {
        info('Skipped AGENTS.md. Delete the hand-appended rules and re-run "vesper init --client codex".');
        return;
      }
    }
    const change = installCodexRules(rules);
    reportFileChange(change, 'Codex rules');
  } catch (err) {
    if (err instanceof CodexConfigError) error(err.message);
    throw err;
  }

  log('\n💡 Codex will now know how and when to use Vesper memory.');
  log('   Rules take effect in new Codex sessions.\n');
}

// Copy the rule files into ~/.claude/rules/
async function initClaudeRules() {
  header('📋 Setting up Claude Code rules for Vesper');

  const rulesDir = join(homedir(), '.claude', 'rules');
  const sourceDir = ruleSourceDir();
  const ruleFiles = RULE_FILES;

  // Create ~/.claude/rules/ if missing
  if (!existsSync(rulesDir)) {
    info(`Creating ${rulesDir}...`);
    mkdirSync(rulesDir, { recursive: true });
  }

  // Copy each rule file
  let installed = 0;
  for (const file of ruleFiles) {
    const src = join(sourceDir, file);
    const dest = join(rulesDir, file);

    if (existsSync(dest)) {
      const shouldOverwrite = await promptConfirm(`${file} already exists. Overwrite?`);
      if (!shouldOverwrite) {
        info(`Skipped ${file}`);
        continue;
      }
    }

    try {
      copyFileSync(src, dest);
      success(`Installed ${file}`);
      installed++;
    } catch (err) {
      error(`Failed to copy ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (installed > 0) {
    log('');
    success(`${installed} rule file(s) installed to ${rulesDir}`);
    log('\n💡 Claude Code will now know how and when to use Vesper memory.');
    log('   Rules take effect in new Claude Code sessions.\n');
  } else {
    info('No files were installed.');
  }
}

// Migrate data from old locations to user-level storage
async function migrate() {
  header('🚚 Migrating Vesper Data to User-Level Storage');

  const vesperHome = getVesperHome();
  const newDbPath = getSqlitePath();

  // Potential old data locations
  const oldLocations = [
    join(INSTALL_DIR, 'data', 'memory.db'),  // Old installation directory
    './data/memory.db',                        // Current working directory
  ];

  info(`Target location: ${newDbPath}`);

  // Ensure target directories exist
  try {
    ensureDirectories();
    success(`Data directories created at ${vesperHome}`);
  } catch (err) {
    error(`Failed to create data directories: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // Find old data
  let foundOldData = false;
  let oldDataPath = '';
  let oldDataSize = 0;

  for (const oldPath of oldLocations) {
    if (existsSync(oldPath)) {
      try {
        const stats = statSync(oldPath);
        if (stats.isFile() && stats.size > 0) {
          foundOldData = true;
          oldDataPath = oldPath;
          oldDataSize = stats.size;
          break;
        }
      } catch {
        // Ignore stat errors
      }
    }
  }

  if (!foundOldData) {
    info('No old data found to migrate.');
    info('Checked locations:');
    for (const loc of oldLocations) {
      log(`   - ${loc}`);
    }
    log('\n');
    success('Nothing to migrate. You are ready to use Vesper!');
    return;
  }

  const sizeMB = (oldDataSize / 1024 / 1024).toFixed(2);
  info(`Found old database: ${oldDataPath} (${sizeMB} MB)`);

  // Check if target already exists
  if (existsSync(newDbPath)) {
    try {
      const newStats = statSync(newDbPath);
      const newSizeMB = (newStats.size / 1024 / 1024).toFixed(2);
      warning(`Target already exists: ${newDbPath} (${newSizeMB} MB)`);

      const shouldOverwrite = await promptConfirm('Overwrite existing data?');
      if (!shouldOverwrite) {
        info('Migration cancelled. Existing data preserved.');
        return;
      }
    } catch {
      // Target exists but couldn't stat - proceed with caution
    }
  }

  // Confirm migration
  log('\n📋 Migration Plan:');
  log(`   From: ${oldDataPath}`);
  log(`   To:   ${newDbPath}`);
  log(`   Size: ${sizeMB} MB\n`);

  const shouldProceed = await promptConfirm('Proceed with migration?');
  if (!shouldProceed) {
    info('Migration cancelled.');
    return;
  }

  // Perform migration
  info('Copying database...');
  try {
    copyFileSync(oldDataPath, newDbPath);
    success('Database copied successfully');

    // Verify the copy
    if (existsSync(newDbPath)) {
      const copiedStats = statSync(newDbPath);
      if (copiedStats.size === oldDataSize) {
        success('Verification passed: file sizes match');
      } else {
        warning('File sizes differ - please verify data integrity');
      }
    }

    log('\n');
    success('Migration complete!');
    info(`Your data is now at: ${newDbPath}`);
    info(`Old data preserved at: ${oldDataPath}`);
    log('\n💡 You can safely remove the old data after verifying everything works:\n');
    log(`   rm "${oldDataPath}"\n`);

    // Remind to reconfigure
    info('Run "vesper configure" to update MCP settings to use the new location.');

  } catch (err) {
    error(`Migration failed: ${err instanceof Error ? err.message : String(err)}`);
    error('Your original data is still intact at the old location.');
    process.exit(1);
  }
}

// Main CLI
const command = process.argv[2];

let clients: McpClient[] = ['claude'];
if (['install', 'configure', 'init'].includes(command)) {
  try {
    clients = parseClients(process.argv.slice(3));
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

switch (command) {
  case 'install':
    install(clients).catch((err) => {
      error(`Installation failed: ${err.message}`);
      process.exit(1);
    });
    break;

  case 'uninstall':
    uninstall().catch((err) => {
      error(`Uninstallation failed: ${err.message}`);
      process.exit(1);
    });
    break;

  case 'configure':
    configure(clients).catch((err) => {
      error(`Configuration failed: ${err.message}`);
      process.exit(1);
    });
    break;

  case 'status':
    status();
    break;

  case 'enable':
    enableVesper().catch((err) => {
      error(`Enable failed: ${err.message}`);
      process.exit(1);
    });
    break;

  case 'disable':
    disableVesper().catch((err) => {
      error(`Disable failed: ${err.message}`);
      process.exit(1);
    });
    break;

  case 'migrate':
    migrate().catch((err) => {
      error(`Migration failed: ${err.message}`);
      process.exit(1);
    });
    break;

  case 'init':
    initRules(clients).catch((err) => {
      error(`Init failed: ${err.message}`);
      process.exit(1);
    });
    break;

  case 'help':
  case '--help':
  case '-h':
  case undefined:
    log(`
${colors.bright}Vesper - AI Memory System for Claude Code and Codex${colors.reset}

${colors.bright}USAGE:${colors.reset}
  vesper <command> [--client claude|codex|all]

${colors.bright}COMMANDS:${colors.reset}
  install      Install Vesper and configure the client (full setup)
  init         Set up the client's rules for optimal memory usage
  configure    Configure MCP server only (no Docker setup)
  migrate      Migrate data from old location to user-level storage
  uninstall    Remove Vesper completely
  status       Show installation and service status
  enable       Enable Vesper memory system
  disable      Disable Vesper memory system (pass-through mode)
  help         Show this help message

${colors.bright}OPTIONS:${colors.reset}
  --client     Which agent install, configure and init set up: claude (default),
               codex, or all. Codex setup edits only [mcp_servers.vesper] in
               ~/.codex/config.toml and a marked block in ~/.codex/AGENTS.md
               (CODEX_HOME is respected) and is safe to re-run.

${colors.bright}EXAMPLES:${colors.reset}
  vesper install       # Full installation with Docker setup
  vesper init          # Install Claude Code rules for Vesper
  vesper install --client codex   # Full installation for Codex
  vesper init --client all        # Rules for Claude Code and Codex
  vesper configure     # Configure MCP only (lightweight)
  vesper migrate       # Move data to ~/.vesper/data/
  vesper status        # Check if running
  vesper enable        # Enable memory system
  vesper disable       # Disable for benchmarking
  vesper uninstall     # Remove Vesper

${colors.bright}DOCUMENTATION:${colors.reset}
  https://github.com/fitz2882/vesper-memory

${colors.bright}SUPPORT:${colors.reset}
  https://github.com/fitz2882/vesper-memory/issues
`);
    break;

  default:
    error(`Unknown command: ${command}`);
    log('Run "vesper help" for usage');
    process.exit(1);
}
