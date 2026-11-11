/**
 * NutriBodySim — Asynchronous Data Access Layer & Repository Contracts (MVS-B2.5E.1A)
 *
 * Defines strongly-typed, Promise-based repository contracts to decouple domain logic,
 * authentication middleware, and API routes from physical storage mechanisms.
 *
 * Architectural Guarantees:
 * 1. Asynchronous I/O: All query and mutation operations return Promise<T>.
 * 2. Explicit Transaction Context: Multi-entity mutations support atomic ITransactionContext / IUnitOfWork.
 * 3. Zero Storage Leaks: Callers do not assume in-memory array manipulation or file-based serialization.
 * 4. Zero Browser Dependencies: Pure Node.js / TypeScript interfaces without DOM, React, or browser APIs.
 * 5. Full Semantic Preservation: Retains exact types, IDs, roles, and relational constraints of existing models.
 */

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
  ApprovalStatus,
  ExternalIdentity,
  AccountStatus
} from './types';

import {
  ScientificVariable,
  ScientificUnit,
  ScientificFormula,
  ScientificAlgorithm,
  ScientificModel,
  ScientificParameter,
  ScientificReference,
  CalculationTrace,
  InterpretationRule
} from '../../scientific';

import { SessionData, SessionValidationResult } from '../auth/sessionStore';
import {
  OIDCTransaction,
  OIDCClientTransactionData,
  CreateTransactionOptions,
  ConsumeTransactionOptions,
  ConsumeTransactionResult
} from '../auth/oidc/types';

// ============================================================================
// 1. Transaction Boundaries & Unit of Work
// ============================================================================

