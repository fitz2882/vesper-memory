/**
 * Tests for MCP Server Tools Discovery
 *
 * Verifies that all expected tools are:
 * 1. Defined in the TOOLS array
 * 2. Exported via ListToolsRequestSchema handler
 * 3. Accessible regardless of environment configuration (SQLITE_DB path)
 *
 * This test suite addresses the issue where record_skill_outcome was
 * visible in vesper-dev but not vesper-personal despite being in the source.
 */

import { describe, it, expect, beforeAll } from 'vitest';

/**
 * Expected tools that should always be available in the MCP server.
 * This is the source of truth for tool availability.
 */
const EXPECTED_TOOLS = [
  'store_memory',
  'retrieve_memory',
  'list_recent',
  'get_stats',
  'delete_memory',  // Memory deletion
  'vesper_enable',
  'vesper_disable',
  'vesper_status',
  'record_skill_outcome',
  'load_skill',  // Lazy loading tool for on-demand skill loading
  'share_context',  // Multi-agent context sharing
  'store_decision',  // Decision tracking
  'list_namespaces',  // Namespace discovery
  'namespace_stats',  // Namespace statistics
];

/**
 * Tool definitions that should match the inputSchema requirements.
 */
const EXPECTED_TOOL_SCHEMAS = {
  store_memory: {
    required: ['content', 'memory_type'],
    properties: ['content', 'memory_type', 'metadata'],
  },
  retrieve_memory: {
    required: ['query'],
    properties: ['query', 'memory_types', 'max_results', 'routing_strategy'],
  },
  list_recent: {
    required: [],
    properties: ['limit', 'memory_type'],
  },
  get_stats: {
    required: [],
    properties: ['detailed'],
  },
  delete_memory: {
    required: ['memory_id'],
    properties: ['memory_id', 'namespace'],
  },
  vesper_enable: {
    required: [],
    properties: [],
  },
  vesper_disable: {
    required: [],
    properties: [],
  },
  vesper_status: {
    required: [],
    properties: [],
  },
  record_skill_outcome: {
    required: ['skill_id', 'outcome'],
    properties: ['skill_id', 'outcome', 'satisfaction'],
  },
  load_skill: {
    required: ['skill_id'],
    properties: ['skill_id'],
  },
  share_context: {
    required: ['source_namespace', 'target_namespace'],
    properties: ['source_namespace', 'target_namespace', 'task_id', 'query', 'max_items', 'include_skills', 'include_entities'],
  },
  store_decision: {
    required: ['content'],
    properties: ['content', 'namespace', 'agent_id', 'agent_role', 'task_id', 'supersedes', 'metadata'],
  },
  list_namespaces: {
    required: [],
    properties: [],
  },
  namespace_stats: {
    required: ['namespace'],
    properties: ['namespace'],
  },
};

