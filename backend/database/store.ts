/**
 * NutriBodySim — Persistent Relational Store & Seed Manager
 * 
 * Implements relational tables, foreign key checks, automatic audit trails,
 * and initializes base scientific registries and academic materials.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { 
  User, 
  Project, 
  ProjectMember, 
  Team, 
  TeamMember, 
  Material, 
  MaterialCollection, 
  ReadingProgress, 
  Bookmark, 
  Highlight, 
  Note, 
  Dataset, 
  DatasetVersion, 
  StatisticsAnalysis, 
  ChartRecord, 
  NutriNotebook, 
  NotebookCell, 
  CodeExecutionRecord, 
  Experiment, 
  AuditLog, 
  ProvenanceRecord,
  RoleRequest,
  RequestedRole,
  ExternalIdentity,
  UserRole,
  Permission,
  AccountStatus
} from './types';
import { defaultSessionStore } from '../auth/sessionStore';
import { 
  ScientificVariable, 
  ScientificUnit, 
  ScientificFormula, 
  ScientificAlgorithm, 
  ScientificModel, 
  ScientificParameter, 
  ScientificReference, 
  CalculationTrace,
  InterpretationRule,
  STANDARD_UNITS,
  DEMO_VARIABLES, 
  DEMO_PARAMETERS, 
  DEMO_FORMULAS, 
  DEMO_MODELS, 
  DEMO_REFERENCES,
  DEMO_INTERPRETATION_RULES 
} from '../../scientific';

export interface DatabaseState {
  users: User[];
  teams: Team[];
  team_members: TeamMember[];
  projects: Project[];
  project_members: ProjectMember[];
  materials: Material[];
  material_collections: MaterialCollection[];
  reading_progress: ReadingProgress[];
  bookmarks: Bookmark[];
  highlights: Highlight[];
  notes: Note[];
  units: ScientificUnit[];
  variables: ScientificVariable[];
  parameters: ScientificParameter[];
  formulas: ScientificFormula[];
  algorithms: ScientificAlgorithm[];
  models: ScientificModel[];
  references: ScientificReference[];
  interpretation_rules: InterpretationRule[];
  calculations: CalculationTrace[];
  datasets: Dataset[];
  dataset_versions: DatasetVersion[];
  statistics_analyses: StatisticsAnalysis[];
  charts: ChartRecord[];
  notebooks: NutriNotebook[];
  notebook_cells: NotebookCell[];
  code_executions: CodeExecutionRecord[];
  experiments: Experiment[];
  audit_logs: AuditLog[];
  provenance_records: ProvenanceRecord[];
  role_requests: RoleRequest[];
  external_identities: ExternalIdentity[];
}

const DEFAULT_DATA_DIR = path.join(process.cwd(), 'data');
const DEFAULT_DB_FILE = path.join(DEFAULT_DATA_DIR, 'nutribodysim_db.json');
const DEFAULT_STORAGE_DIR = path.join(process.cwd(), 'storage', 'materials');

export class DatabaseInitializationError extends Error {
  public readonly cause?: unknown;
  public readonly filePath: string;

  constructor(message: string, filePath: string, cause?: unknown) {
    super(message);
    this.name = 'DatabaseInitializationError';
    this.filePath = filePath;
    this.cause = cause;
    Object.setPrototypeOf(this, DatabaseInitializationError.prototype);
  }
}

export function resolveDatabasePath(): string {
  if (process.env.NUTRIBODYSIM_DB_PATH) {
    return path.resolve(process.env.NUTRIBODYSIM_DB_PATH);
  }
  return DEFAULT_DB_FILE;
}

export function resolveStorageDir(): string {
  if (process.env.NUTRIBODYSIM_STORAGE_DIR) {
    return path.resolve(process.env.NUTRIBODYSIM_STORAGE_DIR);
  }
  return DEFAULT_STORAGE_DIR;
}

export class DatabaseStore {
  private dbFilePath: string;
  private dataDir: string;
  private storageDir: string;
  private state: DatabaseState;

  constructor(customDbPath?: string, customStorageDir?: string) {
    this.dbFilePath = customDbPath ? path.resolve(customDbPath) : resolveDatabasePath();
    this.dataDir = path.dirname(this.dbFilePath);
    this.storageDir = customStorageDir ? path.resolve(customStorageDir) : resolveStorageDir();
    this.ensureDirectories();
    this.state = this.loadOrCreate();
  }

  public getDbFilePath(): string {
    return this.dbFilePath;
  }

  public setStoragePath(customDbPath: string, customStorageDir?: string): void {
    this.dbFilePath = path.resolve(customDbPath);
    this.dataDir = path.dirname(this.dbFilePath);
    if (customStorageDir) {
      this.storageDir = path.resolve(customStorageDir);
    }
    this.ensureDirectories();
    this.state = this.loadOrCreate();
  }

  private ensureDirectories() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  private loadOrCreate(): DatabaseState {
    let fileExists = false;
    try {
      fileExists = fs.existsSync(this.dbFilePath);
    } catch (fsErr) {
      throw new DatabaseInitializationError(
        `Failed to check existence of database file at ${this.dbFilePath}: ${(fsErr as Error).message}`,
        this.dbFilePath,
        fsErr
      );
    }

    if (fileExists) {
      let raw: string;
      try {
        raw = fs.readFileSync(this.dbFilePath, 'utf-8');
      } catch (readErr) {
        throw new DatabaseInitializationError(
          `Failed to read database file at ${this.dbFilePath}: ${(readErr as Error).message}`,
          this.dbFilePath,
          readErr
        );
      }

      let state: DatabaseState;
      try {
        state = JSON.parse(raw);
      } catch (parseErr) {
        throw new DatabaseInitializationError(
          `Failed to parse database JSON at ${this.dbFilePath}: ${(parseErr as Error).message}`,
          this.dbFilePath,
          parseErr
        );
      }

      if (!state || typeof state !== 'object' || Array.isArray(state)) {
        throw new DatabaseInitializationError(
          `Database file at ${this.dbFilePath} does not contain a valid DatabaseState object`,
          this.dbFilePath
        );
      }

      const collectionKeys: (keyof DatabaseState)[] = [
        'users',
        'teams',
        'team_members',
        'projects',
        'project_members',
        'materials',
        'material_collections',
        'reading_progress',
        'bookmarks',
        'highlights',
        'notes',
        'units',
        'variables',
        'parameters',
        'formulas',
        'algorithms',
        'models',
        'references',
        'interpretation_rules',
        'calculations',
        'datasets',
        'dataset_versions',
        'statistics_analyses',
        'charts',
        'notebooks',
        'notebook_cells',
        'code_executions',
        'experiments',
        'audit_logs',
        'provenance_records',
        'role_requests',
        'external_identities'
      ];

      for (const key of collectionKeys) {
        if (!Array.isArray(state[key])) {
          throw new DatabaseInitializationError(
            `Database file at ${this.dbFilePath} contains a missing or invalid collection '${key}' (expected an array)`,
            this.dbFilePath
          );
        }
      }

      let updated = false;
      for (const r of DEMO_INTERPRETATION_RULES) {
        if (!state.interpretation_rules.some(existing => existing.rule_id === r.rule_id)) {
          state.interpretation_rules.push(r);
          updated = true;
        }
      }
      for (const f of DEMO_FORMULAS) {
        const existingIdx = state.formulas.findIndex(existing => existing.formula_id === f.formula_id);
        if (existingIdx === -1) {
          state.formulas.push(f);
          updated = true;
        } else if (f.formula_id === 'FORMULA_BMR_MIFFLIN' && state.formulas[existingIdx].version !== f.version) {
          state.formulas[existingIdx] = f;
          updated = true;
        }
      }
      for (const v of DEMO_VARIABLES) {
        if (!state.variables.some(existing => existing.variable_id === v.variable_id)) {
          state.variables.push(v);
          updated = true;
        }
      }
      for (const p of DEMO_PARAMETERS) {
        if (!state.parameters.some(existing => existing.parameter_id === p.parameter_id)) {
          state.parameters.push(p);
          updated = true;
        }
      }
      for (const u of STANDARD_UNITS) {
        if (!state.units.some(existing => existing.unit_id === u.unit_id)) {
          state.units.push(u);
          updated = true;
        }
      }
      for (const user of state.users) {
        if (!user.account_status) {
          user.account_status = 'ACTIVE';
          updated = true;
        }
        if (user.token_version === undefined) {
          user.token_version = 1;
          updated = true;
        }
        if (user.email_verified === undefined) {
          user.email_verified = true;
          updated = true;
        }
        if (!user.provider) {
          user.provider = 'local';
          user.provider_subject_id = `local_${user.id}`;
          updated = true;
        }
        if (!user.display_name) {
          user.display_name = user.name;
          updated = true;
        }
        if (!user.updated_at) {
          user.updated_at = user.created_at || '2026-09-21T10:00:00.000Z';
          updated = true;
        }
      }
      if (updated) {
        this.saveToDisk(state);
      }
      return state;
    }

      // Bootstrap case: database file does not exist on disk
      const fresh = this.generateSeedData();
      this.saveToDisk(fresh);
      return fresh;
    }

    public save() {
      this.saveToDisk(this.state);
    }

    public reseed(): DatabaseState {
      const resolvedTarget = path.resolve(this.dbFilePath);
      const resolvedDefault = path.resolve(DEFAULT_DB_FILE);

      // Hard fail-safe: NEVER reseed the active working database in test mode!
      if ((process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') && resolvedTarget === resolvedDefault) {
        throw new Error(
          `FATAL SAFETY VIOLATION: Reseed of active working database (${DEFAULT_DB_FILE}) blocked in test mode. Tests must configure an isolated test database path.`
        );
      }

      this.state = this.generateSeedData();
      this.saveToDisk(this.state);
      return this.state;
    }

    private saveToDisk(data: DatabaseState) {
      const resolvedTarget = path.resolve(this.dbFilePath);
      const resolvedDefault = path.resolve(DEFAULT_DB_FILE);

      // Hard fail-safe: NEVER write to the active working database in test mode!
      if ((process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') && resolvedTarget === resolvedDefault) {
        throw new Error(
          `FATAL SAFETY VIOLATION: Write operation to active working database (${DEFAULT_DB_FILE}) blocked in test mode. Tests must configure an isolated test database path.`
        );
      }

      const tmpFile = `${this.dbFilePath}.tmp.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
      fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmpFile, this.dbFilePath);
    }

  public getState(): DatabaseState {
    return this.state;
  }

  public setState(newState: DatabaseState): void {
    this.state = newState;
  }

  public logAudit(
    userId: string,
    action: AuditLog['action'],
    entityType: string,
    entityId: string,
    details: string,
    ipAddress?: string
  ): AuditLog {
    const user = this.state.users.find(u => u.id === userId);
    const log: AuditLog = {
      id: `AUDIT_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      user_id: userId,
      user_name: user ? user.name : 'Unknown User',
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
      ip_address: ipAddress || '127.0.0.1',
      timestamp: new Date().toISOString()
    };
    this.state.audit_logs.unshift(log);
    if (this.state.audit_logs.length > 1000) {
      this.state.audit_logs.pop();
    }
    this.save();
    return log;
  }

  /**
   * Finds an external identity by provider and provider_subject_id.
   */
  public findExternalIdentity(provider: string, providerSubjectId: string): ExternalIdentity | undefined {
    if (!this.state.external_identities) {
      this.state.external_identities = [];
    }
    return this.state.external_identities.find(
      e => e.provider.toLowerCase() === provider.toLowerCase() && e.provider_subject_id === providerSubjectId
    );
  }

  /**
   * Links an external identity to an existing internal user.
   * Enforces:
   * 1. Valid non-empty provider and provider_subject_id.
   * 2. Target user must exist in the database.
   * 3. Unique constraint on (provider + provider_subject_id).
   * 4. Does NOT automatically merge accounts based on email.
   */
  public linkExternalIdentity(identity: ExternalIdentity): ExternalIdentity {
    if (!identity.provider || typeof identity.provider !== 'string' || !identity.provider.trim()) {
      throw new Error('Provider is required and must be a non-empty string.');
    }
    if (!identity.provider_subject_id || typeof identity.provider_subject_id !== 'string' || !identity.provider_subject_id.trim()) {
      throw new Error('provider_subject_id is required and must be a non-empty string.');
    }
    if (!identity.user_id || typeof identity.user_id !== 'string') {
      throw new Error('Valid internal user_id is required to link an external identity.');
    }

    const user = this.state.users.find(u => u.id === identity.user_id);
    if (!user) {
      throw new Error(`Target user with id '${identity.user_id}' does not exist.`);
    }

    const existing = this.findExternalIdentity(identity.provider, identity.provider_subject_id);
    if (existing) {
      throw new Error(
        `Unique constraint violation: External identity (${identity.provider}, ${identity.provider_subject_id}) is already registered.`
      );
    }

    const normalizedIdentity: ExternalIdentity = {
      provider: identity.provider,
      provider_subject_id: identity.provider_subject_id.trim(),
      user_id: user.id,
      email: identity.email,
      email_verified: Boolean(identity.email_verified),
      linked_at: identity.linked_at || new Date().toISOString()
    };

    if (!this.state.external_identities) {
      this.state.external_identities = [];
    }
    this.state.external_identities.push(normalizedIdentity);

    if (!user.external_identities) {
      user.external_identities = [];
    }
    user.external_identities.push(normalizedIdentity);
    user.updated_at = new Date().toISOString();

    this.save();
    return normalizedIdentity;
  }

  /**
   * Retrieves a user by their internal user identifier.
   */
  public getUserById(userId: string): User | undefined {
    if (!userId || typeof userId !== 'string') return undefined;
    const trimmed = userId.trim();
    return this.state.users.find(u => u.id === trimmed || u.user_id === trimmed);
  }

  /**
   * Retrieves a user by their email address (case-insensitive lookup).
   */
  public getUserByEmail(email: string): User | undefined {
    if (!email || typeof email !== 'string') return undefined;
    const normalized = email.trim().toLowerCase();
    return this.state.users.find(u => typeof u.email === 'string' && u.email.trim().toLowerCase() === normalized);
  }

  /**
   * Transactionally provisions a new local User and associated ExternalIdentity
   * for a verified Google OIDC identity.
   *
   * Core Guarantees:
   * 1. Assigns strictly unprivileged 'RegisteredUser' role with empty permissions ([]).
   * 2. Anti-auto-merge: Fails closed if normalized email matches an existing local user.
   * 3. Idempotency: Fails closed if (provider='google', provider_subject_id=sub) already registered.
   * 4. Validates and sanitizes profile fields (name, display_name, avatar_url).
   * 5. Atomicity: In-memory mutation with snapshot rollback if disk serialization fails.
   * 6. Audit logging: Automatically creates an immutable audit trail record.
   */
  public provisionGoogleUser(params: {
    identity: {
      provider: 'google';
      sub: string;
      email: string;
      emailVerified?: boolean;
      profile?: {
        name?: string;
        picture?: string;
        givenName?: string;
        familyName?: string;
      };
    };
    ipAddress?: string;
    currentTime?: number;
  }): { user: User; externalIdentity: ExternalIdentity; auditLog: AuditLog } {
    const { identity, ipAddress, currentTime } = params;

    if (!identity || typeof identity !== 'object') {
      throw new Error('PROVISIONING_ERROR: Identity object is required.');
    }
    if (identity.provider !== 'google') {
      throw new Error(`PROVISIONING_ERROR: Provider must be 'google', received '${identity.provider}'.`);
    }
    if (!identity.sub || typeof identity.sub !== 'string' || !identity.sub.trim()) {
      throw new Error('PROVISIONING_ERROR: Valid Google sub (provider_subject_id) is required.');
    }
    if (!identity.email || typeof identity.email !== 'string' || !identity.email.trim()) {
      throw new Error('PROVISIONING_ERROR: Valid email address is required.');
    }
    if (identity.emailVerified !== true) {
      throw new Error('PROVISIONING_ERROR: Email must be verified by Google (emailVerified === true).');
    }

    const trimmedSub = identity.sub.trim();
    const normalizedEmail = identity.email.trim().toLowerCase();

    // 1. Check existing external identity
    const existingIdentity = this.findExternalIdentity('google', trimmedSub);
    if (existingIdentity) {
      const err: any = new Error(
        `DUPLICATE_EXTERNAL_IDENTITY: External identity (google, ${trimmedSub}) is already linked to user '${existingIdentity.user_id}'.`
      );
      err.code = 'DUPLICATE_EXTERNAL_IDENTITY';
      err.existingUserId = existingIdentity.user_id;
      throw err;
    }

    // 2. Check email collision against local users (Anti-Auto-Merge)
    const conflictingUser = this.getUserByEmail(normalizedEmail);
    if (conflictingUser) {
      const err: any = new Error(
        `EMAIL_CONFLICT: Email '${normalizedEmail}' already belongs to local user '${conflictingUser.id}'. Auto-merge is strictly forbidden.`
      );
      err.code = 'EMAIL_CONFLICT';
      err.conflictingUserId = conflictingUser.id;
      throw err;
    }

    // 3. Profile sanitization
    let rawName = identity.profile?.name?.trim();
    if (!rawName && (identity.profile?.givenName || identity.profile?.familyName)) {
      rawName = [identity.profile?.givenName, identity.profile?.familyName].filter(Boolean).join(' ').trim();
    }
    if (!rawName) {
      rawName = normalizedEmail.split('@')[0] || 'Google User';
    }
    const sanitizedName = rawName.replace(/<[^>]*>/g, '').replace(/[\x00-\x1F\x7F]/g, '').trim().substring(0, 100);

    let sanitizedAvatarUrl: string | undefined = undefined;
    if (identity.profile?.picture && typeof identity.profile.picture === 'string') {
      const pic = identity.profile.picture.trim();
      if (pic.startsWith('https://')) {
        sanitizedAvatarUrl = pic.substring(0, 500);
      }
    }

    const nowIso = currentTime ? new Date(currentTime).toISOString() : new Date().toISOString();
    const newUserId = `usr_google_${crypto.randomBytes(8).toString('hex')}`;

    // 4. Construct entities
    const newUser: User = {
      id: newUserId,
      user_id: newUserId,
      email: normalizedEmail,
      name: sanitizedName,
      display_name: sanitizedName,
      role: 'RegisteredUser',
      permissions: [],
      avatar_url: sanitizedAvatarUrl,
      created_at: nowIso,
      updated_at: nowIso,
      last_login_at: nowIso,
      account_status: 'ACTIVE',
      email_verified: true,
      provider: 'google',
      provider_subject_id: trimmedSub,
      external_identities: [],
      token_version: 1
    };

    const newExternalIdentity: ExternalIdentity = {
      provider: 'google',
      provider_subject_id: trimmedSub,
      user_id: newUserId,
      email: normalizedEmail,
      email_verified: true,
      linked_at: nowIso
    };

    newUser.external_identities = [newExternalIdentity];

    const auditLog: AuditLog = {
      id: `AUDIT_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      user_id: newUserId,
      user_name: sanitizedName,
      action: 'OIDC_ACCOUNT_PROVISION',
      entity_type: 'USER',
      entity_id: newUserId,
      details: `New account provisioned via Google OIDC for ${sanitizedName} (${normalizedEmail}) with unprivileged role RegisteredUser.`,
      ip_address: ipAddress || '127.0.0.1',
      timestamp: nowIso,
      metadata: {
        provider: 'google',
        provider_subject_id: trimmedSub,
        email: normalizedEmail,
        role: 'RegisteredUser',
        account_status: 'ACTIVE'
      }
    };

    // 5. Atomic in-memory mutation with rollback protection on disk failure
    if (!this.state.external_identities) {
      this.state.external_identities = [];
    }
    if (!this.state.audit_logs) {
      this.state.audit_logs = [];
    }

    this.state.users.push(newUser);
    this.state.external_identities.push(newExternalIdentity);
    this.state.audit_logs.unshift(auditLog);
    if (this.state.audit_logs.length > 1000) {
      this.state.audit_logs.pop();
    }

    try {
      this.saveToDisk(this.state);
    } catch (saveError) {
      // Rollback all in-memory mutations
      const userIdx = this.state.users.findIndex(u => u.id === newUserId);
      if (userIdx !== -1) {
        this.state.users.splice(userIdx, 1);
      }

      const identIdx = this.state.external_identities.findIndex(
        e => e.provider === 'google' && e.provider_subject_id === trimmedSub
      );
      if (identIdx !== -1) {
        this.state.external_identities.splice(identIdx, 1);
      }

      const auditIdx = this.state.audit_logs.findIndex(a => a.id === auditLog.id);
      if (auditIdx !== -1) {
        this.state.audit_logs.splice(auditIdx, 1);
      }

      throw saveError;
    }

    return {
      user: newUser,
      externalIdentity: newExternalIdentity,
      auditLog
    };
  }

  /**
   * Retrieves all external identities registered for an internal user.
   */
  public getExternalIdentitiesForUser(userId: string): ExternalIdentity[] {
    if (!this.state.external_identities) return [];
    return this.state.external_identities.filter(e => e.user_id === userId);
  }

  /**
   * Retrieves all role requests, sorted newest first.
   */
  public getRoleRequests(): RoleRequest[] {
    if (!this.state.role_requests) {
      this.state.role_requests = [];
    }
    return [...this.state.role_requests].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  /**
   * Retrieves role requests submitted by a specific user.
   */
  public getRoleRequestsForUser(userId: string): RoleRequest[] {
    if (!this.state.role_requests) {
      this.state.role_requests = [];
    }
    return this.state.role_requests
      .filter(r => r.user_id === userId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  /**
   * Finds a role request by its unique request_id.
   */
  public findRoleRequestById(requestId: string): RoleRequest | undefined {
    if (!this.state.role_requests) {
      this.state.role_requests = [];
    }
    return this.state.role_requests.find(r => r.request_id === requestId);
  }

  /**
   * Storage-level atomic role request creation with validation, audit logging,
   * duplicate check, and failure rollback.
   */
  public createRoleRequest(params: {
    userId: string;
    requestedRole: RequestedRole;
    institution?: string;
    justification?: string;
    ipAddress?: string;
  }): { roleRequest: RoleRequest; auditLog: AuditLog } {
    // 1. Storage validation: verify user exists
    const user = this.state.users.find(u => u.id === params.userId);
    if (!user) {
      throw new Error(`User '${params.userId}' not found in registry.`);
    }

    // 2. Storage validation: verify account status
    if (user.account_status && user.account_status !== 'ACTIVE') {
      throw new Error(`Account status is '${user.account_status}'. Only ACTIVE users can create role requests.`);
    }

    // 3. Storage validation: verify requested role enum
    const validRoles: RequestedRole[] = ['Student', 'Lecturer', 'Researcher', 'Admin'];
    if (!validRoles.includes(params.requestedRole)) {
      throw new Error(`Invalid requested role '${params.requestedRole}'.`);
    }

    // 4. Storage validation: duplicate pending check
    if (!this.state.role_requests) {
      this.state.role_requests = [];
    }
    const duplicate = this.state.role_requests.find(
      r => r.user_id === params.userId && r.approval_status === 'PENDING' && r.requested_role === params.requestedRole
    );
    if (duplicate) {
      throw new Error(`Duplicate pending role request exists for role '${params.requestedRole}'.`);
    }

    // 5. Construct entities
    const requestId = `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    const newRequest: RoleRequest = {
      request_id: requestId,
      user_id: user.id,
      requested_role: params.requestedRole,
      approval_status: 'PENDING',
      institution: params.institution,
      justification: params.justification,
      created_at: now,
      reviewed_by: null,
      reviewed_at: null,
      review_reason: null
    };

    const auditLog: AuditLog = {
      id: `AUDIT_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      user_id: user.id,
      user_name: user.name,
      action: 'CREATE',
      entity_type: 'ROLE_REQUEST',
      entity_id: requestId,
      details: `Role elevation request submitted for ${params.requestedRole} by ${user.name} (${user.id})`,
      ip_address: params.ipAddress || '127.0.0.1',
      timestamp: now
    };

    // 6. Staged state mutation with rollback guarantee on disk failure
    this.state.role_requests.push(newRequest);
    this.state.audit_logs.unshift(auditLog);
    if (this.state.audit_logs.length > 1000) {
      this.state.audit_logs.pop();
    }

    try {
      this.saveToDisk(this.state);
    } catch (saveError) {
      const idx = this.state.role_requests.findIndex(r => r.request_id === requestId);
      if (idx !== -1) {
        this.state.role_requests.splice(idx, 1);
      }
      const auditIdx = this.state.audit_logs.findIndex(a => a.id === auditLog.id);
      if (auditIdx !== -1) {
        this.state.audit_logs.splice(auditIdx, 1);
      }
      throw saveError;
    }

    return { roleRequest: newRequest, auditLog };
  }

  /**
   * Approves a pending role request (MVS-B2.5B.3).
   *
   * Enforces:
   * 1. Reload and verify request exists and is strictly 'PENDING'.
   * 2. Verify target user exists and account_status === 'ACTIVE'.
   * 3. Verify reviewer exists and account_status === 'ACTIVE'.
   * 4. Enforce anti-self-approval (reviewerId !== targetUser.id).
   * 5. Enforce risk-tier reviewer authority:
   *    - RequestedRole === 'Admin' requires active Main Administrator (is_main_admin === true && role === 'Admin').
   *    - Academic roles require ADMIN permission.
   * 6. Target user role updated to requested_role.
   * 7. Target user permissions updated to new role defaults.
   * 8. Target user token_version incremented ((token_version || 1) + 1).
   * 9. Audit log entry recorded with action 'ROLE_APPROVAL'.
   * 10. Atomic staging with rollback of user, role_request, and audit_log if disk save fails.
   */
  public approveRoleRequest(params: {
    requestId: string;
    reviewerId: string;
    reviewReason?: string;
    ipAddress?: string;
  }): { roleRequest: RoleRequest; updatedUser: User; auditLog: AuditLog } {
    const { requestId, reviewerId, reviewReason, ipAddress } = params;

    if (!this.state.role_requests) {
      this.state.role_requests = [];
    }

    // 1. Reload & check request
    const roleRequest = this.state.role_requests.find(r => r.request_id === requestId);
    if (!roleRequest) {
      const err: any = new Error(`Role request '${requestId}' not found in registry.`);
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (roleRequest.approval_status !== 'PENDING') {
      const err: any = new Error(
        `Role request '${requestId}' is already finalized with status '${roleRequest.approval_status}' and cannot be processed again.`
      );
      err.statusCode = 409;
      err.code = 'ALREADY_FINALIZED';
      err.current_status = roleRequest.approval_status;
      throw err;
    }

    // 2. Validate Target User
    const targetUser = this.state.users.find(u => u.id === roleRequest.user_id);
    if (!targetUser) {
      const err: any = new Error(`Target user '${roleRequest.user_id}' not found in registry.`);
      err.statusCode = 404;
      err.code = 'USER_NOT_FOUND';
      throw err;
    }

    if (targetUser.account_status && targetUser.account_status !== 'ACTIVE') {
      const err: any = new Error(
        `Target user '${targetUser.name}' has account status '${targetUser.account_status}'. Only ACTIVE accounts can be elevated.`
      );
      err.statusCode = 403;
      err.code = 'TARGET_NOT_ACTIVE';
      throw err;
    }

    // 3. Validate Reviewer
    const reviewer = this.state.users.find(u => u.id === reviewerId);
    if (!reviewer) {
      const err: any = new Error(`Reviewer '${reviewerId}' not found in registry.`);
      err.statusCode = 404;
      err.code = 'REVIEWER_NOT_FOUND';
      throw err;
    }

    if (reviewer.account_status && reviewer.account_status !== 'ACTIVE') {
      const err: any = new Error(
        `Reviewer '${reviewer.name}' has account status '${reviewer.account_status}'. Inactive or suspended accounts cannot process requests.`
      );
      err.statusCode = 403;
      err.code = 'REVIEWER_NOT_ACTIVE';
      throw err;
    }

    // 4. Anti-Self-Approval
    if (reviewer.id === targetUser.id) {
      const err: any = new Error('Reviewers cannot approve their own role elevation requests.');
      err.statusCode = 403;
      err.code = 'SELF_APPROVAL_PROHIBITED';
      throw err;
    }

    // 5. Reviewer Authority Check
    if (roleRequest.requested_role === 'Admin') {
      const isMainAdmin = Boolean(reviewer.is_main_admin === true && reviewer.role === 'Admin');
      if (!isMainAdmin) {
        const err: any = new Error(
          'Approval of Administrator role requires active Main Administrator governance authority. Regular Administrators cannot approve Admin elevation.'
        );
        err.statusCode = 403;
        err.code = 'INSUFFICIENT_ADMIN_PRIVILEGE';
        throw err;
      }
    } else {
      // Academic elevation requires ADMIN permission
      const hasAdminPerm = reviewer.role === 'Admin' || (Array.isArray(reviewer.permissions) && reviewer.permissions.includes('ADMIN'));
      if (!hasAdminPerm) {
        const err: any = new Error('Administrative privilege (ADMIN permission) is required to review role requests.');
        err.statusCode = 403;
        err.code = 'FORBIDDEN';
        throw err;
      }
    }

    // Snapshot state for atomic rollback on failure
    const prevTargetRole = targetUser.role;
    const prevTargetPermissions = [...targetUser.permissions];
    const prevTargetTokenVersion = targetUser.token_version;
    const prevTargetUpdatedAt = targetUser.updated_at;

    const prevReqStatus = roleRequest.approval_status;
    const prevReqReviewedBy = roleRequest.reviewed_by;
    const prevReqReviewedAt = roleRequest.reviewed_at;
    const prevReqReviewReason = roleRequest.review_reason;

    const now = new Date().toISOString();
    const sanitizedReason = (reviewReason && typeof reviewReason === 'string' && reviewReason.trim()) 
      ? reviewReason.trim().replace(/<[^>]*>/g, '') 
      : 'Role elevation approved by administrator.';

    // Apply mutations
    roleRequest.approval_status = 'APPROVED';
    roleRequest.reviewed_by = reviewer.id;
    roleRequest.reviewed_at = now;
    roleRequest.review_reason = sanitizedReason;

    const rolePermissionsMap: Record<UserRole, Permission[]> = {
      RegisteredUser: [],
      Student: ['VIEW', 'USE', 'CREATE', 'CLONE'],
      Lecturer: ['VIEW', 'USE', 'CREATE', 'CLONE', 'EDIT', 'SHARE', 'PUBLISH'],
      Researcher: ['VIEW', 'USE', 'CREATE', 'CLONE', 'EDIT', 'SHARE', 'PUBLISH'],
      Admin: ['VIEW', 'USE', 'CREATE', 'CLONE', 'EDIT', 'DELETE', 'SHARE', 'PUBLISH', 'VERIFY', 'ADMIN']
    };

    targetUser.role = roleRequest.requested_role;
    targetUser.permissions = [...(rolePermissionsMap[roleRequest.requested_role] || [])];
    targetUser.token_version = (targetUser.token_version || 1) + 1;
    targetUser.updated_at = now;

    const auditLog: AuditLog = {
      id: `AUDIT_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      user_id: reviewer.id,
      user_name: reviewer.name,
      action: 'ROLE_APPROVAL',
      entity_type: 'ROLE_REQUEST',
      entity_id: roleRequest.request_id,
      details: `Role request ${roleRequest.request_id} APPROVED by ${reviewer.name} (${reviewer.id}): ${targetUser.name} (${targetUser.id}) elevated from ${prevTargetRole} to ${targetUser.role}.`,
      ip_address: ipAddress || '127.0.0.1',
      timestamp: now,
      metadata: {
        request_id: roleRequest.request_id,
        requester_id: targetUser.id,
        reviewer_id: reviewer.id,
        previous_role: prevTargetRole,
        new_role: targetUser.role,
        previous_status: prevReqStatus,
        new_status: 'APPROVED',
        review_reason: sanitizedReason
      }
    };

    this.state.audit_logs.unshift(auditLog);
    if (this.state.audit_logs.length > 1000) {
      this.state.audit_logs.pop();
    }

    try {
      this.saveToDisk(this.state);
    } catch (saveError) {
      // Rollback targetUser
      targetUser.role = prevTargetRole;
      targetUser.permissions = prevTargetPermissions;
      targetUser.token_version = prevTargetTokenVersion;
      targetUser.updated_at = prevTargetUpdatedAt;

      // Rollback roleRequest
      roleRequest.approval_status = prevReqStatus;
      roleRequest.reviewed_by = prevReqReviewedBy;
      roleRequest.reviewed_at = prevReqReviewedAt;
      roleRequest.review_reason = prevReqReviewReason;

      // Rollback auditLog
      const auditIdx = this.state.audit_logs.findIndex(a => a.id === auditLog.id);
      if (auditIdx !== -1) {
        this.state.audit_logs.splice(auditIdx, 1);
      }
      throw saveError;
    }

    // Revoke active sessions for target user in session store
    defaultSessionStore.revokeSessionsForUser(targetUser.id);

    return { roleRequest, updatedUser: targetUser, auditLog };
  }

  /**
   * Rejects a pending role request (MVS-B2.5B.3).
   */
  public rejectRoleRequest(params: {
    requestId: string;
    reviewerId: string;
    reviewReason: string;
    ipAddress?: string;
  }): { roleRequest: RoleRequest; auditLog: AuditLog } {
    const { requestId, reviewerId, reviewReason, ipAddress } = params;

    if (!this.state.role_requests) {
      this.state.role_requests = [];
    }

    const roleRequest = this.state.role_requests.find(r => r.request_id === requestId);
    if (!roleRequest) {
      const err: any = new Error(`Role request '${requestId}' not found in registry.`);
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (roleRequest.approval_status !== 'PENDING') {
      const err: any = new Error(
        `Role request '${requestId}' is already finalized with status '${roleRequest.approval_status}' and cannot be processed again.`
      );
      err.statusCode = 409;
      err.code = 'ALREADY_FINALIZED';
      err.current_status = roleRequest.approval_status;
      throw err;
    }

    const reviewer = this.state.users.find(u => u.id === reviewerId);
    if (!reviewer) {
      const err: any = new Error(`Reviewer '${reviewerId}' not found in registry.`);
      err.statusCode = 404;
      err.code = 'REVIEWER_NOT_FOUND';
      throw err;
    }

    if (reviewer.account_status && reviewer.account_status !== 'ACTIVE') {
      const err: any = new Error(
        `Reviewer '${reviewer.name}' has account status '${reviewer.account_status}'. Inactive or suspended accounts cannot process requests.`
      );
      err.statusCode = 403;
      err.code = 'REVIEWER_NOT_ACTIVE';
      throw err;
    }

    // Anti-Self-Review
    if (reviewer.id === roleRequest.user_id) {
      const err: any = new Error('Reviewers cannot reject their own role elevation requests.');
      err.statusCode = 403;
      err.code = 'SELF_APPROVAL_PROHIBITED';
      throw err;
    }

    // Reviewer Authority
    if (roleRequest.requested_role === 'Admin') {
      const isMainAdmin = Boolean(reviewer.is_main_admin === true && reviewer.role === 'Admin');
      if (!isMainAdmin) {
        const err: any = new Error(
          'Rejection of Administrator elevation requires active Main Administrator governance authority.'
        );
        err.statusCode = 403;
        err.code = 'INSUFFICIENT_ADMIN_PRIVILEGE';
        throw err;
      }
    } else {
      const hasAdminPerm = reviewer.role === 'Admin' || (Array.isArray(reviewer.permissions) && reviewer.permissions.includes('ADMIN'));
      if (!hasAdminPerm) {
        const err: any = new Error('Administrative privilege (ADMIN permission) is required to review role requests.');
        err.statusCode = 403;
        err.code = 'FORBIDDEN';
        throw err;
      }
    }

    if (!reviewReason || typeof reviewReason !== 'string' || reviewReason.trim().length < 5) {
      const err: any = new Error('A comprehensive review_reason (minimum 5 characters) is required for role request rejection.');
      err.statusCode = 400;
      err.code = 'REVIEW_REASON_REQUIRED';
      throw err;
    }

    const prevReqStatus = roleRequest.approval_status;
    const prevReqReviewedBy = roleRequest.reviewed_by;
    const prevReqReviewedAt = roleRequest.reviewed_at;
    const prevReqReviewReason = roleRequest.review_reason;

    const now = new Date().toISOString();
    const sanitizedReason = reviewReason.trim().replace(/<[^>]*>/g, '');

    roleRequest.approval_status = 'REJECTED';
    roleRequest.reviewed_by = reviewer.id;
    roleRequest.reviewed_at = now;
    roleRequest.review_reason = sanitizedReason;

    const auditLog: AuditLog = {
      id: `AUDIT_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      user_id: reviewer.id,
      user_name: reviewer.name,
      action: 'ROLE_APPROVAL',
      entity_type: 'ROLE_REQUEST',
      entity_id: roleRequest.request_id,
      details: `Role request ${roleRequest.request_id} REJECTED by ${reviewer.name} (${reviewer.id}) for requested role ${roleRequest.requested_role}. Reason: ${sanitizedReason}`,
      ip_address: ipAddress || '127.0.0.1',
      timestamp: now,
      metadata: {
        request_id: roleRequest.request_id,
        requester_id: roleRequest.user_id,
        reviewer_id: reviewer.id,
        requested_role: roleRequest.requested_role,
        previous_status: prevReqStatus,
        new_status: 'REJECTED',
        review_reason: sanitizedReason
      }
    };

    this.state.audit_logs.unshift(auditLog);
    if (this.state.audit_logs.length > 1000) {
      this.state.audit_logs.pop();
    }

    try {
      this.saveToDisk(this.state);
    } catch (saveError) {
      roleRequest.approval_status = prevReqStatus;
      roleRequest.reviewed_by = prevReqReviewedBy;
      roleRequest.reviewed_at = prevReqReviewedAt;
      roleRequest.review_reason = prevReqReviewReason;

      const auditIdx = this.state.audit_logs.findIndex(a => a.id === auditLog.id);
      if (auditIdx !== -1) {
        this.state.audit_logs.splice(auditIdx, 1);
      }
      throw saveError;
    }

    return { roleRequest, auditLog };
  }

  /**
   * Cancels a pending role request by the original requester (MVS-B2.5B.3).
   */
  public cancelRoleRequest(params: {
    requestId: string;
    callerId: string;
    ipAddress?: string;
  }): { roleRequest: RoleRequest; auditLog: AuditLog } {
    const { requestId, callerId, ipAddress } = params;

    if (!this.state.role_requests) {
      this.state.role_requests = [];
    }

    const roleRequest = this.state.role_requests.find(r => r.request_id === requestId);
    if (!roleRequest) {
      const err: any = new Error(`Role request '${requestId}' not found in registry.`);
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (roleRequest.approval_status !== 'PENDING') {
      const err: any = new Error(
        `Role request '${requestId}' is already finalized with status '${roleRequest.approval_status}' and cannot be cancelled.`
      );
      err.statusCode = 409;
      err.code = 'ALREADY_FINALIZED';
      err.current_status = roleRequest.approval_status;
      throw err;
    }

    if (roleRequest.user_id !== callerId) {
      const err: any = new Error('You may only cancel your own role elevation requests.');
      err.statusCode = 403;
      err.code = 'FORBIDDEN_NOT_OWNER';
      throw err;
    }

    const caller = this.state.users.find(u => u.id === callerId);
    const prevReqStatus = roleRequest.approval_status;
    const now = new Date().toISOString();

    roleRequest.approval_status = 'CANCELLED';
    roleRequest.reviewed_at = now;
    roleRequest.review_reason = 'Cancelled by owner';

    const auditLog: AuditLog = {
      id: `AUDIT_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      user_id: callerId,
      user_name: caller ? caller.name : 'Unknown Caller',
      action: 'ROLE_APPROVAL',
      entity_type: 'ROLE_REQUEST',
      entity_id: roleRequest.request_id,
      details: `Role request ${roleRequest.request_id} CANCELLED by owner ${caller ? caller.name : callerId}.`,
      ip_address: ipAddress || '127.0.0.1',
      timestamp: now,
      metadata: {
        request_id: roleRequest.request_id,
        requester_id: callerId,
        previous_status: prevReqStatus,
        new_status: 'CANCELLED'
      }
    };

    this.state.audit_logs.unshift(auditLog);
    if (this.state.audit_logs.length > 1000) {
      this.state.audit_logs.pop();
    }

    try {
      this.saveToDisk(this.state);
    } catch (saveError) {
      roleRequest.approval_status = prevReqStatus;
      roleRequest.reviewed_at = null;
      roleRequest.review_reason = null;

      const auditIdx = this.state.audit_logs.findIndex(a => a.id === auditLog.id);
      if (auditIdx !== -1) {
        this.state.audit_logs.splice(auditIdx, 1);
      }
      throw saveError;
    }

    return { roleRequest, auditLog };
  }

  /**
   * Updates a user's account status (ACTIVE, SUSPENDED, DISABLED) (MVS-B2.5B.4).
   *
   * Enforces:
   * 1. Target user exists in registry.
   * 2. Target status is valid ('ACTIVE' | 'SUSPENDED' | 'DISABLED').
   * 3. Actor exists and has ACTIVE account.
   * 4. Privileged boundary: If target is Main Administrator (is_main_admin === true),
   *    only active Main Administrator with MANAGE_PRIVILEGED_ROLES can alter their status.
   * 5. Atomicity: In-memory snapshot taken before mutation. If disk serialization fails, rollback cleanly.
   * 6. Token version increment: targetUser.token_version is incremented on every status change.
   * 7. Session revocation: Active sessions for target user are immediately revoked in SessionStore.
   * 8. Audit trail: Detailed AuditLog record is persisted.
   */
  public updateUserAccountStatus(params: {
    userId: string;
    newStatus: AccountStatus;
    actorId: string;
    reason: string;
    ipAddress?: string;
  }): { user: User; revokedSessionsCount: number; previousStatus: AccountStatus } {
    const { userId, newStatus, actorId, reason, ipAddress } = params;

    if (!userId || typeof userId !== 'string') {
      const err: any = new Error('Valid userId is required.');
      err.statusCode = 400;
      err.code = 'INVALID_USER_ID';
      throw err;
    }

    const validStatuses: AccountStatus[] = ['ACTIVE', 'SUSPENDED', 'DISABLED'];
    if (!newStatus || !validStatuses.includes(newStatus)) {
      const err: any = new Error(`Invalid account status '${newStatus}'. Must be one of: ${validStatuses.join(', ')}.`);
      err.statusCode = 400;
      err.code = 'INVALID_ACCOUNT_STATUS';
      throw err;
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      const err: any = new Error('A justification reason of at least 5 characters is required.');
      err.statusCode = 400;
      err.code = 'REASON_REQUIRED';
      throw err;
    }

    const targetUser = this.state.users.find(u => u.id === userId);
    if (!targetUser) {
      const err: any = new Error(`Target user '${userId}' not found in registry.`);
      err.statusCode = 404;
      err.code = 'USER_NOT_FOUND';
      throw err;
    }

    const actor = this.state.users.find(u => u.id === actorId);
    if (!actor) {
      const err: any = new Error(`Actor '${actorId}' not found in registry.`);
      err.statusCode = 404;
      err.code = 'ACTOR_NOT_FOUND';
      throw err;
    }

    if (actor.account_status && actor.account_status !== 'ACTIVE') {
      const err: any = new Error(`Actor '${actor.name}' has account status '${actor.account_status}'. Inactive or suspended accounts cannot modify user statuses.`);
      err.statusCode = 403;
      err.code = 'ACTOR_NOT_ACTIVE';
      throw err;
    }

    // Privileged boundary: If target is Main Administrator, actor must be active Main Administrator
    if (targetUser.is_main_admin === true) {
      if (actor.is_main_admin !== true || actor.role !== 'Admin') {
        const err: any = new Error('Modifying the account status of the Main Administrator requires MANAGE_PRIVILEGED_ROLES.');
        err.statusCode = 403;
        err.code = 'INSUFFICIENT_PRIVILEGE';
        throw err;
      }
    }

    const previousStatus = targetUser.account_status || 'ACTIVE';
    const previousTokenVersion = targetUser.token_version;
    const previousUpdatedAt = targetUser.updated_at;
    const now = new Date().toISOString();

    // In-memory snapshot for atomic rollback
    targetUser.account_status = newStatus;
    targetUser.token_version = (targetUser.token_version || 1) + 1;
    targetUser.updated_at = now;

    const auditLog: AuditLog = {
      id: `AUDIT_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      user_id: actor.id,
      user_name: actor.name,
      action: 'USER_STATUS_CHANGE',
      entity_type: 'USER',
      entity_id: targetUser.id,
      details: `User status for ${targetUser.name} (${targetUser.id}) changed from ${previousStatus} to ${newStatus} by ${actor.name} (${actor.id}). Reason: ${reason.trim()}`,
      ip_address: ipAddress || '127.0.0.1',
      timestamp: now,
      metadata: {
        target_user_id: targetUser.id,
        actor_id: actor.id,
        previous_status: previousStatus,
        new_status: newStatus,
        previous_token_version: previousTokenVersion,
        new_token_version: targetUser.token_version,
        reason: reason.trim()
      }
    };

    if (!this.state.audit_logs) {
      this.state.audit_logs = [];
    }
    this.state.audit_logs.unshift(auditLog);
    if (this.state.audit_logs.length > 1000) {
      this.state.audit_logs.pop();
    }

    try {
      this.saveToDisk(this.state);
    } catch (saveError) {
      // Rollback on persistence failure
      targetUser.account_status = previousStatus;
      targetUser.token_version = previousTokenVersion;
      targetUser.updated_at = previousUpdatedAt;
      const idx = this.state.audit_logs.indexOf(auditLog);
      if (idx !== -1) {
        this.state.audit_logs.splice(idx, 1);
      }
      throw new Error(`Failed to persist account status change atomically: ${(saveError as Error).message}`);
    }

    // Step 2: Revoke active sessions in session store
    const revokedSessionsCount = defaultSessionStore.revokeSessionsForUser(targetUser.id);

    return {
      user: { ...targetUser },
      revokedSessionsCount,
      previousStatus
    };
  }

  /**
   * Emergency revocation of all active sessions for a user (MVS-B2.5B.4).
   *
   * Enforces:
   * 1. Target user exists in registry.
   * 2. Actor exists and has ACTIVE account.
   * 3. Increments targetUser.token_version to invalidate any out-of-sync or pending sessions.
   * 4. Calls sessionStore.revokeSessionsForUser to clear in-memory sessions.
   * 5. Atomically saves state to disk with rollback.
   * 6. Logs audit trail.
   */
  public emergencyRevokeUserSessions(params: {
    userId: string;
    actorId: string;
    reason: string;
    ipAddress?: string;
  }): { userId: string; tokenVersion: number; revokedSessionsCount: number } {
    const { userId, actorId, reason, ipAddress } = params;

    if (!userId || typeof userId !== 'string') {
      const err: any = new Error('Valid userId is required.');
      err.statusCode = 400;
      err.code = 'INVALID_USER_ID';
      throw err;
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      const err: any = new Error('A justification reason of at least 5 characters is required.');
      err.statusCode = 400;
      err.code = 'REASON_REQUIRED';
      throw err;
    }

    const targetUser = this.state.users.find(u => u.id === userId);
    if (!targetUser) {
      const err: any = new Error(`Target user '${userId}' not found in registry.`);
      err.statusCode = 404;
      err.code = 'USER_NOT_FOUND';
      throw err;
    }

    const actor = this.state.users.find(u => u.id === actorId);
    if (!actor) {
      const err: any = new Error(`Actor '${actorId}' not found in registry.`);
      err.statusCode = 404;
      err.code = 'ACTOR_NOT_FOUND';
      throw err;
    }

    if (actor.account_status && actor.account_status !== 'ACTIVE') {
      const err: any = new Error(`Actor '${actor.name}' has account status '${actor.account_status}'. Inactive or suspended accounts cannot perform emergency revocations.`);
      err.statusCode = 403;
      err.code = 'ACTOR_NOT_ACTIVE';
      throw err;
    }

    const previousTokenVersion = targetUser.token_version;
    const previousUpdatedAt = targetUser.updated_at;
    const now = new Date().toISOString();

    // Increment token version
    targetUser.token_version = (targetUser.token_version || 1) + 1;
    targetUser.updated_at = now;

    const auditLog: AuditLog = {
      id: `AUDIT_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      user_id: actor.id,
      user_name: actor.name,
      action: 'SESSION_REVOCATION',
      entity_type: 'USER',
      entity_id: targetUser.id,
      details: `Emergency session revocation executed for ${targetUser.name} (${targetUser.id}) by ${actor.name} (${actor.id}). Token version incremented to ${targetUser.token_version}. Reason: ${reason.trim()}`,
      ip_address: ipAddress || '127.0.0.1',
      timestamp: now,
      metadata: {
        target_user_id: targetUser.id,
        actor_id: actor.id,
        previous_token_version: previousTokenVersion,
        new_token_version: targetUser.token_version,
        reason: reason.trim()
      }
    };

    if (!this.state.audit_logs) {
      this.state.audit_logs = [];
    }
    this.state.audit_logs.unshift(auditLog);
    if (this.state.audit_logs.length > 1000) {
      this.state.audit_logs.pop();
    }

    try {
      this.saveToDisk(this.state);
    } catch (saveError) {
      targetUser.token_version = previousTokenVersion;
      targetUser.updated_at = previousUpdatedAt;
      const idx = this.state.audit_logs.indexOf(auditLog);
      if (idx !== -1) {
        this.state.audit_logs.splice(idx, 1);
      }
      throw new Error(`Failed to persist emergency session revocation: ${(saveError as Error).message}`);
    }

    const revokedSessionsCount = defaultSessionStore.revokeSessionsForUser(targetUser.id);

    return {
      userId: targetUser.id,
      tokenVersion: targetUser.token_version,
      revokedSessionsCount
    };
  }

  /**
   * Secure Main Administrator Bootstrap (MVS-B2.5B.2)
   * 
   * Idempotent, isolated, server-side governance initialization and break-glass recovery.
   * Enforces:
   * 1. Target user exists and has account_status === 'ACTIVE'.
   * 2. Anti-takeover check: rejects re-bootstrapping if an active Main Administrator already exists,
   *    unless forceRecovery === true with a valid, non-empty reason (min 10 chars).
   * 3. Idempotent no-op if the target user is already the active Main Administrator.
   * 4. Atomic mutation: elevates role to 'Admin', grants 'MANAGE_PRIVILEGED_ROLES', sets governance metadata,
   *    increments token_version, revokes previous administrator if force recovery.
   * 5. Immutable non-repudiable audit log with action 'MAIN_ADMIN_BOOTSTRAP'.
   * 6. Atomic staging with rollback on disk write failure.
   */
  public bootstrapMainAdmin(params: {
    targetUserId: string;
    operator: string;
    reason?: string;
    forceRecovery?: boolean;
    ipAddress?: string;
  }): { user: User; auditLog: AuditLog; previousMainAdmin?: User; idempotent?: boolean } {
    const { targetUserId, operator, reason, forceRecovery = false, ipAddress } = params;

    if (!operator || typeof operator !== 'string' || !operator.trim()) {
      throw new Error('Operator attribution is required to execute Main Administrator bootstrap.');
    }

    if (!targetUserId || typeof targetUserId !== 'string' || !targetUserId.trim()) {
      throw new Error('Target user_id is required.');
    }

    const trimmedTargetId = targetUserId.trim();
    const user = this.state.users.find(u => u.id === trimmedTargetId);
    if (!user) {
      throw new Error(`Target user '${trimmedTargetId}' not found in registry.`);
    }

    if (user.account_status && user.account_status !== 'ACTIVE') {
      throw new Error(`Target user '${trimmedTargetId}' has account status '${user.account_status}'. Only ACTIVE users can be provisioned as Main Administrator.`);
    }

    // Find any existing active Main Administrator
    const existingMainAdmin = this.state.users.find(
      u => u.is_main_admin === true && (!u.account_status || u.account_status === 'ACTIVE')
    );

    // Case 1: Target is already the active Main Administrator (Idempotency)
    if (existingMainAdmin && existingMainAdmin.id === user.id) {
      const now = new Date().toISOString();
      const auditLog: AuditLog = {
        id: `AUDIT_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        user_id: user.id,
        user_name: user.name,
        action: 'MAIN_ADMIN_BOOTSTRAP',
        entity_type: 'USER',
        entity_id: user.id,
        details: `Idempotent bootstrap check: ${user.name} (${user.id}) is already active Main Administrator. Requested by operator ${operator.trim()}.`,
        ip_address: ipAddress || '127.0.0.1 (CLI)',
        timestamp: now
      };
      this.state.audit_logs.unshift(auditLog);
      if (this.state.audit_logs.length > 1000) {
        this.state.audit_logs.pop();
      }
      this.save();
      return { user, auditLog, idempotent: true };
    }

    // Case 2: Another user is already active Main Administrator and not forceRecovery -> Block takeover!
    if (existingMainAdmin && existingMainAdmin.id !== user.id && !forceRecovery) {
      throw new Error(
        `GOVERNANCE_ALREADY_INITIALIZED: Active Main Administrator already exists (${existingMainAdmin.name} - ${existingMainAdmin.id}). Direct bootstrap blocked to prevent takeover. Use emergency break-glass recovery (--force-recovery) with detailed reason if authorized.`
      );
    }

    // Case 3: Break-glass recovery validation
    if (existingMainAdmin && existingMainAdmin.id !== user.id && forceRecovery) {
      if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
        throw new Error(
          'INVALID_RECOVERY_REASON: Emergency break-glass recovery requires a comprehensive justification reason (at least 10 characters).'
        );
      }
    }

    // Snapshot state for atomic rollback on failure
    const previousTargetState: Partial<User> = {
      role: user.role,
      permissions: [...user.permissions],
      is_main_admin: user.is_main_admin,
      governance_granted_at: user.governance_granted_at,
      governance_granted_by: user.governance_granted_by,
      token_version: user.token_version,
      updated_at: user.updated_at
    };

    let previousAdminState: { user: User; snapshot: Partial<User> } | undefined;
    if (existingMainAdmin && existingMainAdmin.id !== user.id) {
      previousAdminState = {
        user: existingMainAdmin,
        snapshot: {
          is_main_admin: existingMainAdmin.is_main_admin,
          permissions: [...existingMainAdmin.permissions],
          token_version: existingMainAdmin.token_version,
          updated_at: existingMainAdmin.updated_at
        }
      };
    }

    const now = new Date().toISOString();

    // Revoke previous Main Admin if transferring governance
    if (existingMainAdmin && existingMainAdmin.id !== user.id) {
      existingMainAdmin.is_main_admin = false;
      existingMainAdmin.permissions = existingMainAdmin.permissions.filter(p => p !== 'MANAGE_PRIVILEGED_ROLES');
      existingMainAdmin.token_version = (existingMainAdmin.token_version || 0) + 1;
      existingMainAdmin.updated_at = now;
    }

    // Elevate target user
    user.is_main_admin = true;
    user.role = 'Admin';
    if (!user.permissions.includes('ADMIN')) {
      user.permissions.push('ADMIN');
    }
    if (!user.permissions.includes('MANAGE_PRIVILEGED_ROLES')) {
      user.permissions.push('MANAGE_PRIVILEGED_ROLES');
    }
    user.governance_granted_at = now;
    user.governance_granted_by = operator.trim();
    user.token_version = (user.token_version || 0) + 1;
    user.updated_at = now;

    const auditLog: AuditLog = {
      id: `AUDIT_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      user_id: user.id,
      user_name: user.name,
      action: 'MAIN_ADMIN_BOOTSTRAP',
      entity_type: 'USER',
      entity_id: user.id,
      details: existingMainAdmin && existingMainAdmin.id !== user.id
        ? `Emergency break-glass governance transfer to ${user.name} (${user.id}) from ${existingMainAdmin.name} (${existingMainAdmin.id}) by operator ${operator.trim()}. Reason: ${reason!.trim()}`
        : `Main Administrator initial bootstrap provisioned for ${user.name} (${user.id}) by operator ${operator.trim()}.`,
      ip_address: ipAddress || '127.0.0.1 (CLI)',
      timestamp: now
    };

    this.state.audit_logs.unshift(auditLog);
    if (this.state.audit_logs.length > 1000) {
      this.state.audit_logs.pop();
    }

    // Atomic disk persistence with rollback
    try {
      this.saveToDisk(this.state);
    } catch (saveError) {
      // Rollback target user
      Object.assign(user, previousTargetState);
      // Rollback previous admin if mutated
      if (previousAdminState) {
        Object.assign(previousAdminState.user, previousAdminState.snapshot);
      }
      // Rollback audit log
      const auditIdx = this.state.audit_logs.findIndex(a => a.id === auditLog.id);
      if (auditIdx !== -1) {
        this.state.audit_logs.splice(auditIdx, 1);
      }
      throw saveError;
    }

    // Revoke active sessions for target user and previous admin in session store
    if (previousAdminState) {
      defaultSessionStore.revokeSessionsForUser(previousAdminState.user.id);
    }
    defaultSessionStore.revokeSessionsForUser(user.id);

    return {
      user,
      auditLog,
      previousMainAdmin: previousAdminState ? previousAdminState.user : undefined,
      idempotent: false
    };
  }

  private generateSeedData(): DatabaseState {
    const now = '2026-09-21T10:00:00.000Z';

    // Users with specific permission sets from Section 5
    const users: User[] = [
      {
        id: 'usr_researcher',
        email: 'researcher@nutribodysim.org',
        name: 'Dr. Elena Vance, PhD',
        role: 'Researcher',
        permissions: ['VIEW', 'USE', 'CREATE', 'CLONE', 'EDIT', 'SHARE', 'PUBLISH'],
        organization: 'Laboratory of Computational Physiology',
        created_at: now,
        last_login_at: now
      },
      {
        id: 'usr_lecturer',
        email: 'lecturer@nutribodysim.org',
        name: 'Prof. Marcus Brody',
        role: 'Lecturer',
        permissions: ['VIEW', 'USE', 'CREATE', 'CLONE', 'EDIT', 'SHARE', 'PUBLISH'],
        organization: 'Faculty of Health Sciences',
        created_at: now,
        last_login_at: now
      },
      {
        id: 'usr_student',
        email: 'student@nutribodysim.org',
        name: 'Alex Chen',
        role: 'Student',
        permissions: ['VIEW', 'USE', 'CREATE', 'CLONE'],
        organization: 'Graduate School of Nutrition & Informatics',
        created_at: now,
        last_login_at: now
      },
      {
        id: 'usr_admin',
        email: 'admin@nutribodysim.org',
        name: 'System Administrator',
        role: 'Admin',
        permissions: ['VIEW', 'USE', 'CREATE', 'CLONE', 'EDIT', 'DELETE', 'SHARE', 'PUBLISH', 'VERIFY', 'ADMIN'],
        organization: 'NutriBodySim Scientific Governance Board',
        created_at: now,
        last_login_at: now
      }
    ];

    const teams: Team[] = [
      {
        id: 'team_metabolic_lab',
        name: 'Metabolic Kinetics Research Group',
        description: 'Collaborative team investigating anthropometric scaling and bioenergetic rate equations.',
        owner_id: 'usr_researcher',
        created_at: now
      }
    ];

    const team_members: TeamMember[] = [
      { id: 'tm_1', team_id: 'team_metabolic_lab', user_id: 'usr_researcher', role: 'Owner', joined_at: now },
      { id: 'tm_2', team_id: 'team_metabolic_lab', user_id: 'usr_lecturer', role: 'Editor', joined_at: now },
      { id: 'tm_3', team_id: 'team_metabolic_lab', user_id: 'usr_student', role: 'Collaborator', joined_at: now }
    ];

    const projects: Project[] = [
      {
        id: 'proj_metabolic_v1',
        name: 'Bioenergetic & Anthropometric Benchmark Study',
        description: 'Reference project evaluating formula sensitivity, unit transformation fidelity, and reproducibility across human cohorts.',
        type: 'Research',
        owner_id: 'usr_researcher',
        team_id: 'team_metabolic_lab',
        is_public: true,
        tags: ['anthropometry', 'metabolism', 'verification', 'benchmarks'],
        created_at: now,
        updated_at: now
      },
      {
        id: 'proj_academic_lab',
        name: 'Nutritional Physiology 401 Assignment Lab',
        description: 'Student course workspace for data validation, exploratory statistics, and model parameter sensitivity tests.',
        type: 'Academic',
        owner_id: 'usr_lecturer',
        is_public: false,
        tags: ['education', 'coursework', 'statistics'],
        created_at: now,
        updated_at: now
      }
    ];

    const project_members: ProjectMember[] = [
      { id: 'pm_1', project_id: 'proj_metabolic_v1', user_id: 'usr_researcher', role: 'Owner', joined_at: now },
      { id: 'pm_2', project_id: 'proj_metabolic_v1', user_id: 'usr_student', role: 'Collaborator', joined_at: now },
      { id: 'pm_3', project_id: 'proj_academic_lab', user_id: 'usr_lecturer', role: 'Owner', joined_at: now },
      { id: 'pm_4', project_id: 'proj_academic_lab', user_id: 'usr_student', role: 'Collaborator', joined_at: now }
    ];

    // Create a sample textbook document in storage
    const sampleDocContent = `# FUNDAMENTALS OF COMPUTATIONAL NUTRITION & PHYSIOLOGY
NutriBodySim Reference Manual — Module 01: Anthropometry & Bioenergetics

CHAPTER 1: MATHEMATICAL SPECIFICATION OF BIOLOGICAL SCALING
Section 1.1: The Dimensional Foundation of Human Stature
Biological scaling models express physiological rates as power functions of organismal dimensions. In human nutritional assessment, standard mass-to-height indices have historically modeled body volume as a cylinder or geometric prism. 

The Quetelet index, subsequently termed the Body Mass Index (BMI), was originally formulated to describe population-level mass accumulation relative to stature squared:
Ratio = Mass (kg) / [Height (m)]^2

Section 1.2: Limitations of Exponent Invariance
While an exponent of 2.0 provides geometric simplicity, allometric analyses across diverse cohorts demonstrate that the true empirical scaling exponent fluctuates between 1.8 and 2.4 depending on age, sex, and skeletal morphology. For this reason, computational systems must parameterize the power exponent rather than hardcoding static constants.

CHAPTER 2: BASAL & RESTING METABOLIC RATE FORMULATIONS
Section 2.1: The Multi-Component Energy Partition
Energy expenditure is partitioned into resting metabolic rate (RMR), the thermic effect of food (TEF), and physical activity energy expenditure (PAEE). Computational models must treat RMR as a parameter-driven baseline onto which demographic and body-composition coefficients are applied:
RMR = Baseline + (c1 * Weight) + (c2 * Height) - (c3 * Age)

Section 2.2: Unit Normalization Rules
Under international scientific standards (SI), mass must normalize to kilograms (kg), stature to meters (m) or centimeters (cm), and energy to kilojoules (kJ) or kilocalories (kcal). Every computation must log unit conversion factors with full audit provenance.

CHAPTER 3: DATA VALIDATION & OUTLIER TAXONOMY
In clinical nutrition datasets, input errors (such as heights recorded in centimeters treated as meters, or imperial pound measurements unflagged) introduce massive bias. Automated data pipelines must evaluate:
1. Missingness percentage
2. Outlier thresholds (3 standard deviations or IQR beyond fences)
3. Dimensional coherence`;

    const sampleDocPath = path.join(this.storageDir, 'sample_physiology_manual.txt');
    fs.writeFileSync(sampleDocPath, sampleDocContent, 'utf-8');
    const docHash = crypto.createHash('sha256').update(sampleDocContent).digest('hex');

    const materials: Material[] = [
      {
        id: 'mat_handbook_001',
        title: 'Fundamentals of Computational Nutrition & Physiology: Handbook',
        author: 'Vance, E. & Brody, M.',
        subject: 'Physiology & Bioenergetics',
        type: 'TXT',
        description: 'Comprehensive academic reference text covering allometric scaling, unit normalization, and computational energy balance.',
        year: 2025,
        publisher: 'NutriBodySim Academic Press',
        language: 'en',
        source: 'Institutional Faculty Archive',
        license: 'CC-BY-NC 4.0',
        tags: ['physiology', 'bioenergetics', 'allometry', 'reference'],
        version: '1.2.0',
        uploaded_by: 'usr_researcher',
        file_path: 'sample_physiology_manual.txt',
        file_size_bytes: Buffer.byteLength(sampleDocContent, 'utf-8'),
        mime_type: 'text/plain',
        file_hash: docHash,
        project_ids: ['proj_metabolic_v1', 'proj_academic_lab'],
        created_at: now,
        updated_at: now
      },
      {
        id: 'mat_pdf_sample',
        title: 'WHO Technical Report on Nutritional Status Guidelines (Reference Specimen)',
        author: 'World Health Organization Expert Consultation',
        subject: 'Nutritional Assessment',
        type: 'PDF',
        description: 'Standard technical monograph detailing anthropometric classification limits and cut-off points.',
        year: 2024,
        publisher: 'World Health Organization',
        language: 'en',
        url: 'https://iris.who.int/handle/10665/37000',
        license: 'Public Domain / Open Access',
        tags: ['anthropometry', 'standards', 'WHO', 'clinical'],
        version: '2.0.0',
        uploaded_by: 'usr_lecturer',
        file_path: 'sample_physiology_manual.txt', // fallback text readable
        file_size_bytes: 48920,
        mime_type: 'application/pdf',
        file_hash: 'c8812a39b4f99581ec01c712808298ad8e2e6c5bb9312019c011e400192a818e',
        project_ids: ['proj_metabolic_v1'],
        created_at: now,
        updated_at: now
      }
    ];

    const material_collections: MaterialCollection[] = [
      {
        id: 'col_anthropometry',
        name: 'Anthropometry & Energy Balance',
        description: 'Core reading materials and scientific monographs on human dimensions and metabolic energy.',
        color: '#2563eb',
        material_ids: ['mat_handbook_001', 'mat_pdf_sample'],
        created_by: 'usr_researcher',
        created_at: now
      }
    ];

    const reading_progress: ReadingProgress[] = [
      {
        id: 'rp_1',
        user_id: 'usr_student',
        material_id: 'mat_handbook_001',
        last_page: 2,
        total_pages: 5,
        progress_pct: 40,
        scroll_position: 240,
        last_accessed: now
      }
    ];

    const bookmarks: Bookmark[] = [
      {
        id: 'bm_1',
        user_id: 'usr_student',
        material_id: 'mat_handbook_001',
        page: 1,
        title: 'Chapter 1: The Dimensional Foundation of Human Stature',
        created_at: now
      }
    ];

    const highlights: Highlight[] = [
      {
        id: 'hl_1',
        user_id: 'usr_researcher',
        material_id: 'mat_handbook_001',
        page: 1,
        selected_text: 'allometric analyses across diverse cohorts demonstrate that the true empirical scaling exponent fluctuates between 1.8 and 2.4',
        color: 'yellow',
        created_at: now
      }
    ];

    const notes: Note[] = [
      {
        id: 'note_1',
        user_id: 'usr_researcher',
        title: 'Parameter Exponent Justification',
        content: 'Note for parameter PARAM_DEMO_HEIGHT_EXPONENT: allow calibration between 1.8 and 2.4 in experimental models.',
        material_id: 'mat_handbook_001',
        page: 1,
        selected_text: 'scaling exponent fluctuates between 1.8 and 2.4',
        project_id: 'proj_metabolic_v1',
        created_at: now,
        updated_at: now
      }
    ];

    // Seed Raw Dataset & Cleaned Versions
    const sampleRawData = [
      { subject_id: 'SUBJ_101', sex: 'M', age: 28, weight_kg: 78.4, height_cm: 182.0, resting_hr: 64, rmr_measured: 1780 },
      { subject_id: 'SUBJ_102', sex: 'F', age: 34, weight_kg: 62.1, height_cm: 165.0, resting_hr: 72, rmr_measured: 1390 },
      { subject_id: 'SUBJ_103', sex: 'M', age: 45, weight_kg: 89.0, height_cm: 176.5, resting_hr: 78, rmr_measured: 1820 },
      { subject_id: 'SUBJ_104', sex: 'F', age: 22, weight_kg: 54.5, height_cm: 160.0, resting_hr: 68, rmr_measured: 1295 },
      { subject_id: 'SUBJ_105', sex: 'M', age: 51, weight_kg: 104.2, height_cm: 178.0, resting_hr: 82, rmr_measured: 1980 },
      { subject_id: 'SUBJ_106', sex: 'F', age: 29, weight_kg: 58.0, height_cm: 168.0, resting_hr: 65, rmr_measured: 1410 },
      { subject_id: 'SUBJ_107', sex: 'M', age: 39, weight_kg: 72.3, height_cm: 174.0, resting_hr: 70, rmr_measured: 1660 },
      { subject_id: 'SUBJ_108', sex: 'F', age: 42, weight_kg: 69.8, height_cm: 162.0, resting_hr: 74, rmr_measured: 1450 },
      { subject_id: 'SUBJ_109', sex: 'M', age: 24, weight_kg: 81.0, height_cm: 185.0, resting_hr: 60, rmr_measured: 1850 },
      { subject_id: 'SUBJ_110', sex: 'F', age: 31, weight_kg: 65.5, height_cm: 170.0, resting_hr: 67, rmr_measured: 1480 }
    ];

    const dataset_id = 'ds_cohort_alpha';
    const datasets: Dataset[] = [
      {
        id: dataset_id,
        project_id: 'proj_metabolic_v1',
        name: 'Metabolic & Anthropometric Cohort Alpha (N=10)',
        description: 'Standardized baseline clinical measurements including measured indirect calorimetry RMR and stature.',
        source_file: 'cohort_alpha_baseline.csv',
        uploaded_by: 'usr_researcher',
        current_version: 'v1.1',
        created_at: now,
        updated_at: now
      }
    ];

    const dataset_versions: DatasetVersion[] = [
      {
        id: 'dsv_1_0_raw',
        dataset_id,
        version_tag: 'v1.0',
        state: 'RAW',
        columns: [
          { name: 'subject_id', detected_type: 'string', missing_count: 0, unique_count: 10 },
          { name: 'sex', detected_type: 'string', missing_count: 0, unique_count: 2 },
          { name: 'age', detected_type: 'number', unit: 'yr', missing_count: 0, unique_count: 10 },
          { name: 'weight_kg', detected_type: 'number', unit: 'kg', variable_id: 'VAR_DEMO_WEIGHT', missing_count: 0, unique_count: 10 },
          { name: 'height_cm', detected_type: 'number', unit: 'cm', variable_id: 'VAR_DEMO_HEIGHT', missing_count: 0, unique_count: 10 },
          { name: 'resting_hr', detected_type: 'number', unit: 'bpm', missing_count: 0, unique_count: 9 },
          { name: 'rmr_measured', detected_type: 'number', unit: 'kcal', variable_id: 'VAR_DEMO_RESTING_METABOLIC_RATE', missing_count: 0, unique_count: 10 }
        ],
        data: sampleRawData,
        validation_report: {
          is_valid: true,
          row_count: 10,
          column_count: 7,
          missing_values_count: 0,
          duplicate_rows_count: 0,
          outliers_detected: [],
          type_mismatches: [],
          warnings: ['Raw immutable dataset ingestion confirmed.']
        },
        transformation_applied: 'Initial CSV Ingestion',
        created_by: 'usr_researcher',
        created_at: now
      },
      {
        id: 'dsv_1_1_cleaned',
        dataset_id,
        version_tag: 'v1.1',
        parent_version_tag: 'v1.0',
        state: 'VALIDATED',
        columns: [
          { name: 'subject_id', detected_type: 'string', missing_count: 0, unique_count: 10 },
          { name: 'sex', detected_type: 'string', missing_count: 0, unique_count: 2 },
          { name: 'age', detected_type: 'number', unit: 'yr', missing_count: 0, unique_count: 10 },
          { name: 'weight_kg', detected_type: 'number', unit: 'kg', variable_id: 'VAR_DEMO_WEIGHT', missing_count: 0, unique_count: 10 },
          { name: 'height_cm', detected_type: 'number', unit: 'cm', variable_id: 'VAR_DEMO_HEIGHT', missing_count: 0, unique_count: 10 },
          { name: 'height_m', detected_type: 'number', unit: 'm', variable_id: 'VAR_DEMO_HEIGHT', missing_count: 0, unique_count: 10 },
          { name: 'resting_hr', detected_type: 'number', unit: 'bpm', missing_count: 0, unique_count: 9 },
          { name: 'rmr_measured', detected_type: 'number', unit: 'kcal', variable_id: 'VAR_DEMO_RESTING_METABOLIC_RATE', missing_count: 0, unique_count: 10 }
        ],
        data: sampleRawData.map(r => ({ ...r, height_m: Number((r.height_cm / 100).toFixed(4)) })),
        validation_report: {
          is_valid: true,
          row_count: 10,
          column_count: 8,
          missing_values_count: 0,
          duplicate_rows_count: 0,
          outliers_detected: [],
          type_mismatches: [],
          warnings: ['Computed standardized height_m column with unit normalization trace.']
        },
        transformation_applied: 'Normalized height_cm to SI standard height_m (height_cm * 0.01)',
        created_by: 'usr_researcher',
        created_at: now
      }
    ];

    const statistics_analyses: StatisticsAnalysis[] = [
      {
        id: 'stat_001',
        project_id: 'proj_metabolic_v1',
        dataset_version_id: 'dsv_1_1_cleaned',
        title: 'Descriptive Profile: Weight & Measured RMR',
        analysis_type: 'DESCRIPTIVE',
        target_columns: ['weight_kg', 'rmr_measured', 'height_cm', 'age'],
        method_justification: 'Parametric and non-parametric exploratory summary of human cohort baseline distributions.',
        results: {
          weight_kg: { mean: 71.31, median: 70.85, sd: 14.51, min: 54.5, max: 104.2, iqr: 19.8 },
          rmr_measured: { mean: 1623.5, median: 1570.0, sd: 236.4, min: 1295.0, max: 1980.0, iqr: 410.0 }
        },
        provenance_hash: '9f2913e2bb9210c4d80a13ef299a9b1c',
        created_by: 'usr_researcher',
        created_at: now
      }
    ];

    const charts: ChartRecord[] = [
      {
        id: 'chart_001',
        project_id: 'proj_metabolic_v1',
        dataset_version_id: 'dsv_1_1_cleaned',
        analysis_id: 'stat_001',
        title: 'Weight vs Measured RMR Correlation Scatter',
        chart_type: 'SCATTER',
        x_field: 'weight_kg',
        y_field: 'rmr_measured',
        group_by: 'sex',
        config: { x_label: 'Weight (kg)', y_label: 'RMR Measured (kcal/day)' },
        created_by: 'usr_researcher',
        created_at: now
      }
    ];

    const notebooks: NutriNotebook[] = [
      {
        id: 'nb_metabolic_01',
        project_id: 'proj_metabolic_v1',
        title: 'Allometric Scaling & Metabolic Sensitivity Analysis',
        description: 'Interactive computational notebook linking literature references, dataset versions, formula AST runs, and chart visualizers.',
        created_by: 'usr_researcher',
        created_at: now,
        updated_at: now
      }
    ];

    const notebook_cells: NotebookCell[] = [
      {
        id: 'cell_1',
        notebook_id: 'nb_metabolic_01',
        cell_type: 'TEXT',
        order: 1,
        title: 'Project Hypothesis & Literature Context',
        content: `### 1. Research Objectives
This notebook evaluates the mathematical sensitivity of the **Demo Anthropometric Ratio Formula** under varying power exponents.
We evaluate whether calibrating \`PARAM_DEMO_HEIGHT_EXPONENT\` from 2.0 to 1.8 improves correlation with measured bioenergetic expenditure.`
      },
      {
        id: 'cell_2',
        notebook_id: 'nb_metabolic_01',
        cell_type: 'REFERENCE',
        order: 2,
        title: 'Source Monograph Citation',
        content: 'REF_DEMO_001',
        metadata: {
          reference_id: 'REF_DEMO_001',
          selected_text: 'true empirical scaling exponent fluctuates between 1.8 and 2.4'
        }
      },
      {
        id: 'cell_3',
        notebook_id: 'nb_metabolic_01',
        cell_type: 'DATA',
        order: 3,
        title: 'Cohort Alpha Baseline Dataset (v1.1 Cleaned)',
        content: 'dsv_1_1_cleaned',
        metadata: {
          dataset_version_id: 'dsv_1_1_cleaned'
        }
      },
      {
        id: 'cell_4',
        notebook_id: 'nb_metabolic_01',
        cell_type: 'FORMULA',
        order: 4,
        title: 'Execute Demo Anthropometric Formula',
        content: 'FORMULA_DEMO_QUETELET',
        metadata: {
          formula_id: 'FORMULA_DEMO_QUETELET'
        }
      },
      {
        id: 'cell_5',
        notebook_id: 'nb_metabolic_01',
        cell_type: 'CHART',
        order: 5,
        title: 'Scatter Plot: Weight vs Measured RMR',
        content: 'chart_001',
        metadata: {
          chart_id: 'chart_001'
        }
      }
    ];

    const experiments: Experiment[] = [
      {
        id: 'exp_001',
        project_id: 'proj_metabolic_v1',
        title: 'Sensitivity of Stature Exponent on Demographic Cohort',
        description: 'Comparison of baseline anthropometric model (exponent = 2.0) against experimental clone (exponent = 1.85).',
        baseline_model_id: 'MODEL_DEMO_ANTHROPOMETRY_V1',
        experimental_model_id: 'MODEL_DEMO_ANTHROPOMETRY_V1_CLONE',
        parameter_modifications: [
          {
            parameter_id: 'PARAM_DEMO_HEIGHT_EXPONENT',
            baseline_value: 2.0,
            experimental_value: 1.85,
            unit: 'unitless',
            rationale: 'Testing allometric scaling hypothesis based on literature note.'
          }
        ],
        baseline_output: { anthropometric_ratio: 22.86, estimated_rmr: 1693.75 },
        experimental_output: { anthropometric_ratio: 24.81, estimated_rmr: 1693.75 },
        delta_summary: 'Anthropometric ratio increased by +8.53% with exponent 1.85. Baseline RMR formulation remained stable.',
        status: 'COMPLETED',
        provenance_hash: '2c8194a0e98031e4f9b8c08194ad9028',
        created_by: 'usr_researcher',
        created_at: now,
        updated_at: now
      }
    ];

    const provenance_records: ProvenanceRecord[] = [
      {
        id: 'prov_init_001',
        project_id: 'proj_metabolic_v1',
        target_entity_type: 'EXPERIMENT',
        target_entity_id: 'exp_001',
        user_id: 'usr_researcher',
        dataset_version_id: 'dsv_1_1_cleaned',
        model_version: '1.0.0',
        parameter_version: '1.0.0',
        environment_specs: 'Node v22 / TSX / NutriBodySim Engine v1.0',
        provenance_hash: '2c8194a0e98031e4f9b8c08194ad9028',
        reproducibility_manifest: {
          dataset_version: 'dsv_1_1_cleaned',
          model_id: 'MODEL_DEMO_ANTHROPOMETRY_V1',
          parameter_deltas: [{ param: 'PARAM_DEMO_HEIGHT_EXPONENT', from: 2.0, to: 1.85 }],
          execution_seed: 42
        },
        created_at: now
      }
    ];

    const audit_logs: AuditLog[] = [
      {
        id: 'audit_0',
        user_id: 'usr_admin',
        user_name: 'System Administrator',
        action: 'VERIFY',
        entity_type: 'SYSTEM',
        entity_id: 'ROOT',
        details: 'NutriBodySim Computational Laboratory V1 initialized with academic registries and demo modules.',
        timestamp: now
      }
    ];

    return {
      users,
      teams,
      team_members,
      projects,
      project_members,
      materials,
      material_collections,
      reading_progress,
      bookmarks,
      highlights,
      notes,
      units: STANDARD_UNITS,
      variables: DEMO_VARIABLES,
      parameters: DEMO_PARAMETERS,
      formulas: DEMO_FORMULAS,
      algorithms: [],
      models: DEMO_MODELS,
      references: DEMO_REFERENCES,
      interpretation_rules: DEMO_INTERPRETATION_RULES,
      calculations: [],
      datasets,
      dataset_versions,
      statistics_analyses,
      charts,
      notebooks,
      notebook_cells,
      code_executions: [],
      experiments,
      audit_logs,
      provenance_records,
      role_requests: [],
      external_identities: []
    };
  }
}

export const db = new DatabaseStore();