export interface ITransactionContext {
  readonly transactionId: string;
  readonly createdAt: number;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface IUnitOfWork {
  runInTransaction<T>(work: (tx: ITransactionContext) => Promise<T>): Promise<T>;
}

// ============================================================================
// 2. User & Identity Repositories
// ============================================================================

export interface IUserRepository {
  findById(id: string, tx?: ITransactionContext): Promise<User | null>;
  findByEmail(email: string, tx?: ITransactionContext): Promise<User | null>;
  listAll(tx?: ITransactionContext): Promise<User[]>;
  create(userData: User, tx?: ITransactionContext): Promise<User>;
  update(id: string, updates: Partial<User>, tx?: ITransactionContext): Promise<User>;
  updateAccountStatus(userId: string, status: AccountStatus, tx?: ITransactionContext): Promise<User>;
  incrementTokenVersion(userId: string, tx?: ITransactionContext): Promise<number>;
  delete(id: string, tx?: ITransactionContext): Promise<boolean>;
}

export interface IExternalIdentityRepository {
  findByProviderSubject(provider: string, providerSubjectId: string, tx?: ITransactionContext): Promise<ExternalIdentity | null>;
  listByUserId(userId: string, tx?: ITransactionContext): Promise<ExternalIdentity[]>;
  linkIdentity(identity: ExternalIdentity, tx?: ITransactionContext): Promise<ExternalIdentity>;
  unlinkIdentity(provider: string, providerSubjectId: string, tx?: ITransactionContext): Promise<boolean>;
}

export interface IRoleRequestRepository {
  create(request: RoleRequest, tx?: ITransactionContext): Promise<RoleRequest>;
  findById(requestId: string, tx?: ITransactionContext): Promise<RoleRequest | null>;
  listAll(tx?: ITransactionContext): Promise<RoleRequest[]>;
  listPending(tx?: ITransactionContext): Promise<RoleRequest[]>;
  listByUserId(userId: string, tx?: ITransactionContext): Promise<RoleRequest[]>;
  findPendingByUserAndRole(userId: string, requestedRole: RequestedRole, tx?: ITransactionContext): Promise<RoleRequest | null>;
  updateStatus(
    requestId: string,
    status: ApprovalStatus,
    reviewerId: string,
    reviewReason?: string | null,
    tx?: ITransactionContext,
    expectedStatus?: ApprovalStatus
  ): Promise<RoleRequest>;
}

// ============================================================================
// 3. Project & Collaboration Repositories
// ============================================================================

export interface IProjectRepository {
  findById(id: string, tx?: ITransactionContext): Promise<Project | null>;
  listAll(tx?: ITransactionContext): Promise<Project[]>;
  listPublic(tx?: ITransactionContext): Promise<Project[]>;
  listByOwner(ownerId: string, tx?: ITransactionContext): Promise<Project[]>;
  listForUser(userId: string, tx?: ITransactionContext): Promise<Project[]>;
  create(project: Project, tx?: ITransactionContext): Promise<Project>;
  update(id: string, updates: Partial<Project>, tx?: ITransactionContext): Promise<Project>;
  delete(id: string, tx?: ITransactionContext): Promise<boolean>;
}

export interface IMembershipRepository {
  getTeams(tx?: ITransactionContext): Promise<Team[]>;
  createTeam(team: Team, tx?: ITransactionContext): Promise<Team>;
  getProjectMembers(projectId: string, tx?: ITransactionContext): Promise<ProjectMember[]>;
  addProjectMember(member: ProjectMember, tx?: ITransactionContext): Promise<ProjectMember>;
  removeProjectMember(projectId: string, userId: string, tx?: ITransactionContext): Promise<boolean>;
  getTeam(teamId: string, tx?: ITransactionContext): Promise<Team | null>;
  getTeamMembers(teamId: string, tx?: ITransactionContext): Promise<TeamMember[]>;
  addTeamMember(member: TeamMember, tx?: ITransactionContext): Promise<TeamMember>;
  removeTeamMember(teamId: string, userId: string, tx?: ITransactionContext): Promise<boolean>;
}

// ============================================================================
// 4. Academic Materials Repository
// ============================================================================

export interface IMaterialRepository {
  findById(id: string, tx?: ITransactionContext): Promise<Material | null>;
  findByFilePath(filePath: string, tx?: ITransactionContext): Promise<Material | null>;
  listAll(tx?: ITransactionContext): Promise<Material[]>;
  listByProject(projectId: string, tx?: ITransactionContext): Promise<Material[]>;
  create(material: Material, tx?: ITransactionContext): Promise<Material>;
  update(id: string, updates: Partial<Material>, tx?: ITransactionContext): Promise<Material>;
  linkToProject(materialId: string, projectId: string, tx?: ITransactionContext): Promise<Material | null>;
  delete(id: string, tx?: ITransactionContext): Promise<boolean>;
  getCollections(tx?: ITransactionContext): Promise<MaterialCollection[]>;
  getReadingProgress(userId: string, materialId: string, tx?: ITransactionContext): Promise<ReadingProgress | null>;
  saveReadingProgress(progress: ReadingProgress, tx?: ITransactionContext): Promise<ReadingProgress>;
  getBookmarks(userId: string, materialId?: string, tx?: ITransactionContext): Promise<Bookmark[]>;
  getAllBookmarks(materialId?: string, tx?: ITransactionContext): Promise<Bookmark[]>;
  saveBookmark(bookmark: Bookmark, tx?: ITransactionContext): Promise<Bookmark>;
  deleteBookmark(id: string, tx?: ITransactionContext): Promise<boolean>;
  getHighlights(userId: string, materialId?: string, tx?: ITransactionContext): Promise<Highlight[]>;
  getAllHighlights(materialId?: string, tx?: ITransactionContext): Promise<Highlight[]>;
  saveHighlight(highlight: Highlight, tx?: ITransactionContext): Promise<Highlight>;
  deleteHighlight(id: string, tx?: ITransactionContext): Promise<boolean>;
  getNotes(userId: string, materialId?: string, projectId?: string, tx?: ITransactionContext): Promise<Note[]>;
  getAllNotes(tx?: ITransactionContext): Promise<Note[]>;
  saveNote(note: Note, tx?: ITransactionContext): Promise<Note>;
  deleteNote(id: string, tx?: ITransactionContext): Promise<boolean>;
}

// ============================================================================
// 5. Scientific Dataset & Versioning Repository
// ============================================================================

export interface IDatasetRepository {
  findById(id: string, tx?: ITransactionContext): Promise<Dataset | null>;
  listAll(tx?: ITransactionContext): Promise<Dataset[]>;
  listByProject(projectId: string, tx?: ITransactionContext): Promise<Dataset[]>;
  create(dataset: Dataset, tx?: ITransactionContext): Promise<Dataset>;
  update(id: string, updates: Partial<Dataset>, tx?: ITransactionContext): Promise<Dataset>;
  delete(id: string, tx?: ITransactionContext): Promise<boolean>;
  getVersion(versionId: string, tx?: ITransactionContext): Promise<DatasetVersion | null>;
  listVersions(datasetId: string, tx?: ITransactionContext): Promise<DatasetVersion[]>;
  createVersion(version: DatasetVersion, tx?: ITransactionContext): Promise<DatasetVersion>;
}

// ============================================================================
// 6. Scientific Registry Repository
// ============================================================================

export interface IScientificRegistryRepository {
  getUnits(tx?: ITransactionContext): Promise<ScientificUnit[]>;
  getUnitById(id: string, tx?: ITransactionContext): Promise<ScientificUnit | null>;
  getVariables(tx?: ITransactionContext): Promise<ScientificVariable[]>;
  getVariableById(id: string, tx?: ITransactionContext): Promise<ScientificVariable | null>;
  createVariable(variable: ScientificVariable, tx?: ITransactionContext): Promise<ScientificVariable>;
  getParameters(tx?: ITransactionContext): Promise<ScientificParameter[]>;
  getParameterById(id: string, tx?: ITransactionContext): Promise<ScientificParameter | null>;
  createParameter(parameter: ScientificParameter, tx?: ITransactionContext): Promise<ScientificParameter>;
  getFormulas(tx?: ITransactionContext): Promise<ScientificFormula[]>;
  getFormulaById(id: string, tx?: ITransactionContext): Promise<ScientificFormula | null>;
  createFormula(formula: ScientificFormula, tx?: ITransactionContext): Promise<ScientificFormula>;
  getModels(tx?: ITransactionContext): Promise<ScientificModel[]>;
  getModelById(id: string, tx?: ITransactionContext): Promise<ScientificModel | null>;
  createModel(model: ScientificModel, tx?: ITransactionContext): Promise<ScientificModel>;
  getReferences(tx?: ITransactionContext): Promise<ScientificReference[]>;
  getReferenceById(id: string, tx?: ITransactionContext): Promise<ScientificReference | null>;
  createReference(reference: ScientificReference, tx?: ITransactionContext): Promise<ScientificReference>;
  getInterpretationRules(tx?: ITransactionContext): Promise<InterpretationRule[]>;
  getInterpretationRuleById(id: string, tx?: ITransactionContext): Promise<InterpretationRule | null>;
  getAlgorithms(tx?: ITransactionContext): Promise<ScientificAlgorithm[]>;
  getAlgorithmById(id: string, tx?: ITransactionContext): Promise<ScientificAlgorithm | null>;
}

// ============================================================================
// 7. Research Artifacts & Notebook Repository
// ============================================================================

export interface IResearchArtifactRepository {
  getAllAnalyses(tx?: ITransactionContext): Promise<StatisticsAnalysis[]>;
  getAllCharts(tx?: ITransactionContext): Promise<ChartRecord[]>;
  getAllNotebooks(tx?: ITransactionContext): Promise<NutriNotebook[]>;
  getAllExperiments(tx?: ITransactionContext): Promise<Experiment[]>;
  getAllCodeExecutions(tx?: ITransactionContext): Promise<CodeExecutionRecord[]>;
  getAllProvenanceRecords(tx?: ITransactionContext): Promise<ProvenanceRecord[]>;
  getNotebookCells(notebookId: string, tx?: ITransactionContext): Promise<NotebookCell[]>;
  findNotebookCellById(cellId: string, tx?: ITransactionContext): Promise<NotebookCell | null>;
  getAnalysesByProject(projectId: string, tx?: ITransactionContext): Promise<StatisticsAnalysis[]>;
  getAnalysisById(id: string, tx?: ITransactionContext): Promise<StatisticsAnalysis | null>;
  createAnalysis(analysis: StatisticsAnalysis, tx?: ITransactionContext): Promise<StatisticsAnalysis>;
  getChartsByProject(projectId: string, tx?: ITransactionContext): Promise<ChartRecord[]>;
  getChartById(id: string, tx?: ITransactionContext): Promise<ChartRecord | null>;
  createChart(chart: ChartRecord, tx?: ITransactionContext): Promise<ChartRecord>;
  getNotebooksByProject(projectId: string, tx?: ITransactionContext): Promise<NutriNotebook[]>;
  getNotebookWithCells(notebookId: string, tx?: ITransactionContext): Promise<{ notebook: NutriNotebook; cells: NotebookCell[] } | null>;
  createNotebook(notebook: NutriNotebook, tx?: ITransactionContext): Promise<NutriNotebook>;
  createNotebookCell(cell: NotebookCell, tx?: ITransactionContext): Promise<NotebookCell>;
  updateNotebookCell(cellId: string, updates: Partial<NotebookCell>, tx?: ITransactionContext): Promise<NotebookCell>;
  deleteNotebookCell(cellId: string, tx?: ITransactionContext): Promise<boolean>;
  getExperimentsByProject(projectId: string, tx?: ITransactionContext): Promise<Experiment[]>;
  getExperimentById(id: string, tx?: ITransactionContext): Promise<Experiment | null>;
  createExperiment(experiment: Experiment, tx?: ITransactionContext): Promise<Experiment>;
  getCodeExecutionsByProject(projectId: string, tx?: ITransactionContext): Promise<CodeExecutionRecord[]>;
  createCodeExecution(record: CodeExecutionRecord, tx?: ITransactionContext): Promise<CodeExecutionRecord>;
  getProvenanceRecords(projectId: string, tx?: ITransactionContext): Promise<ProvenanceRecord[]>;
  createProvenanceRecord(record: ProvenanceRecord, tx?: ITransactionContext): Promise<ProvenanceRecord>;
  getCalculations(projectId?: string, tx?: ITransactionContext): Promise<CalculationTrace[]>;
  getCalculationById(id: string, tx?: ITransactionContext): Promise<CalculationTrace | null>;
  createCalculation(calculation: CalculationTrace, tx?: ITransactionContext): Promise<CalculationTrace>;
}

// ============================================================================
// 8. Immutable Audit Trail Repository
// ============================================================================

export interface IAuditLogFilter {
  userId?: string;
  entityType?: string;
  entityId?: string;
  action?: AuditLog['action'];
  startTime?: string;
  endTime?: string;
  limit?: number;
  offset?: number;
}

export interface IAuditLogRepository {
  appendLog(
    logData: Omit<AuditLog, 'id' | 'timestamp'> & { id?: string; timestamp?: string },
    tx?: ITransactionContext
  ): Promise<AuditLog>;
  queryLogs(filter?: IAuditLogFilter, tx?: ITransactionContext): Promise<AuditLog[]>;
  countLogs(filter?: IAuditLogFilter, tx?: ITransactionContext): Promise<number>;
}

// ============================================================================
// 9. Asynchronous Production Session Repository
// ============================================================================

export interface ISessionRepository {
  createSession(
    userId: string,
    ttlSeconds?: number,
    tokenVersion?: number,
    tx?: ITransactionContext
  ): Promise<{ token: string; expiresAt: number; session: Omit<SessionData, 'tokenHash'> }>;
  validateSession(token: string): Promise<SessionValidationResult>;
  revokeSession(token: string, tx?: ITransactionContext): Promise<boolean>;
  revokeSessionsForUser(userId: string, tx?: ITransactionContext): Promise<number>;
  cleanExpiredSessions(now?: number, tx?: ITransactionContext): Promise<number>;
  getActiveSessionsCount(): Promise<number>;
}

// ============================================================================
// 10. Asynchronous OIDC Pre-Auth Transaction Repository
// ============================================================================

export interface IOIDCTransactionRepository {
  createTransaction(
    options?: CreateTransactionOptions,
    tx?: ITransactionContext
  ): Promise<{ transaction: OIDCTransaction; clientData: OIDCClientTransactionData }>;
  getTransaction(id: string, tx?: ITransactionContext): Promise<OIDCTransaction | null>;
  getTransactionByState(state: string, tx?: ITransactionContext): Promise<OIDCTransaction | null>;
  consumeTransaction(options: ConsumeTransactionOptions, tx?: ITransactionContext): Promise<ConsumeTransactionResult>;
  deleteTransaction(id: string, tx?: ITransactionContext): Promise<boolean>;
  cleanExpiredTransactions(now?: number, tx?: ITransactionContext): Promise<number>;
}

// ============================================================================
// 11. Unified Container / Service Locator Contract
// ============================================================================

export interface IDatabaseRepositories {
  readonly users: IUserRepository;
  readonly externalIdentities: IExternalIdentityRepository;
  readonly roleRequests: IRoleRequestRepository;
  readonly projects: IProjectRepository;
  readonly memberships: IMembershipRepository;
  readonly materials: IMaterialRepository;
  readonly datasets: IDatasetRepository;
  readonly scientificRegistry: IScientificRegistryRepository;
  readonly researchArtifacts: IResearchArtifactRepository;
  readonly auditLogs: IAuditLogRepository;
  readonly sessions: ISessionRepository;
  readonly oidcTransactions: IOIDCTransactionRepository;
  readonly unitOfWork: IUnitOfWork;
}