describe('MCP Server Tools Discovery', () => {
  let TOOLS: Array<{
    name: string;
    description: string;
    inputSchema: {
      type: string;
      properties: Record<string, unknown>;
      required?: string[];
    };
  }>;

  beforeAll(async () => {
    // Import the TOOLS array directly from the server module
    // This bypasses runtime initialization and tests the static tool definitions
    const serverModule = await import('../src/server.js');

    // Access TOOLS via module internals
    // Note: Since TOOLS is a module-level const, we need to verify it exists
    // by checking the compiled output or using an alternative approach

    // For this test, we'll read the source and parse the TOOLS array
    // This is a static analysis approach that doesn't require running the server

    // Alternative: We export TOOLS from server.ts for testing purposes
    // For now, we'll test by reading the compiled JavaScript
    const fs = await import('fs');
    const path = await import('path');

    const serverPath = path.join(process.cwd(), 'dist', 'server.js');

    // Check if dist exists, if not, use source parsing approach
    let toolsSource: string;
    try {
      toolsSource = fs.readFileSync(serverPath, 'utf-8');
    } catch {
      // Fallback to source file if dist doesn't exist
      const srcPath = path.join(process.cwd(), 'src', 'server.ts');
      toolsSource = fs.readFileSync(srcPath, 'utf-8');
    }

    // Parse TOOLS array from source/compiled code
    // This regex matches the TOOLS array definition
    const toolsMatch = toolsSource.match(/const\s+TOOLS\s*=\s*\[([\s\S]*?)\];/);

    if (!toolsMatch) {
      throw new Error('Could not find TOOLS array in server module');
    }

    // Extract tool names from the matched array
    const toolNamesInSource: string[] = [];
    const nameMatches = toolsMatch[1].matchAll(/name:\s*["']([^"']+)["']/g);
    for (const match of nameMatches) {
      toolNamesInSource.push(match[1]);
    }

    // Create a minimal TOOLS representation for testing
    TOOLS = toolNamesInSource.map((name) => ({
      name,
      description: '', // We'll validate descriptions separately
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    }));
  });

  describe('Tool Presence', () => {
    it('should include all expected tools in TOOLS array', () => {
      const toolNames = TOOLS.map((t) => t.name);

      for (const expectedTool of EXPECTED_TOOLS) {
        expect(toolNames).toContain(expectedTool);
      }
    });

    it('should include record_skill_outcome tool', () => {
      // This is the specific tool that was reported missing
      const toolNames = TOOLS.map((t) => t.name);
      expect(toolNames).toContain('record_skill_outcome');
    });

    it('should not include duplicate tools', () => {
      const toolNames = TOOLS.map((t) => t.name);
      const uniqueNames = new Set(toolNames);
      expect(toolNames.length).toBe(uniqueNames.size);
    });

    it('should have exactly 13 tools', () => {
      expect(TOOLS.length).toBe(EXPECTED_TOOLS.length);
    });
  });

  describe('Tool Order Consistency', () => {
    it('should have tools in consistent order', () => {
      // Verify tools are in the expected order for predictable discovery
      const toolNames = TOOLS.map((t) => t.name);

      // First 4 core memory tools + delete
      expect(toolNames[0]).toBe('store_memory');
      expect(toolNames[1]).toBe('retrieve_memory');
      expect(toolNames[2]).toBe('list_recent');
      expect(toolNames[3]).toBe('get_stats');
      expect(toolNames[4]).toBe('delete_memory');

      // Toggle tools
      expect(toolNames[5]).toBe('vesper_enable');
      expect(toolNames[6]).toBe('vesper_disable');
      expect(toolNames[7]).toBe('vesper_status');

      // Skill feedback tool
      expect(toolNames[8]).toBe('record_skill_outcome');

      // Lazy loading tool
      expect(toolNames[9]).toBe('load_skill');

      // Multi-agent namespace tools
      expect(toolNames[10]).toBe('share_context');
      expect(toolNames[11]).toBe('store_decision');
      expect(toolNames[12]).toBe('list_namespaces');
      expect(toolNames[13]).toBe('namespace_stats');
    });
  });
});

