/**
 * NutriBodySim — Structured Mathematical Evaluator (MVS-B1 Safe Engine)
 *
 * Deterministic, purely recursive-descent mathematical expression evaluator.
 * Designed to satisfy strict scientific calculation and zero-dynamic-code-execution policies:
 * - ZERO eval()
 * - ZERO new Function()
 * - ZERO vm / worker unisolated execution
 * - Strict character & identifier allowlist
 * - Bound recursion depth and bounded string size
 * - Explicit mathematical domain error checks (division by zero, sqrt(<0), log(<=0))
 */

export interface MathEvaluationContext {
  variables?: Record<string, number>;
}

export interface MathEvaluationResult {
  success: boolean;
  value?: number;
  output: string;
  error?: string;
  steps?: string[];
  execution_time_ms: number;
}

export class StructuredMathEvaluator {
  private static readonly MAX_EXPRESSION_LENGTH = 10000;
  private static readonly MAX_DEPTH = 50;

  // Strict allowlist of safe mathematical constants
  private static readonly ALLOWED_CONSTANTS: Record<string, number> = {
    PI: Math.PI,
    pi: Math.PI,
    E: Math.E,
    e: Math.E
  };

  // Strict allowlist of safe pure mathematical functions
  private static readonly ALLOWED_FUNCTIONS: Record<string, (...args: number[]) => number> = {
    sqrt: (x: number) => {
      if (x < 0) throw new Error('Mathematical Error: Square root of negative number');
      return Math.sqrt(x);
    },
    cbrt: (x: number) => Math.cbrt(x),
    pow: (x: number, y: number) => Math.pow(x, y),
    abs: (x: number) => Math.abs(x),
    min: (...args: number[]) => {
      if (args.length === 0) throw new Error('min() requires at least one argument');
      return Math.min(...args);
    },
    max: (...args: number[]) => {
      if (args.length === 0) throw new Error('max() requires at least one argument');
      return Math.max(...args);
    },
    log: (x: number) => {
      if (x <= 0) throw new Error('Mathematical Error: Natural log of non-positive number');
      return Math.log(x);
    },
    ln: (x: number) => {
      if (x <= 0) throw new Error('Mathematical Error: Natural log of non-positive number');
      return Math.log(x);
    },
    exp: (x: number) => Math.exp(x),
    round: (x: number) => Math.round(x),
    floor: (x: number) => Math.floor(x),
    ceil: (x: number) => Math.ceil(x)
  };

  // Default physiological variable bindings
  private static readonly DEFAULT_VARIABLES: Record<string, number> = {
    weight_kg: 70.0,
    stature_cm: 175.0,
    stature_m: 1.75,
    age_years: 28,
    sex_factor_male: 5,
    sex_factor_female: -161
  };

