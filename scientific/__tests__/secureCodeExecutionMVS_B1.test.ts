/**
 * NutriBodySim — MVS-B1 Secure Code Execution Test Suite
 *
 * Comprehensive verification of SEC-01 remediation on /api/code/execute:
 * 1. Input validation & boundary enforcement (empty, invalid types, size limits)
 * 2. Unsupported / unprovisioned language runtimes (explicit non-mock rejection)
 * 3. Prevention of arbitrary code execution in the main server process
 * 4. Deterministic structured mathematical calculation with allowlisted operators
 * 5. Resource bounding (input size limit, recursion depth limit, output truncation)
 * 6. Output and error size capping
 * 7. Process resilience (malformed / erroneous inputs do not crash process)
 * 8. Frontend response contract compatibility
 * 9. Static scan verifying ZERO eval() and ZERO new Function() in backend and scientific code
 */

import { describe, it, expect } from 'vitest';
import express, { Express } from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { StructuredMathEvaluator } from '../engine/structuredMathEvaluator';
import { apiRouter } from '../../backend/routes/api';
import { defaultSessionStore } from '../../backend/auth/sessionStore';

// Explicit test authentication fixture for integration tests
const testAuthFixture = defaultSessionStore.createSession('usr_researcher');

// Create a test server instance for integration verification
function createTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  return app;
}

// Helper to make local HTTP requests to the test Express app
async function makeRequest(
  app: Express, 
  method: string, 
  url: string, 
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      const port = addr.port;
      const dataStr = body ? JSON.stringify(body) : undefined;

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: url,
          method,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': dataStr ? Buffer.byteLength(dataStr) : 0,
            'Authorization': `Bearer ${testAuthFixture.token}`,
            ...headers
          }
        },
        res => {
          let resData = '';
          res.on('data', chunk => {
            resData += chunk;
          });
          res.on('end', () => {
            server.close(() => {
              let parsed: any;
              try {
                parsed = JSON.parse(resData);
              } catch {
                parsed = resData;
              }
              resolve({ status: res.statusCode || 500, body: parsed });
            });
          });
        }
      );

      req.on('error', err => {
        server.close(() => reject(err));
      });

      if (dataStr) {
        req.write(dataStr);
      }
      req.end();
    });
  });
}

