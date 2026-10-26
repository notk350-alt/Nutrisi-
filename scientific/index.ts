/**
 * NutriBodySim — Scientific Core Public API Entry Point
 * 
 * Strict architectural boundary: Pure scientific computing, dimensional analysis,
 * AST evaluation, evidence-based interpretation registries, and clinical rules.
 * No UI, DOM, or framework dependencies.
 */

// Core Contracts & Scientific Types
export * from './types';

// Unit Conversion & Dimensional Analysis
export * from './units/unitConverter';

// Calculation Engine & AST Execution
export * from './engine/calculationEngine';
export * from './engine/executionAdapter';
export * from './engine/algorithmExecutor';
export * from './engine/modelExecutor';
export * from './engine/validationEngine';
export * from './engine/batchExecutor';
export * from './engine/structuredMathEvaluator';

// Scientific Resolvers (Phase C2)
export * from './resolvers/moduleResolver';
export * from './resolvers/parameterResolver';

// Standalone Input Validator (Phase C3)
export * from './validator/inputValidator';

// Provenance Persistence Layer (Phase C8)
export * from './provenance/provenancePersistence';

// Scientific Data Layer — Dataset Contract (Phase D1), Versioning (Phase D2), Variable Registry (Phase D3), Variable Mapping (Phase D4), Data-State Pipeline (Phase D5), Data Validation (Phase D6), Derived Variable Engine (Phase D7), Dataset Execution (Phase D8)
export * from './data/datasetContract';
export * from './data/datasetVersion';
export * from './data/variableRegistry';
export * from './data/variableMapping';
export * from './data/dataStatePipeline';
export * from './data/dataValidation';
export * from './data/derivedVariable';
export * from './data/dependencyResolver';
export * from './data/derivedVariableRegistry';
export * from './data/derivedVariableExecutor';
export * from './data/derivedArtifact';
export * from './data/datasetExecutionRequest';
export * from './data/datasetInputAssembler';
export * from './data/datasetValidationGate';
export * from './data/datasetExecutionEngine';
export { deepFreeze } from './data/derivedVariable';
export * from './data/analysisContracts';
export * from './data/statisticalAnalysis';
export * from './data/statisticalEngine';
export * from './data/inferentialContracts';
export * from './data/inferentialAnalysis';
export * from './data/inferentialEngine';
export * from './data/regressionContracts';
export * from './data/regressionAnalysis';
export * from './data/regressionMetrics';
export * from './data/crossValidation';
export * from './data/modelProvenance';
export * from './data/regressionEngine';
export * from './data/powerContracts';
export {
  computePowerMetrics,
  computeSensitivityGrid,
  getCriticalZ,
  fisherZ,
  invFisherZ
} from './data/powerAnalysis';
export * from './data/powerEngine';
export * from './data/nonParametricContracts';
export * from './data/nonParametricAnalysis';
export * from './data/nonParametricEngine';

// Scientific Data Layer — Phase D14: Visualization & Research Reporting Engine
export * from './data/visualizationContracts';
export * from './data/scientificVisualization';
export * from './data/visualizationEngine';
export * from './data/reportContracts';
export * from './data/researchReportEngine';

// Scientific Data Layer — Phase D15: Interpretation & Evidence Synthesis Governance Engine
export {
  type ClaimType,
  type EvidenceStatus,
  type InterpretationCategory,
  type ProfileStatus,
  type RuleStatus,
  type EvidenceLevel,
  type InterpretationInputType,
  type ConditionOperator,
  type DeclarativeCondition,
  type RuleConditionGroup,
  type GovernanceMetadata,
  type EffectSizeThresholdConfig,
  type ClassificationStandardConfig,
  type InterpretationProfile,
  type RuleOutputInterpretation,
  type GovernedInterpretationRule,
  type MatchedConditionTrace,
  type EvidenceTrace,
  type InterpretationResult,
  type InterpretationConflictResult,
  type InterpretationErrorCode,
  ScientificInterpretationError,
  validateInterpretationProfile,
  validateInterpretationRule,
  createInterpretationResult
} from './data/interpretationContracts';
export * from './data/interpretationRegistry';
export * from './data/interpretationEngine';
export * from './data/evidenceTrace';

// Scientific Data Layer — Phase E: Research Workflow & Reproducible Research Project
export * from './data/researchProjectContracts';
export * from './data/researchProjectProvenance';
export * from './data/researchProjectRegistry';
export * from './data/researchWorkflow';
export * from './data/researchExecution';

// Scientific Data Layer — Phase F2: Analysis Execution Bridge, Preview, Authorization, Adapter & Statistical Execution
export * from './data/analysisExecutionContracts';
export * from './data/analysisExecutionProvenance';
export * from './data/analysisExecutionPreflight';
export * from './data/executionPreviewContracts';
export * from './data/executionPreviewProvenance';
export * from './data/executionPreviewValidator';
export * from './data/executionAuthorization';
export * from './data/authorizedExecutionAdapterContracts';
export * from './data/authorizedExecutionAdapter';
export * from './data/authorizedStatisticalExecution';

// Scientific Registry Seed & Reference Modules
export * from './registry/demoModules';

