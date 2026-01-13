#!/usr/bin/env node
/**
 * Self-Verification Script
 * 
 * Runs all checks and outputs JSON results for agentic tools to parse.
 * 
 * Usage: node scripts/verify.js
 * Output: JSON report to stdout, detailed logs to stderr
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Results accumulator
const results = {
  timestamp: new Date().toISOString(),
  success: true,
  summary: { passed: 0, failed: 0, skipped: 0 },
  checks: [],
};

function log(msg) {
  console.error(msg);
}

function addCheck(name, status, details = {}) {
  const check = { name, status, ...details };
  results.checks.push(check);
  
  if (status === 'passed') {
    results.summary.passed++;
    log(`✅ ${name}`);
  } else if (status === 'failed') {
    results.summary.failed++;
    results.success = false;
    log(`❌ ${name}: ${details.error || 'Failed'}`);
  } else {
    results.summary.skipped++;
    log(`⏭️  ${name}: Skipped`);
  }
}

function runCommand(cmd, options = {}) {
  try {
    const result = execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: options.timeout || 60000,
      ...options,
    });
    return { success: true, output: result };
  } catch (e) {
    return { 
      success: false, 
      output: e.stdout || '', 
      error: e.stderr || e.message,
      code: e.status,
    };
  }
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function readJSON(relativePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf-8'));
  } catch {
    return null;
  }
}

// =============================================================================
// Checks
// =============================================================================

async function checkProjectStructure() {
  const requiredFiles = [
    'package.json',
    'tsconfig.json',
    'src/extension.ts',
    'src/core/types.ts',
    'src/core/registry.ts',
    'src/core/agent/index.ts',
  ];

  const missing = requiredFiles.filter(f => !fileExists(f));
  
  if (missing.length === 0) {
    addCheck('Project structure', 'passed', { files: requiredFiles.length });
  } else {
    addCheck('Project structure', 'failed', { 
      error: `Missing files: ${missing.join(', ')}`,
      missing,
    });
  }
}

async function checkPackageJson() {
  const pkg = readJSON('package.json');
  
  if (!pkg) {
    addCheck('package.json valid', 'failed', { error: 'Cannot read package.json' });
    return;
  }

  const issues = [];
  
  if (!pkg.name) issues.push('Missing name');
  if (!pkg.main) issues.push('Missing main entry');
  if (!pkg.engines?.vscode) issues.push('Missing vscode engine');
  if (!pkg.contributes?.commands) issues.push('Missing commands');
  if (!pkg.contributes?.views) issues.push('Missing views');
  
  if (issues.length === 0) {
    addCheck('package.json valid', 'passed', {
      name: pkg.name,
      version: pkg.version,
      commands: pkg.contributes?.commands?.length || 0,
    });
  } else {
    addCheck('package.json valid', 'failed', { error: issues.join(', '), issues });
  }
}

async function checkDependencies() {
  if (!fileExists('node_modules')) {
    log('   Installing dependencies...');
    const result = runCommand('npm install', { timeout: 120000 });
    if (!result.success) {
      addCheck('Dependencies installed', 'failed', { error: result.error });
      return;
    }
  }
  addCheck('Dependencies installed', 'passed');
}

async function checkTypeScriptCompilation() {
  log('   Compiling TypeScript...');
  const result = runCommand('npm run compile 2>&1');
  
  if (result.success) {
    addCheck('TypeScript compilation', 'passed');
  } else {
    // Extract error count
    const errorMatch = result.output.match(/(\d+) error/);
    const errorCount = errorMatch ? parseInt(errorMatch[1]) : 'unknown';
    addCheck('TypeScript compilation', 'failed', {
      error: `${errorCount} compilation errors`,
      details: result.output.slice(-1000), // Last 1000 chars
    });
  }
}

async function checkDistOutput() {
  const requiredDist = [
    'dist/extension.js',
    'dist/core/registry.js',
    'dist/core/agent/index.js',
    'dist/core/types.js',
  ];

  const missing = requiredDist.filter(f => !fileExists(f));
  
  if (missing.length === 0) {
    addCheck('Dist output exists', 'passed');
  } else {
    addCheck('Dist output exists', 'failed', {
      error: `Missing: ${missing.join(', ')}`,
    });
  }
}

async function checkWebviewScripts() {
  const scripts = [
    'media/chat/bootstrap.js',
    'media/chat/render-utils.js',
    'media/chat/render-messages.js',
    'media/chat/context.js',
    'media/chat/main.js',
  ];

  const missing = scripts.filter(f => !fileExists(f));
  if (missing.length > 0) {
    addCheck('Webview scripts syntax', 'failed', { error: `Missing: ${missing.join(', ')}` });
    return;
  }

  log('   Checking webview script syntax...');
  const failures = [];
  for (const file of scripts) {
    const result = runCommand(`node --check ${file} 2>&1`);
    if (!result.success) {
      failures.push({
        file,
        details: (result.error || result.output || '').toString().slice(-1000),
      });
    }
  }

  if (failures.length === 0) {
    addCheck('Webview scripts syntax', 'passed', { files: scripts.length });
  } else {
    addCheck('Webview scripts syntax', 'failed', {
      error: `${failures.length} webview scripts have syntax errors`,
      failures,
    });
  }
}

async function checkManualTests() {
  if (!fileExists('scripts/test-manual.js')) {
    addCheck('Manual tests', 'skipped', { reason: 'test-manual.js not found' });
    return;
  }

  log('   Running manual tests...');
  const result = runCommand('node scripts/test-manual.js 2>&1');
  
  // Parse results from output
  const passMatch = result.output.match(/(\d+) passed/);
  const failMatch = result.output.match(/(\d+) failed/);
  const passed = passMatch ? parseInt(passMatch[1]) : 0;
  const failed = failMatch ? parseInt(failMatch[1]) : 0;

  if (result.success && failed === 0) {
    addCheck('Manual tests', 'passed', { passed, failed });
  } else {
    addCheck('Manual tests', 'failed', { 
      error: `${failed} tests failed`,
      passed,
      failed,
      output: result.output,
    });
  }
}

async function checkRegistryUnit() {
  // Quick check that registry module loads and has expected exports
  log('   Testing registry module...');
  
  // Since manual tests already do functional testing, just verify the module structure
  const registryPath = path.join(ROOT, 'dist/core/registry.js');
  
  if (!fileExists('dist/core/registry.js')) {
    addCheck('Registry module', 'failed', { error: 'registry.js not found' });
    return;
  }
  
  const content = fs.readFileSync(registryPath, 'utf-8');
  
  const expectedExports = ['ToolRegistry', 'toolRegistry'];
  const missing = expectedExports.filter(e => !content.includes(e));
  
  if (missing.length === 0) {
    addCheck('Registry module', 'passed', { exports: expectedExports });
  } else {
    addCheck('Registry module', 'failed', {
      error: `Missing exports: ${missing.join(', ')}`,
    });
  }
}

async function checkToolDefinitions() {
  // Verify built-in tools have expected structure
  log('   Checking tool definitions...');
  
  const toolFiles = [
    { path: 'dist/tools/builtin/index.js', exports: ['registerBuiltinTools'] },
  ];

  const issues = [];
  
  for (const { path: filePath, exports: expectedExports } of toolFiles) {
    if (!fileExists(filePath)) {
      issues.push(`${filePath} not found`);
      continue;
    }
    
    const content = fs.readFileSync(path.join(ROOT, filePath), 'utf-8');
    for (const exp of expectedExports) {
      if (!content.includes(exp)) {
        issues.push(`${filePath} missing ${exp}`);
      }
    }
  }

  if (issues.length === 0) {
    addCheck('Tool definitions', 'passed', { files: toolFiles.length });
  } else {
    addCheck('Tool definitions', 'failed', { error: issues.join(', ') });
  }
}

async function checkSchemaValid() {
  if (!fileExists('schemas/agent-tools.schema.json')) {
    addCheck('JSON Schema', 'skipped');
    return;
  }

  const schema = readJSON('schemas/agent-tools.schema.json');
  if (schema && schema.$schema && schema.properties) {
    addCheck('JSON Schema', 'passed');
  } else {
    addCheck('JSON Schema', 'failed', { error: 'Invalid schema structure' });
  }
}

async function checkPackaging() {
  // Check if we can package (without actually creating .vsix)
  log('   Checking packaging requirements...');
  
  const pkg = readJSON('package.json');
  const issues = [];
  
  if (!pkg.publisher || pkg.publisher === 'your-publisher') {
    issues.push('Publisher not set (update package.json)');
  }
  if (!pkg.repository?.url) {
    issues.push('Repository URL not set');
  }
  if (!fileExists('README.md')) {
    issues.push('README.md missing');
  }
  if (!fileExists('CHANGELOG.md') && !fileExists('AGENTS.md')) {
    issues.push('No changelog or documentation');
  }

  if (issues.length === 0) {
    addCheck('Packaging requirements', 'passed');
  } else {
    // These are warnings, not failures
    addCheck('Packaging requirements', 'passed', { 
      warnings: issues,
    });
  }
}

async function checkTypeExports() {
  // Verify type exports work
  log('   Checking type exports...');
  
  if (!fileExists('dist/index.d.ts')) {
    addCheck('Type exports', 'failed', { error: 'index.d.ts not found' });
    return;
  }

  const content = fs.readFileSync(path.join(ROOT, 'dist/index.d.ts'), 'utf-8');
  const expectedExports = ['ToolDefinition', 'ToolProvider', 'ToolResult', 'LingyunAPI'];
  const missing = expectedExports.filter(e => !content.includes(e));

  if (missing.length === 0) {
    addCheck('Type exports', 'passed', { exports: expectedExports });
  } else {
    addCheck('Type exports', 'failed', {
      error: `Missing exports: ${missing.join(', ')}`,
    });
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  log('\n🔍 LingYun - Self Verification\n');
  log('='.repeat(50));

  await checkProjectStructure();
  await checkPackageJson();
  await checkDependencies();
  await checkTypeScriptCompilation();
  await checkDistOutput();
  await checkWebviewScripts();
  await checkManualTests();
  await checkRegistryUnit();
  await checkToolDefinitions();
  await checkSchemaValid();
  await checkTypeExports();
  await checkPackaging();

  log('\n' + '='.repeat(50));
  log(`\n📊 Summary: ${results.summary.passed} passed, ${results.summary.failed} failed, ${results.summary.skipped} skipped`);
  log(`\n${results.success ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}\n`);

  // Output JSON to stdout for parsing
  console.log(JSON.stringify(results, null, 2));

  process.exit(results.success ? 0 : 1);
}

main().catch(e => {
  console.error('Verification failed:', e);
  process.exit(1);
});