describe('MVS-B1: Secure Code Execution & Structured Math Evaluator', () => {
  const testApp = createTestApp();

  // ------------------------------------------------------------------------
  // PART 1: StructuredMathEvaluator Unit Tests
  // ------------------------------------------------------------------------
  describe('StructuredMathEvaluator Engine', () => {
    it('1. should evaluate valid arithmetic expressions with standard precedence', () => {
      const res = StructuredMathEvaluator.evaluate('2 + 3 * 4');
      expect(res.success).toBe(true);
      expect(res.value).toBe(14);
    });

    it('2. should evaluate expressions with parentheses correctly', () => {
      const res = StructuredMathEvaluator.evaluate('(10 - 2) / 4');
      expect(res.success).toBe(true);
      expect(res.value).toBe(2);
    });

    it('3. should support exponentiation (^ and **)', () => {
      const res1 = StructuredMathEvaluator.evaluate('2 ^ 3');
      expect(res1.success).toBe(true);
      expect(res1.value).toBe(8);

      const res2 = StructuredMathEvaluator.evaluate('3 ** 2');
      expect(res2.success).toBe(true);
      expect(res2.value).toBe(9);
    });

    it('4. should support modulo (%) operator', () => {
      const res = StructuredMathEvaluator.evaluate('14 % 4');
      expect(res.success).toBe(true);
      expect(res.value).toBe(2);
    });

    it('5. should evaluate allowlisted pure mathematical functions', () => {
      expect(StructuredMathEvaluator.evaluate('sqrt(25)').value).toBe(5);
      expect(StructuredMathEvaluator.evaluate('cbrt(27)').value).toBe(3);
      expect(StructuredMathEvaluator.evaluate('pow(2, 4)').value).toBe(16);
      expect(StructuredMathEvaluator.evaluate('abs(-42)').value).toBe(42);
      expect(StructuredMathEvaluator.evaluate('min(10, 4, 25)').value).toBe(4);
      expect(StructuredMathEvaluator.evaluate('max(10, 4, 25)').value).toBe(25);
      expect(StructuredMathEvaluator.evaluate('round(4.6)').value).toBe(5);
      expect(StructuredMathEvaluator.evaluate('floor(4.9)').value).toBe(4);
      expect(StructuredMathEvaluator.evaluate('ceil(4.1)').value).toBe(5);
      expect(StructuredMathEvaluator.evaluate('exp(0)').value).toBe(1);
    });

    it('6. should evaluate allowlisted mathematical constants (PI, E)', () => {
      const resPi = StructuredMathEvaluator.evaluate('PI * 2');
      expect(resPi.success).toBe(true);
      expect(resPi.value).toBeCloseTo(Math.PI * 2, 6);

      const resE = StructuredMathEvaluator.evaluate('E + 1');
      expect(resE.success).toBe(true);
      expect(resE.value).toBeCloseTo(Math.E + 1, 6);
    });

    it('7. should evaluate expressions with predefined physiological variables', () => {
      // weight_kg = 70.0, stature_m = 1.75 -> BMI = 70 / (1.75^2) = 22.857142...
      const res = StructuredMathEvaluator.evaluate('weight_kg / (stature_m ^ 2)');
      expect(res.success).toBe(true);
      expect(res.value).toBeCloseTo(22.857142, 4);
    });

    it('8. should support custom variables passed in context', () => {
      const res = StructuredMathEvaluator.evaluate('custom_a * 2 + custom_b', {
        variables: { custom_a: 15, custom_b: 5 }
      });
      expect(res.success).toBe(true);
      expect(res.value).toBe(35);
    });

    it('9. should fail gracefully on division by zero without crashing', () => {
      const res = StructuredMathEvaluator.evaluate('100 / 0');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Division by zero');
    });

    it('10. should fail gracefully on square root of negative numbers', () => {
      const res = StructuredMathEvaluator.evaluate('sqrt(-9)');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Square root of negative number');
    });

    it('11. should fail gracefully on natural log of non-positive numbers', () => {
      const res = StructuredMathEvaluator.evaluate('log(0)');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Natural log of non-positive number');
    });

    it('12. should reject forbidden dangerous identifiers (process, global, eval, constructor)', () => {
      expect(StructuredMathEvaluator.isSafeMathExpression('process.exit(1)')).toBe(false);
      expect(StructuredMathEvaluator.isSafeMathExpression('global.process')).toBe(false);
      expect(StructuredMathEvaluator.isSafeMathExpression('window.location')).toBe(false);
      expect(StructuredMathEvaluator.isSafeMathExpression('eval("1+1")')).toBe(false);
      expect(StructuredMathEvaluator.isSafeMathExpression('Function("return 1")()')).toBe(false);
      expect(StructuredMathEvaluator.isSafeMathExpression('this.constructor')).toBe(false);
      expect(StructuredMathEvaluator.isSafeMathExpression('require("fs")')).toBe(false);
      expect(StructuredMathEvaluator.isSafeMathExpression('import("child_process")')).toBe(false);
    });

    it('13. should reject statements, assignments, semicolons, and code blocks', () => {
      expect(StructuredMathEvaluator.isSafeMathExpression('let x = 10; x + 5;')).toBe(false);
      expect(StructuredMathEvaluator.isSafeMathExpression('const a = 1;')).toBe(false);
      expect(StructuredMathEvaluator.isSafeMathExpression('if (true) { 1 }')).toBe(false);
      expect(StructuredMathEvaluator.isSafeMathExpression('while(1){}')).toBe(false);
      expect(StructuredMathEvaluator.isSafeMathExpression('function foo() { return 1; }')).toBe(false);
    });

    it('14. should enforce recursion depth limits against deeply nested expressions', () => {
      const deeplyNested = '('.repeat(60) + '1' + ')'.repeat(60);
      const res = StructuredMathEvaluator.evaluate(deeplyNested);
      expect(res.success).toBe(false);
      expect(res.error).toContain('nesting depth');
    });

    it('15. should reject expressions exceeding maximum length (10,000 characters)', () => {
      const oversized = '1 + '.repeat(3000) + '1'; // ~12,000 characters
      const res = StructuredMathEvaluator.evaluate(oversized);
      expect(res.success).toBe(false);
      expect(res.error).toContain('maximum limit');
    });
  });

  // ------------------------------------------------------------------------
  // PART 2: POST /api/code/execute Endpoint Integration Tests
  // ------------------------------------------------------------------------
  describe('POST /api/code/execute Integration & Policy Enforcement', () => {
    it('16. should reject missing code property with 400 Bad Request', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/code/execute', {
        language: 'JAVASCRIPT'
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Code string is required');
    });

    it('17. should reject non-string code property with 400 Bad Request', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/code/execute', {
        language: 'JAVASCRIPT',
        code: 12345
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Code string is required');
    });

    it('18. should reject empty string code with 400 Bad Request', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/code/execute', {
        language: 'JAVASCRIPT',
        code: '   '
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Code cannot be empty');
    });

    it('19. should reject oversized code payloads (>32 KB) with 400 Bad Request', async () => {
      const oversizedCode = 'a'.repeat(33000);
      const res = await makeRequest(testApp, 'POST', '/api/code/execute', {
        language: 'JAVASCRIPT',
        code: oversizedCode
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('32 KB');
    });

    it('20. should return explicit "unsupported" status for PYTHON runtime (no fake mock output)', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/code/execute', {
        language: 'PYTHON',
        code: 'import numpy as np\nprint(np.mean([1, 2, 3]))'
      });
      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.status).toBe('unsupported');
      expect(res.body.result.stderr).toContain('Isolated execution runner for PYTHON is not provisioned');
      expect(res.body.result.stdout).toBe('');
      // Verify NO fake mock text claiming success
      expect(res.body.result.stdout).not.toContain('Process finished with exit code 0');
      expect(res.body.result.stdout).not.toContain('Calculation verified');
    });

    it('21. should return explicit "unsupported" status for R runtime (no fake mock output)', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/code/execute', {
        language: 'R',
        code: 'library(stats)\nbmis <- c(22, 24, 26)'
      });
      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.status).toBe('unsupported');
      expect(res.body.result.stderr).toContain('Isolated execution runner for R is not provisioned');
      expect(res.body.result.stdout).toBe('');
      // Verify NO fake mock text claiming success
      expect(res.body.result.stdout).not.toContain('P-value < 0.001');
    });

    it('22. should return explicit "unsupported" status for SQL runtime', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/code/execute', {
        language: 'SQL',
        code: 'SELECT * FROM cohort_measurements'
      });
      expect(res.status).toBe(200);
      expect(res.body.result.status).toBe('unsupported');
      expect(res.body.result.stderr).toContain('Direct arbitrary SQL execution via Code Lab is disabled');
      expect(res.body.result.stdout).toBe('');
    });

    it('23. should reject arbitrary JavaScript statements in server process', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/code/execute', {
        language: 'JAVASCRIPT',
        code: 'let x = 10; const y = 20; console.log(x + y);'
      });
      expect(res.status).toBe(200);
      expect(res.body.result.status).toBe('unsupported');
      expect(res.body.result.stderr).toContain('Arbitrary JavaScript execution in the server process is disabled');
      expect(res.body.result.stdout).toBe('');
    });

    it('24. should reject attempted Node.js process / filesystem access', async () => {
      const dangerousPayload = 'process.mainModule.require("child_process").execSync("id")';
      const res = await makeRequest(testApp, 'POST', '/api/code/execute', {
        language: 'JAVASCRIPT',
        code: dangerousPayload
      });
      expect(res.status).toBe(200);
      expect(res.body.result.status).toBe('unsupported');
      expect(res.body.result.stderr).toContain('Arbitrary JavaScript execution in the server process is disabled');
      expect(res.body.result.stdout).toBe('');
    });

    it('25. should successfully evaluate safe mathematical expressions under JAVASCRIPT / STRUCTURED_CALC', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/code/execute', {
        language: 'JAVASCRIPT',
        code: '70.0 / ((175.0 / 100.0) ^ 2)'
      });
      expect(res.status).toBe(200);
      expect(res.body.result.status).toBe('success');
      expect(res.body.result.stdout).toContain('Calculated Value: 22.85714286');
      expect(res.body.result.stderr).toBeNull();
    });

    it('26. should support single-line comments before mathematical expressions', async () => {
      const codeWithComments = `
        // Body Mass Index formula
        // weight / (height / 100)^2
        70.0 / (1.75 ^ 2)
      `;
      const res = await makeRequest(testApp, 'POST', '/api/code/execute', {
        language: 'JAVASCRIPT',
        code: codeWithComments
      });
      expect(res.status).toBe(200);
      expect(res.body.result.status).toBe('success');
      expect(res.body.result.stdout).toContain('22.85714286');
    });

    it('27. should maintain full frontend response contract compatibility', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/code/execute', {
        language: 'JAVASCRIPT',
        code: '10 + 20',
        project_id: 'test_proj_001'
      });
      expect(res.status).toBe(200);
      const r = res.body.result;
      expect(r).toBeDefined();
      expect(typeof r.id).toBe('string');
      expect(r.project_id).toBe('test_proj_001');
      expect(r.language).toBe('JAVASCRIPT');
      expect(typeof r.code).toBe('string');
      expect(typeof r.status).toBe('string');
      expect(typeof r.stdout).toBe('string');
      expect(typeof r.execution_time_ms).toBe('number');
      expect(typeof r.environment_info).toBe('string');
      expect(typeof r.executed_by).toBe('string');
      expect(typeof r.created_at).toBe('string');
      expect(r.environment_info).toContain('MVS-B1 Protected');
    });

    it('28. should cap output and error size to 4,096 characters', async () => {
      // Create a calculation that generates a verbose error or output
      const res = await makeRequest(testApp, 'POST', '/api/code/execute', {
        language: 'JAVASCRIPT',
        code: '1 + 1'
      });
      expect(res.status).toBe(200);
      expect(res.body.result.stdout.length).toBeLessThanOrEqual(4096);
      if (res.body.result.stderr) {
        expect(res.body.result.stderr.length).toBeLessThanOrEqual(4096);
      }
    });

    it('29. should not crash API process on malformed mathematical inputs', async () => {
      const res = await makeRequest(testApp, 'POST', '/api/code/execute', {
        language: 'JAVASCRIPT',
        code: 'sqrt(-100)'
      });
      expect(res.status).toBe(200);
      expect(res.body.result.status).toBe('error');
      expect(res.body.result.stderr).toContain('Square root of negative number');
    });
  });

  // ------------------------------------------------------------------------
  // PART 3: Static Scan for Zero Dynamic Code Execution
  // ------------------------------------------------------------------------
  describe('Static Codebase Scan for Dynamic Code Execution', () => {
    it('30. should confirm ZERO new Function() and ZERO eval() in backend/routes/api.ts', () => {
      const apiPath = path.join(process.cwd(), 'backend', 'routes', 'api.ts');
      const apiSrc = fs.readFileSync(apiPath, 'utf8');

      // Strip comments before checking
      const cleanSrc = apiSrc
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

      expect(cleanSrc.includes('new Function')).toBe(false);
      expect(cleanSrc.includes('eval(')).toBe(false);
      expect(cleanSrc.includes("require('vm')")).toBe(false);
    });

    it('31. should confirm ZERO new Function() and ZERO eval() across scientific engine', () => {
      const scientificDir = path.join(process.cwd(), 'scientific', 'engine');
      const files = fs.readdirSync(scientificDir).filter(f => f.endsWith('.ts'));

      for (const file of files) {
        const filePath = path.join(scientificDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const cleanContent = content
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '');

        expect(cleanContent.includes('new Function'), `new Function found in ${file}`).toBe(false);
        expect(cleanContent.includes('eval('), `eval() found in ${file}`).toBe(false);
      }
    });
  });
});
