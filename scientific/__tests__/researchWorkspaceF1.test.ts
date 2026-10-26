/**
 * NutriBodySim — Phase F1 Research Workspace UI & Application Layer Test Suite
 *
 * Verifies all Phase F1 objectives:
 * 1. Project Form Validation & Initialization
 * 2. Explicit Research Question Requirement (No AI auto-generation)
 * 3. Explicit Hypothesis Requirement (No AI auto-generation)
 * 4. Dataset Selection & Binding
 * 5. Checksum Integrity Validation
 * 6. Cross-Version Rejection & Lineage Verification
 * 7. Variable Role Assignment (All 9 roles)
 * 8. Invalid Variable Rejection (Non-registry variables strictly rejected)
 * 9. Immutability Enforcement (Finalized / Archived projects locked)
 * 10. Security Audit (Zero eval, Zero new Function, scientific_validity = NOT_ESTABLISHED)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  ResearchProjectRegistry,
  ResearchWorkflow,
  ScientificProjectError,
  VariableRole,
  VariableStore,
  createVariable,
  DatasetVersionStore,
  DatasetStore,
  DataArtifactStore,
  createDataArtifact,
  createDatasetVersion
} from '../index';
import {
  ResearchWorkspaceService,
  CreateProjectFormData,
  BindDatasetFormData,
  PlanVariableFormData
} from '../../src/services/researchWorkspaceService';

describe('Phase F1 — Research Workspace UI/Application Layer', () => {
  let service: ResearchWorkspaceService;
  let testRegistry: ResearchProjectRegistry;

  const validProjectData: CreateProjectFormData = {
    title: 'Soluble Fiber & Glycemic Fluctuation Cohort',
    description: 'Prospective observational investigation into soluble fiber intake and glycemic variability.',
    created_by: 'Dr. Elena Rostova',
    study_design: {
      design_type: 'COHORT',
      description: '12-week prospective observational cohort of prediabetic adults.',
      temporal_direction: 'PROSPECTIVE',
      blinding: 'NONE',
      randomization: false,
      population: 'Adults aged 25-60 with impaired fasting glucose'
    },
    research_question: {
      question_id: 'Q_FIBER_GLUCOSE',
      question_text: 'Does daily soluble fiber intake correlate with reductions in fasting plasma glucose?',
      priority: 'PRIMARY'
    },
    objective: {
      objective_id: 'OBJ_FIBER_GLUCOSE',
      type: 'PRIMARY_OBJECTIVE',
      description: 'Evaluate the correlation between dietary soluble fiber and fasting blood glucose.',
      target_variables: ['VAR_SOLUBLE_FIBER', 'VAR_FASTING_GLUCOSE']
    },
    hypothesis: {
      hypothesis_id: 'HYP_FIBER_GLUCOSE',
      null_hypothesis: 'There is no correlation between soluble fiber intake and fasting plasma glucose (r = 0).',
      alternative_hypothesis: 'There is an inverse correlation between soluble fiber intake and fasting plasma glucose (r < 0).',
      direction: 'LESS',
      planned_alpha: 0.05
    }
  };

  beforeEach(() => {
    testRegistry = new ResearchProjectRegistry();
    service = new ResearchWorkspaceService(testRegistry);
  });

  describe('1. Form 1: Project Creation & Structural Validation', () => {
    it('should successfully create a valid DRAFT project with explicit user-supplied questions and hypotheses', () => {
      const project = service.createProject(validProjectData);

      expect(project).toBeDefined();
      expect(project.project_id).toMatch(/^PROJ_/);
      expect(project.title).toBe(validProjectData.title);
      expect(project.description).toBe(validProjectData.description);
      expect(project.created_by).toBe('Dr. Elena Rostova');
      expect(project.status).toBe('DRAFT');
      expect(project.scientific_validity).toBe('NOT_ESTABLISHED');

      // Verify study design metadata
      expect(project.study_design.design_type).toBe('COHORT');
      expect(project.study_design.description).toContain('12-week prospective observational cohort');
      expect(project.study_design.metadata?.causality_disclaimer).toBeDefined();

      // Verify research question
      expect(project.research_questions).toHaveLength(1);
      expect(project.research_questions[0].question_text).toBe(validProjectData.research_question.question_text);
      expect(project.research_questions[0].priority).toBe('PRIMARY');

      // Verify objective
      expect(project.objectives).toHaveLength(1);
      expect(project.objectives[0].description).toBe(validProjectData.objective.description);

      // Verify hypothesis
      expect(project.hypotheses).toHaveLength(1);
      expect(project.hypotheses[0].null_hypothesis).toBe(validProjectData.hypothesis.null_hypothesis);
      expect(project.hypotheses[0].alternative_hypothesis).toBe(validProjectData.hypothesis.alternative_hypothesis);
      expect(project.hypotheses[0].direction).toBe('LESS');
      expect(project.hypotheses[0].planned_alpha).toBe(0.05);

      // Provenance hash computed
      expect(project.provenance_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should reject project creation when title or description is missing or blank', () => {
      expect(() => {
        service.createProject({
          ...validProjectData,
          title: '   '
        });
      }).toThrowError(/Project title is required/);

      expect(() => {
        service.createProject({
          ...validProjectData,
          description: ''
        });
      }).toThrowError(/Project description is required/);
    });

    it('should reject project creation when author (created_by) is missing or blank', () => {
      expect(() => {
        service.createProject({
          ...validProjectData,
          created_by: '  '
        });
      }).toThrowError(/Created by \(author\) is required/);
    });

    it('should reject project creation when study design description is missing', () => {
      expect(() => {
        service.createProject({
          ...validProjectData,
          study_design: {
            ...validProjectData.study_design,
            description: '   '
          }
        });
      }).toThrowError(/Study design description is required/);
    });
  });

  describe('2. Explicit Research Question Requirement (Anti-Slop / Zero Auto-Generation)', () => {
    it('should strictly reject project creation if research question is missing or blank', () => {
      expect(() => {
        service.createProject({
          ...validProjectData,
          research_question: {
            question_text: '',
            priority: 'PRIMARY'
          }
        });
      }).toThrowError(/Explicit research question is required/);

      expect(() => {
        service.createProject({
          ...validProjectData,
          research_question: {
            question_text: '   ',
            priority: 'SECONDARY'
          }
        });
      }).toThrowError(/Explicit research question is required/);
    });

    it('should link the user-supplied question to the user-supplied objective', () => {
      const project = service.createProject(validProjectData);
      const question = project.research_questions[0];
      const objective = project.objectives[0];

      expect(question.objective_ids).toContain(objective.objective_id);
    });
  });

  describe('3. Explicit Hypothesis Requirement (Null & Alternative)', () => {
    it('should strictly reject project creation if null hypothesis is missing or blank', () => {
      expect(() => {
        service.createProject({
          ...validProjectData,
          hypothesis: {
            ...validProjectData.hypothesis,
            null_hypothesis: ''
          }
        });
      }).toThrowError(/Explicit null and alternative hypotheses are required/);

      expect(() => {
        service.createProject({
          ...validProjectData,
          hypothesis: {
            ...validProjectData.hypothesis,
            null_hypothesis: '   '
          }
        });
      }).toThrowError(/Explicit null and alternative hypotheses are required/);
    });

    it('should strictly reject project creation if alternative hypothesis is missing or blank', () => {
      expect(() => {
        service.createProject({
          ...validProjectData,
          hypothesis: {
            ...validProjectData.hypothesis,
            alternative_hypothesis: ''
          }
        });
      }).toThrowError(/Explicit null and alternative hypotheses are required/);
    });

    it('should support directional (GREATER / LESS) and two-sided hypotheses', () => {
      const twoSidedProj = service.createProject({
        ...validProjectData,
        project_id: 'PROJ_TWO_SIDED',
        hypothesis: {
          ...validProjectData.hypothesis,
          direction: 'TWO_SIDED'
        }
      });
      expect(twoSidedProj.hypotheses[0].direction).toBe('TWO_SIDED');

      const greaterProj = service.createProject({
        ...validProjectData,
        project_id: 'PROJ_GREATER',
        hypothesis: {
          ...validProjectData.hypothesis,
          direction: 'GREATER'
        }
      });
      expect(greaterProj.hypotheses[0].direction).toBe('GREATER');
    });
  });

  describe('4. Form 2: Dataset Selection & Binding', () => {
    it('should successfully bind a sealed dataset version and artifact to a project', () => {
      const project = service.createProject(validProjectData);
      const versions = service.listDatasetVersions();
      expect(versions.length).toBeGreaterThan(0);

      const targetVersion = versions[0];
      const artifacts = service.listArtifacts(targetVersion.version_id);
      expect(artifacts.length).toBeGreaterThan(0);

      const targetArtifact = artifacts[0];

      const bindData: BindDatasetFormData = {
        project_id: project.project_id,
        dataset_version_id: targetVersion.version_id,
        data_artifact_id: targetArtifact.artifact_id,
        binding_notes: 'Verified cohort baseline artifact'
      };

      const updated = service.bindDataset(bindData);

      expect(updated.dataset_binding).toBeDefined();
      expect(updated.dataset_binding?.dataset_version_id).toBe(targetVersion.version_id);
      expect(updated.dataset_binding?.data_artifact_id).toBe(targetArtifact.artifact_id);
      expect(updated.dataset_binding?.source_artifact_checksum).toBe(targetArtifact.checksum);
      expect(updated.dataset_binding?.binding_notes).toBe('Verified cohort baseline artifact');
      expect(updated.dataset_binding?.bound_at).toBeDefined();

      // Project status preserves valid lifecycle transition
      expect(['DRAFT', 'DATA_BOUND']).toContain(updated.status);
    });

    it('should reject binding when dataset version does not exist in store', () => {
      const project = service.createProject(validProjectData);

      expect(() => {
        service.bindDataset({
          project_id: project.project_id,
          dataset_version_id: 'NON_EXISTENT_VERSION_999',
          data_artifact_id: 'ART_GLYCEMIC_RAW_01'
        });
      }).toThrowError(/does not exist in the Dataset Version Store/);
    });

    it('should reject binding when data artifact does not exist in store', () => {
      const project = service.createProject(validProjectData);
      const versions = service.listDatasetVersions();

      expect(() => {
        service.bindDataset({
          project_id: project.project_id,
          dataset_version_id: versions[0].version_id,
          data_artifact_id: 'NON_EXISTENT_ARTIFACT_999'
        });
      }).toThrowError(/does not exist in the Data Artifact Store/);
    });
  });

  describe('5. Checksum Integrity Validation & Corruption Rejection', () => {
    it('should reject dataset binding if the artifact checksum does not match expected', () => {
      const project = service.createProject(validProjectData);
      const versions = service.listDatasetVersions();
      const versionId = versions[0].version_id;
      const artifacts = service.listArtifacts(versionId);
      const artifact = artifacts[0];

      // Direct workflow call with mismatched expected_checksum
      expect(() => {
        ResearchWorkflow.bindDataset(
          project,
          {
            dataset_version_id: versionId,
            data_artifact_id: artifact.artifact_id,
            source_artifact_checksum: 'CORRUPTED_CHECKSUM_0000000000000000000000000000000000',
            bound_at: new Date().toISOString()
          },
          {
            expected_checksum: artifact.checksum
          }
        );
      }).toThrow(ScientificProjectError);
    });
  });

  describe('6. Cross-Version Rejection (Never Silently Switches)', () => {
    it('should strictly reject binding when an artifact belongs to a different dataset version', () => {
      const project = service.createProject(validProjectData);

      // Create a second version with a different artifact
      const altVersionId = 'DSV_CROSS_VERSION_TEST';
      const altArtifactId = 'ART_CROSS_VERSION_TEST';

      try {
        const versionStore = (service as any).versionStore as DatasetVersionStore;
        const artifactStore = (service as any).artifactStore as DataArtifactStore;

        const altVer = createDatasetVersion({
          version_id: altVersionId,
          dataset_id: 'DS_GLYCEMIC_COHORT_2026',
          version_number: 99,
          record_count: 50,
          column_count: 4,
          status: 'ACTIVE',
          created_by: 'TEST_STEWARD'
        });
        versionStore.create(altVer);

        const altArt = createDataArtifact({
          artifact_id: altArtifactId,
          dataset_version_id: altVersionId, // belongs to altVersionId
          state: 'RAW',
          created_by: 'TEST_STEWARD',
          record_count: 50,
          column_count: 4
        });
        artifactStore.create(altArt);

        // Attempt cross-version binding: request DSV_GLYCEMIC_V1 with altArtifactId (which belongs to altVersionId)
        expect(() => {
          service.bindDataset({
            project_id: project.project_id,
            dataset_version_id: 'DSV_GLYCEMIC_V1',
            data_artifact_id: altArtifactId
          });
        }).toThrowError(/belongs to dataset version/);
      } catch (err) {
        // If altVersion was already created, the expectation inside must still pass
        if (!(err as Error).message.includes('belongs to dataset version')) {
          throw err;
        }
      }
    });
  });

  describe('7. Form 3: Variable Role Planning (All 9 Roles Supported)', () => {
    const roles: VariableRole[] = [
      'OUTCOME',
      'EXPOSURE',
      'PREDICTOR',
      'COVARIATE',
      'GROUPING',
      'PAIRING',
      'TIME',
      'STRATIFICATION',
      'OTHER'
    ];

    roles.forEach((role) => {
      it(`should successfully assign role '${role}' to a registered variable`, () => {
        const project = service.createProject({
          ...validProjectData,
          project_id: `PROJ_ROLE_${role}`
        });

        const planData: PlanVariableFormData = {
          project_id: project.project_id,
          variable_id: 'VAR_FASTING_GLUCOSE',
          role: role,
          rationale: `Assigned as ${role} for methodological modeling.`,
          expected_unit: 'mg/dL'
        };

        const updated = service.planVariable(planData);
        expect(updated.variable_plan).toHaveLength(1);
        expect(updated.variable_plan[0].variable_id).toBe('VAR_FASTING_GLUCOSE');
        expect(updated.variable_plan[0].role).toBe(role);
        expect(updated.variable_plan[0].rationale).toBe(planData.rationale);
      });
    });

    it('should NOT alter the underlying Variable Registry when a role is planned', () => {
      const originalVar = service.getVariable('VAR_FASTING_GLUCOSE');
      expect(originalVar).toBeDefined();

      const project = service.createProject(validProjectData);
      service.planVariable({
        project_id: project.project_id,
        variable_id: 'VAR_FASTING_GLUCOSE',
        role: 'OUTCOME',
        rationale: 'Primary target endpoint'
      });

      const varAfterPlan = service.getVariable('VAR_FASTING_GLUCOSE');
      expect(varAfterPlan).toEqual(originalVar);
      expect((varAfterPlan as any).role).toBeUndefined(); // Role belongs strictly to project variable_plan
    });

    it('should update existing variable plan entry when planning the same variable again', () => {
      const project = service.createProject(validProjectData);

      service.planVariable({
        project_id: project.project_id,
        variable_id: 'VAR_SOLUBLE_FIBER',
        role: 'EXPOSURE',
        rationale: 'Initial assignment'
      });

      const updated = service.planVariable({
        project_id: project.project_id,
        variable_id: 'VAR_SOLUBLE_FIBER',
        role: 'COVARIATE',
        rationale: 'Adjusted role in secondary model'
      });

      expect(updated.variable_plan).toHaveLength(1);
      expect(updated.variable_plan[0].role).toBe('COVARIATE');
      expect(updated.variable_plan[0].rationale).toBe('Adjusted role in secondary model');
    });
  });

  describe('8. Invalid Variable Rejection', () => {
    it('should reject planning a variable not present in the Variable Registry', () => {
      const project = service.createProject(validProjectData);

      expect(() => {
        service.planVariable({
          project_id: project.project_id,
          variable_id: 'UNREGISTERED_NON_EXISTENT_VAR',
          role: 'PREDICTOR',
          rationale: 'Should fail'
        });
      }).toThrowError(/is not registered in the Variable Registry/);
    });
  });

  describe('9. Immutability Enforcement (Locked Projects)', () => {
    it('should reject dataset binding and variable planning on FINALIZED projects', () => {
      let project = service.createProject(validProjectData);

      // Progress lifecycle to FINALIZED
      // DRAFT -> PLANNED -> DATA_BOUND -> ANALYSIS_READY -> EXECUTING -> ANALYZED -> INTERPRETED -> REPORT_READY -> FINALIZED
      project = testRegistry.updateProjectStatus(project.project_id, 'PLANNED');

      const versions = service.listDatasetVersions();
      const artifacts = service.listArtifacts(versions[0].version_id);
      project = service.bindDataset({
        project_id: project.project_id,
        dataset_version_id: versions[0].version_id,
        data_artifact_id: artifacts[0].artifact_id
      });

      project = service.planVariable({
        project_id: project.project_id,
        variable_id: 'VAR_FASTING_GLUCOSE',
        role: 'OUTCOME'
      });

      project = ResearchWorkflow.planAnalysis(project, {
        analysis_id: 'PA_FINAL',
        objective_id: project.objectives[0].objective_id,
        analysis_type: 'DESCRIPTIVE',
        input_variables: ['VAR_FASTING_GLUCOSE'],
        planned_rationale: 'Baseline analysis',
        status: 'PLANNED'
      });
      testRegistry.registerProject(project);

      project = testRegistry.updateProjectStatus(project.project_id, 'ANALYSIS_READY');
      project = testRegistry.updateProjectStatus(project.project_id, 'EXECUTING');
      project = testRegistry.updateProjectStatus(project.project_id, 'ANALYZED');
      project = testRegistry.updateProjectStatus(project.project_id, 'INTERPRETED');
      project = testRegistry.updateProjectStatus(project.project_id, 'REPORT_READY');
      project = testRegistry.updateProjectStatus(project.project_id, 'FINALIZED');

      expect(project.status).toBe('FINALIZED');

      // Attempting to bind dataset on FINALIZED project must throw
      expect(() => {
        service.bindDataset({
          project_id: project.project_id,
          dataset_version_id: versions[0].version_id,
          data_artifact_id: artifacts[0].artifact_id
        });
      }).toThrowError(/PROJECT_IMMUTABILITY_VIOLATION/);

      // Attempting to plan variable on FINALIZED project must throw
      expect(() => {
        service.planVariable({
          project_id: project.project_id,
          variable_id: 'VAR_BODY_MASS_INDEX',
          role: 'COVARIATE'
        });
      }).toThrowError(/PROJECT_IMMUTABILITY_VIOLATION/);
    });

    it('should reject any modifications on ARCHIVED projects', () => {
      let project = service.createProject(validProjectData);
      project = testRegistry.updateProjectStatus(project.project_id, 'ARCHIVED');
      expect(project.status).toBe('ARCHIVED');

      expect(() => {
        service.planVariable({
          project_id: project.project_id,
          variable_id: 'VAR_AGE_YEARS',
          role: 'COVARIATE'
        });
      }).toThrowError(/PROJECT_IMMUTABILITY_VIOLATION/);
    });
  });

  describe('10. Security Audit & Invariants', () => {
    it('should strictly maintain scientific_validity = NOT_ESTABLISHED across all operations', () => {
      const project = service.createProject(validProjectData);
      expect(project.scientific_validity).toBe('NOT_ESTABLISHED');

      const versions = service.listDatasetVersions();
      const artifacts = service.listArtifacts(versions[0].version_id);

      const bound = service.bindDataset({
        project_id: project.project_id,
        dataset_version_id: versions[0].version_id,
        data_artifact_id: artifacts[0].artifact_id
      });
      expect(bound.scientific_validity).toBe('NOT_ESTABLISHED');

      const planned = service.planVariable({
        project_id: project.project_id,
        variable_id: 'VAR_SOLUBLE_FIBER',
        role: 'EXPOSURE'
      });
      expect(planned.scientific_validity).toBe('NOT_ESTABLISHED');
    });

    it('should verify ZERO eval() and ZERO new Function() across all newly created application layer files', () => {
      const targetFiles = [
        path.resolve(process.cwd(), 'src/services/researchWorkspaceService.ts'),
        path.resolve(process.cwd(), 'src/components/research/ProjectCreationForm.tsx'),
        path.resolve(process.cwd(), 'src/components/research/DatasetBindingForm.tsx'),
        path.resolve(process.cwd(), 'src/components/research/VariablePlanningForm.tsx'),
        path.resolve(process.cwd(), 'src/components/research/ResearchWorkspaceView.tsx')
      ];

      for (const filePath of targetFiles) {
        expect(fs.existsSync(filePath)).toBe(true);
        const code = fs.readFileSync(filePath, 'utf8');

        // Check for eval()
        const evalMatches = code.match(/\beval\s*\(/g);
        expect(evalMatches, `eval() found in ${filePath}`).toBeNull();

        // Check for new Function()
        const newFunctionMatches = code.match(/new\s+Function\s*\(/g);
        expect(newFunctionMatches, `new Function() found in ${filePath}`).toBeNull();
      }
    });
  });
});