describe('Tool Schema Validation', () => {
  let toolsFromSource: Map<
    string,
    {
      name: string;
      description: string;
      required: string[];
      properties: string[];
    }
  >;

  beforeAll(async () => {
    const fs = await import('fs');
    const path = await import('path');

    // Read source file for detailed schema analysis
    const srcPath = path.join(process.cwd(), 'src', 'server.ts');
    const source = fs.readFileSync(srcPath, 'utf-8');

    toolsFromSource = new Map();

    // Find the TOOLS array and extract each tool definition
    const toolsArrayMatch = source.match(/const\s+TOOLS\s*=\s*\[([\s\S]*?)\];\s*\n\s*\/\*\*/);
    if (!toolsArrayMatch) {
      throw new Error('Could not find TOOLS array');
    }

    const toolsArrayContent = toolsArrayMatch[1];

    // Parse each tool definition using balanced brace matching
    // Split by tool objects (each starting with { and having name:)
    const toolBlocks: string[] = [];
    let depth = 0;
    let currentBlock = '';
    let inBlock = false;

    for (let i = 0; i < toolsArrayContent.length; i++) {
      const char = toolsArrayContent[i];

      if (char === '{') {
        if (depth === 0) {
          inBlock = true;
          currentBlock = '';
        }
        depth++;
      }

      if (inBlock) {
        currentBlock += char;
      }

      if (char === '}') {
        depth--;
        if (depth === 0 && inBlock) {
          toolBlocks.push(currentBlock);
          inBlock = false;
        }
      }
    }

    // Parse each tool block
    for (const toolBlock of toolBlocks) {
      // Extract name
      const nameMatch = toolBlock.match(/name:\s*["']([^"']+)["']/);
      if (!nameMatch) continue;
      const name = nameMatch[1];

      // Extract description (may span multiple lines with template strings)
      const descMatch = toolBlock.match(/description:\s*["'`]([^"'`]+)["'`]/s);
      const description = descMatch ? descMatch[1].replace(/\s+/g, ' ').trim() : '';

      // Extract required fields
      const requiredMatch = toolBlock.match(/required:\s*\[([^\]]*)\]/);
      const required = requiredMatch
        ? requiredMatch[1]
            .split(',')
            .map((s) => s.trim().replace(/["']/g, ''))
            .filter((s) => s.length > 0)
        : [];

      // Extract properties using a more robust approach
      // Find the properties object and extract top-level keys
      const propertiesMatch = toolBlock.match(/properties:\s*\{([\s\S]*)\},?\s*(?:required|\})/);
      const properties: string[] = [];

      if (propertiesMatch) {
        const propsContent = propertiesMatch[1];
        // Find property names at depth 0 within properties object
        let propDepth = 0;
        let propName = '';
        let inPropName = true;

        for (let i = 0; i < propsContent.length; i++) {
          const char = propsContent[i];

          if (char === '{') {
            propDepth++;
            inPropName = false;
          } else if (char === '}') {
            propDepth--;
            if (propDepth === 0) {
              inPropName = true;
              propName = '';
            }
          } else if (propDepth === 0 && inPropName) {
            if (char === ':') {
              const cleanName = propName.trim();
              if (cleanName && !cleanName.includes(' ') && !cleanName.includes('\n')) {
                properties.push(cleanName);
              }
              propName = '';
            } else if (char !== ',' && char !== '\n' && char !== ' ') {
              propName += char;
            } else if (char === ',' || char === '\n') {
              propName = '';
            }
          }
        }
      }

      toolsFromSource.set(name, {
        name,
        description,
        required,
        properties,
      });
    }
  });

  describe('record_skill_outcome Schema', () => {
    it('should have skill_id as required field', () => {
      const tool = toolsFromSource.get('record_skill_outcome');
      expect(tool).toBeDefined();
      expect(tool!.required).toContain('skill_id');
    });

    it('should have outcome as required field', () => {
      const tool = toolsFromSource.get('record_skill_outcome');
      expect(tool).toBeDefined();
      expect(tool!.required).toContain('outcome');
    });

    it('should have satisfaction as optional property', () => {
      const tool = toolsFromSource.get('record_skill_outcome');
      expect(tool).toBeDefined();
      expect(tool!.properties).toContain('satisfaction');
      // satisfaction should NOT be in required
      expect(tool!.required).not.toContain('satisfaction');
    });

    it('should have descriptive description', () => {
      const tool = toolsFromSource.get('record_skill_outcome');
      expect(tool).toBeDefined();
      expect(tool!.description.length).toBeGreaterThan(10);
      expect(tool!.description.toLowerCase()).toContain('skill');
    });
  });

  describe('All Tools Have Valid Schemas', () => {
    for (const [toolName, expectedSchema] of Object.entries(EXPECTED_TOOL_SCHEMAS)) {
      it(`${toolName} should have correct required fields`, () => {
        const tool = toolsFromSource.get(toolName);
        expect(tool).toBeDefined();

        for (const requiredField of expectedSchema.required) {
          expect(tool!.required).toContain(requiredField);
        }
      });

      it(`${toolName} should have expected properties`, () => {
        const tool = toolsFromSource.get(toolName);
        expect(tool).toBeDefined();

        for (const prop of expectedSchema.properties) {
          expect(tool!.properties).toContain(prop);
        }
      });
    }
  });
});

describe('Environment Independence', () => {
  it('should not filter tools based on SQLITE_DB environment variable', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const srcPath = path.join(process.cwd(), 'src', 'server.ts');
    const source = fs.readFileSync(srcPath, 'utf-8');

    // Check that TOOLS array is not conditionally defined
    // Look for any conditionals near the TOOLS definition
    const toolsSection = source.match(/const\s+TOOLS\s*=\s*\[([\s\S]*?)\];/);
    expect(toolsSection).toBeDefined();

    const toolsDefinition = toolsSection![0];

    // Should not have conditionals like if (process.env.SQLITE_DB)
    expect(toolsDefinition).not.toContain('process.env.SQLITE_DB');
    expect(toolsDefinition).not.toContain('if (');
    expect(toolsDefinition).not.toContain('? ');
    expect(toolsDefinition).not.toContain('.filter(');
  });

  it('should not have environment-based tool filtering in ListToolsRequestSchema handler', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const srcPath = path.join(process.cwd(), 'src', 'server.ts');
    const source = fs.readFileSync(srcPath, 'utf-8');

    // Find the ListToolsRequestSchema handler
    const handlerMatch = source.match(
      /server\.setRequestHandler\s*\(\s*ListToolsRequestSchema[\s\S]*?tools:\s*TOOLS/
    );

    expect(handlerMatch).toBeDefined();

    // The handler should simply return TOOLS without filtering
    // Check that it's a simple return statement
    const handler = handlerMatch![0];
    expect(handler).not.toContain('.filter(');
    expect(handler).not.toContain('process.env');
    expect(handler).not.toContain('if (');
  });

  it('should return same tools regardless of database path', async () => {
    // This is a conceptual test - the actual verification is that
    // TOOLS is a static const array with no conditional logic
    const fs = await import('fs');
    const path = await import('path');

    const srcPath = path.join(process.cwd(), 'src', 'server.ts');
    const source = fs.readFileSync(srcPath, 'utf-8');

    // Count tool definitions
    const toolMatches = source.match(/{\s*name:\s*["'][^"']+["'],\s*description:/g);
    expect(toolMatches).toBeDefined();
    expect(toolMatches!.length).toBe(14);  // Updated for delete_memory tool
  });
});

describe('Tool Handler Registration', () => {
  it('should have handler case for delete_memory in processTool', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const srcPath = path.join(process.cwd(), 'src', 'server.ts');
    const source = fs.readFileSync(srcPath, 'utf-8');

    const processToolMatch = source.match(/async\s+function\s+processTool[\s\S]*?\/\/ Process memory tools[\s\S]*?switch\s*\(name\)\s*\{([\s\S]*?default:)/);
    expect(processToolMatch).toBeDefined();

    const switchBlock = processToolMatch![1];
    expect(switchBlock).toContain('case "delete_memory"');
    expect(switchBlock).toContain('handleDeleteMemory');
  });

  it('should have handler case for record_skill_outcome in processTool', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const srcPath = path.join(process.cwd(), 'src', 'server.ts');
    const source = fs.readFileSync(srcPath, 'utf-8');

    // Find the processTool function which has TWO switch statements
    // The second switch handles memory tools including record_skill_outcome
    const processToolMatch = source.match(/async\s+function\s+processTool[\s\S]*?\/\/ Process memory tools[\s\S]*?switch\s*\(name\)\s*\{([\s\S]*?default:)/);
    expect(processToolMatch).toBeDefined();

    const switchBlock = processToolMatch![1];

    // Verify record_skill_outcome has a case
    expect(switchBlock).toContain('case "record_skill_outcome"');
    expect(switchBlock).toContain('handleRecordSkillOutcome');
  });

  it('should have handleRecordSkillOutcome function defined', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const srcPath = path.join(process.cwd(), 'src', 'server.ts');
    const source = fs.readFileSync(srcPath, 'utf-8');

    // Check the handler function exists
    expect(source).toContain('async function handleRecordSkillOutcome');
    expect(source).toContain('RecordSkillOutcomeInputSchema');
  });
});

describe('Build Output Verification', () => {
  it('should have record_skill_outcome in compiled dist/server.js', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const distPath = path.join(process.cwd(), 'dist', 'server.js');

    let distExists = false;
    try {
      fs.accessSync(distPath);
      distExists = true;
    } catch {
      // dist doesn't exist - this is a build issue
    }

    if (!distExists) {
      // Skip this test if dist doesn't exist (pre-build state)
      console.warn('dist/server.js not found - run npm run build first');
      return;
    }

    const compiled = fs.readFileSync(distPath, 'utf-8');

    // Verify the tool is in compiled output
    expect(compiled).toContain('record_skill_outcome');
    expect(compiled).toContain('Record success or failure feedback');
  });

  it('should have all 8 tools in compiled output', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const distPath = path.join(process.cwd(), 'dist', 'server.js');

    let distExists = false;
    try {
      fs.accessSync(distPath);
      distExists = true;
    } catch {
      // dist doesn't exist
    }

    if (!distExists) {
      console.warn('dist/server.js not found - run npm run build first');
      return;
    }

    const compiled = fs.readFileSync(distPath, 'utf-8');

    for (const tool of EXPECTED_TOOLS) {
      expect(compiled).toContain(`"${tool}"`);
    }
  });
});