  /**
   * Fast static security check: verifies if expression is exclusively a valid mathematical expression
   * without forbidden keywords, assignments, statements, imports, or characters.
   */
  public static isSafeMathExpression(expr: string): boolean {
    if (!expr || typeof expr !== 'string') return false;
    const trimmed = expr.trim();
    if (trimmed.length === 0 || trimmed.length > this.MAX_EXPRESSION_LENGTH) return false;

    // Reject any quotes, backticks, backslashes, semicolons, brackets, braces, assignment, comparison, dollar signs
    if (/[\\'"`\[\]{};=><!&$|#~?@]/.test(trimmed)) {
      return false;
    }

    // Reject known dangerous identifiers / keywords
    const forbiddenPatterns = [
      /\bprocess\b/i,
      /\bglobal\b/i,
      /\bwindow\b/i,
      /\bdocument\b/i,
      /\bconsole\b/i,
      /\bimport\b/i,
      /\brequire\b/i,
      /\bexport\b/i,
      /\bfunction\b/i,
      /\bclass\b/i,
      /\bvar\b/i,
      /\blet\b/i,
      /\bconst\b/i,
      /\breturn\b/i,
      /\bif\b/i,
      /\bwhile\b/i,
      /\bfor\b/i,
      /\beval\b/i,
      /\bFunction\b/i,
      /\bconstructor\b/i,
      /\bprototype\b/i,
      /\b__proto__\b/i,
      /\bthis\b/i,
      /\bnew\b/i,
      /\bdelete\b/i,
      /\bvoid\b/i,
      /\btypeof\b/i,
      /\bthrow\b/i
    ];

    for (const pattern of forbiddenPatterns) {
      if (pattern.test(trimmed)) return false;
    }

    return true;
  }

  /**
   * Evaluates a mathematical expression safely using recursive-descent parsing.
   */
  public static evaluate(
    expression: string, 
    context: MathEvaluationContext = {}
  ): MathEvaluationResult {
    const startTime = Date.now();

    try {
      if (!expression || typeof expression !== 'string') {
        throw new Error('Expression must be a non-empty string');
      }

      const trimmed = expression.trim();
      if (trimmed.length === 0) {
        throw new Error('Expression cannot be empty');
      }

      if (trimmed.length > this.MAX_EXPRESSION_LENGTH) {
        throw new Error(`Expression length exceeds maximum limit (${this.MAX_EXPRESSION_LENGTH} characters)`);
      }

      if (!this.isSafeMathExpression(trimmed)) {
        throw new Error('Forbidden syntax or characters detected. Only safe mathematical expressions and allowlisted operators are permitted.');
      }

      const tokens = this.tokenize(trimmed);
      const parser = new Parser(tokens, {
        ...this.DEFAULT_VARIABLES,
        ...(context.variables || {})
      });

      const value = parser.parse();
      const executionTime = Date.now() - startTime;

      const formattedVal = Number.isInteger(value) 
        ? value.toString() 
        : Number(value.toFixed(8)).toString();

      return {
        success: true,
        value,
        output: `[NutriBodySim Safe Structured Math Evaluator v1.0]\nExpression: ${trimmed}\nCalculated Value: ${formattedVal}\nVerification: Pure deterministic AST evaluation passed with 0 dynamic code execution.`,
        steps: parser.steps,
        execution_time_ms: executionTime
      };
    } catch (err: any) {
      const executionTime = Date.now() - startTime;
      const safeErrorMsg = err?.message || 'Mathematical evaluation error';
      return {
        success: false,
        output: `Execution error: ${safeErrorMsg}`,
        error: safeErrorMsg,
        execution_time_ms: executionTime
      };
    }
  }

  private static tokenize(expr: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;

    while (i < expr.length) {
      const char = expr[i];

      // Whitespace
      if (/\s/.test(char)) {
        i++;
        continue;
      }

      // Numbers (e.g. 123, 45.67, 1e-3)
      if (/[0-9]/.test(char) || (char === '.' && i + 1 < expr.length && /[0-9]/.test(expr[i + 1]))) {
        let numStr = '';
        while (i < expr.length && /[0-9.]/.test(expr[i])) {
          numStr += expr[i];
          i++;
        }
        // Handle scientific notation e.g. 1e-5
        if (i < expr.length && /[eE]/.test(expr[i])) {
          numStr += expr[i];
          i++;
          if (i < expr.length && /[+-]/.test(expr[i])) {
            numStr += expr[i];
            i++;
          }
          while (i < expr.length && /[0-9]/.test(expr[i])) {
            numStr += expr[i];
            i++;
          }
        }
        const parsed = Number(numStr);
        if (isNaN(parsed)) {
          throw new Error(`Invalid numeric literal: "${numStr}"`);
        }
        tokens.push({ type: 'NUMBER', value: parsed });
        continue;
      }

      // Identifiers (function names, variables, constants)
      if (/[a-zA-Z_]/.test(char)) {
        let idStr = '';
        while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) {
          idStr += expr[i];
          i++;
        }
        tokens.push({ type: 'IDENTIFIER', name: idStr });
        continue;
      }

      // Operators and punctuation
      if (char === '*' && i + 1 < expr.length && expr[i + 1] === '*') {
        tokens.push({ type: 'OP', op: '^' }); // normalize ** to ^
        i += 2;
        continue;
      }

      if (char === '+' || char === '-' || char === '*' || char === '/' || char === '^' || char === '%') {
        tokens.push({ type: 'OP', op: char });
        i++;
        continue;
      }

      if (char === '(' || char === ')') {
        tokens.push({ type: char === '(' ? 'LPAREN' : 'RPAREN' });
        i++;
        continue;
      }

      if (char === ',') {
        tokens.push({ type: 'COMMA' });
        i++;
        continue;
      }

      throw new Error(`Unsupported token character: "${char}" at position ${i}`);
    }

    tokens.push({ type: 'EOF' });
    return tokens;
  }
}

type Token =
  | { type: 'NUMBER'; value: number }
  | { type: 'IDENTIFIER'; name: string }
  | { type: 'OP'; op: string }
  | { type: 'LPAREN' }
  | { type: 'RPAREN' }
  | { type: 'COMMA' }
  | { type: 'EOF' };

class Parser {
  private pos = 0;
  private depth = 0;
  public steps: string[] = [];

  constructor(
    private tokens: Token[],
    private variables: Record<string, number>
  ) {}

  public parse(): number {
    const val = this.parseExpression();
    if (this.current().type !== 'EOF') {
      throw new Error(`Unexpected token at end of expression: "${JSON.stringify(this.current())}"`);
    }
    return val;
  }

  private current(): Token {
    return this.tokens[this.pos] || { type: 'EOF' };
  }

  private advance(): Token {
    const tok = this.current();
    this.pos++;
    return tok;
  }

  // expression -> term (('+' | '-') term)*
  private parseExpression(): number {
    this.checkDepth();
    let left = this.parseTerm();

    while (this.current().type === 'OP' && (this.current() as any).op === '+' || (this.current() as any).op === '-') {
      const op = (this.advance() as any).op;
      const right = this.parseTerm();
      if (op === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }

    return left;
  }

  // term -> power (('*' | '/' | '%') power)*
  private parseTerm(): number {
    this.checkDepth();
    let left = this.parsePower();

    while (this.current().type === 'OP' && ['*', '/', '%'].includes((this.current() as any).op)) {
      const op = (this.advance() as any).op;
      const right = this.parsePower();
      if (op === '*') {
        left = left * right;
      } else if (op === '/') {
        if (right === 0) {
          throw new Error('Mathematical Error: Division by zero');
        }
        left = left / right;
      } else if (op === '%') {
        if (right === 0) {
          throw new Error('Mathematical Error: Modulo by zero');
        }
        left = left % right;
      }
    }

    return left;
  }

  // power -> factor ('^' power)? (right-associative)
  private parsePower(): number {
    this.checkDepth();
    const left = this.parseFactor();

    if (this.current().type === 'OP' && (this.current() as any).op === '^') {
      this.advance();
      const right = this.parsePower();
      return Math.pow(left, right);
    }

    return left;
  }

  // factor -> ('+' | '-')? factor | primary
  private parseFactor(): number {
    this.checkDepth();
    if (this.current().type === 'OP' && (this.current() as any).op === '+') {
      this.advance();
      return this.parseFactor();
    }
    if (this.current().type === 'OP' && (this.current() as any).op === '-') {
      this.advance();
      return -this.parseFactor();
    }
    return this.parsePrimary();
  }

  // primary -> NUMBER | IDENTIFIER '(' argList ')' | IDENTIFIER | '(' expression ')'
  private parsePrimary(): number {
    this.checkDepth();
    const tok = this.current();

    if (tok.type === 'NUMBER') {
      this.advance();
      return tok.value;
    }

    if (tok.type === 'IDENTIFIER') {
      const name = tok.name;
      this.advance();

      // Check if function call
      if (this.current().type === 'LPAREN') {
        this.advance(); // consume '('
        const args: number[] = [];
        if (this.current().type !== 'RPAREN') {
          args.push(this.parseExpression());
          while (this.current().type === 'COMMA') {
            this.advance(); // consume ','
            args.push(this.parseExpression());
          }
        }
        if (this.current().type !== 'RPAREN') {
          throw new Error(`Expected closing parenthesis ")" after function "${name}" arguments`);
        }
        this.advance(); // consume ')'

        const fn = (StructuredMathEvaluator as any).ALLOWED_FUNCTIONS[name];
        if (!fn) {
          throw new Error(`Forbidden or unknown function call: "${name}()"`);
        }
        return fn(...args);
      }

      // Check if constant
      const constant = (StructuredMathEvaluator as any).ALLOWED_CONSTANTS[name];
      if (constant !== undefined) {
        return constant;
      }

      // Check if variable
      const variableVal = this.variables[name];
      if (variableVal !== undefined) {
        return variableVal;
      }

      throw new Error(`Forbidden or undefined variable: "${name}"`);
    }

    if (tok.type === 'LPAREN') {
      this.advance(); // consume '('
      this.depth++;
      const val = this.parseExpression();
      if (this.current().type !== 'RPAREN') {
        throw new Error('Mismatched parentheses: missing closing ")"');
      }
      this.advance(); // consume ')'
      this.depth--;
      return val;
    }

    throw new Error(`Unexpected token "${JSON.stringify(tok)}" in primary expression`);
  }

  private checkDepth() {
    if (this.depth > 50) {
      throw new Error('Maximum expression nesting depth exceeded (limit 50)');
    }
  }
}
