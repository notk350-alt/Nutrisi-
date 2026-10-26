import { describe, it, expect, beforeEach } from 'vitest';
import {
  createDataset,
  DatasetStore
} from '../data/datasetContract';
import {
  createDatasetVersion,
  DatasetVersionStore
} from '../data/datasetVersion';
import {
  ALLOWED_STATE_TRANSITIONS,
  computeDataArtifactChecksum,
  createDataArtifact,
  DataArtifactStore,
  DataArtifactValidator,
  DataStatePipeline,
  PipelineExecutionStore,
  PipelineExecutionValidator,
  StateTransitionStore,
  StateTransitionValidator,
  VALID_DATA_STATES,
  VALID_PIPELINE_STATUSES
} from '../data/dataStatePipeline';
import {
  DataArtifact,
  DataState,
  Dataset,
  DatasetVersion,
  PipelineExecution,
  PipelineExecutionStatus,
  ScientificDataStateError,
  StateTransition
} from '../types';

describe('Phase D5 — Scientific Data Layer: Data-State Pipeline', () => {
  let datasetStore: DatasetStore;
  let versionStore: DatasetVersionStore;
  let artifactStore: DataArtifactStore;
  let transitionStore: StateTransitionStore;
  let executionStore: PipelineExecutionStore;
  let pipeline: DataStatePipeline;

  let testDataset: Dataset;
  let testVersion: DatasetVersion;

  beforeEach(() => {
    datasetStore = new DatasetStore();
    versionStore = new DatasetVersionStore(datasetStore);
    artifactStore = new DataArtifactStore({ versionStore });
    transitionStore = new StateTransitionStore();
    executionStore = new PipelineExecutionStore();

    pipeline = new DataStatePipeline({
      artifactStore,
      transitionStore,
      executionStore,
      versionStore
    });

    testDataset = datasetStore.create(
      createDataset({
        dataset_id: 'ds-cohort-2026',
        name: 'Cohort 2026',
        owner_id: 'user-01',
        purpose: 'RESEARCH',
        source: { type: 'PRIMARY_COLLECTION', name: 'Clinical Clinic' }
      })
    );

    testVersion = versionStore.create(
      createDatasetVersion({
        version_id: 'dsv-cohort-v1',
        dataset_id: testDataset.dataset_id,
        version_number: 1,
        created_by: 'user-01'
      })
    );
  });

  describe('1. DataState Contract & DataArtifact Validator', () => {
    it('should validate all permitted DataState values', () => {
      const expectedStates: DataState[] = ['RAW', 'WORKING_COPY', 'CLEANED', 'VALIDATED', 'ANALYSIS_READY'];
      expect(Array.from(VALID_DATA_STATES)).toEqual(expectedStates);
    });

    it('should validate valid RAW artifact (null parent_artifact_id)', () => {
      const rawPayload = {
        artifact_id: 'art-raw-01',
        dataset_version_id: testVersion.version_id,
        state: 'RAW' as DataState,
        created_at: new Date().toISOString(),
        created_by: 'user-01'
      };
      const checksum = computeDataArtifactChecksum(rawPayload);
      const artifact: DataArtifact = {
        ...rawPayload,
        checksum
      };

      const res = DataArtifactValidator.validate(artifact);
      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(() => DataArtifactValidator.assertValid(artifact)).not.toThrow();
    });

    it('should reject RAW artifact having a parent_artifact_id', () => {
      const rawWithParent = {
        artifact_id: 'art-raw-bad',
        dataset_version_id: testVersion.version_id,
        state: 'RAW' as DataState,
        parent_artifact_id: 'art-other',
        created_at: new Date().toISOString(),
        created_by: 'user-01',
        checksum: 'a'.repeat(64)
      };

      const res = DataArtifactValidator.validate(rawWithParent);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes('RAW artifacts must have null or undefined parent_artifact_id'))).toBe(
        true
      );
    });

    it('should validate valid non-RAW artifact (requires parent_artifact_id)', () => {
      const nonRawStates: DataState[] = ['WORKING_COPY', 'CLEANED', 'VALIDATED', 'ANALYSIS_READY'];

      for (const state of nonRawStates) {
        const payload = {
          artifact_id: `art-${state.toLowerCase()}-01`,
          dataset_version_id: testVersion.version_id,
          state,
          parent_artifact_id: 'art-parent-01',
          created_at: new Date().toISOString(),
          created_by: 'user-01'
        };
        const checksum = computeDataArtifactChecksum(payload);
        const artifact: DataArtifact = {
          ...payload,
          checksum
        };

        const res = DataArtifactValidator.validate(artifact);
        expect(res.isValid).toBe(true);
      }
    });

    it('should reject non-RAW artifact without parent_artifact_id', () => {
      const nonRawWithoutParent = {
        artifact_id: 'art-clean-bad',
        dataset_version_id: testVersion.version_id,
        state: 'CLEANED' as DataState,
        created_at: new Date().toISOString(),
        created_by: 'user-01',
        checksum: 'a'.repeat(64)
      };

      const res = DataArtifactValidator.validate(nonRawWithoutParent);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes('requires a valid parent_artifact_id'))).toBe(true);
    });

    it('should reject invalid checksum, negative counts, or missing required fields', () => {
      const invalid = {
        artifact_id: '',
        dataset_version_id: '  ',
        state: 'INVALID_STATE',
        created_by: '',
        created_at: 'not-a-date',
        checksum: 'short',
        record_count: -1,
        column_count: -5
      };

      const res = DataArtifactValidator.validate(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errors.length).toBeGreaterThan(4);
    });
  });

  describe('2. Deterministic Checksum & Tamper Evidence', () => {
    it('should produce identical SHA-256 for identical payload regardless of key order', () => {
      const p1 = {
        artifact_id: 'art-01',
        dataset_version_id: 'dsv-01',
        state: 'RAW' as DataState,
        created_at: '2026-09-24T00:00:00.000Z',
        created_by: 'user-01',
        metadata: { a: 1, b: 2 }
      };

      const p2 = {
        metadata: { b: 2, a: 1 },
        created_by: 'user-01',
        state: 'RAW' as DataState,
        created_at: '2026-09-24T00:00:00.000Z',
        artifact_id: 'art-01',
        dataset_version_id: 'dsv-01'
      };

      expect(computeDataArtifactChecksum(p1)).toBe(computeDataArtifactChecksum(p2));
    });

    it('should produce distinct checksums when any attribute changes', () => {
      const base = {
        artifact_id: 'art-01',
        dataset_version_id: 'dsv-01',
        state: 'RAW' as DataState,
        created_at: '2026-09-24T00:00:00.000Z',
        created_by: 'user-01'
      };

      const hashBase = computeDataArtifactChecksum(base);
      const hashDiffState = computeDataArtifactChecksum({ ...base, state: 'WORKING_COPY' });
      const hashDiffCount = computeDataArtifactChecksum({ ...base, record_count: 50 });

      expect(hashBase).not.toBe(hashDiffState);
      expect(hashBase).not.toBe(hashDiffCount);
    });

    it('should verify stored checksum via verifyChecksum()', () => {
      const raw = pipeline.initializeRawArtifact({
        artifact_id: 'art-raw-verify',
        dataset_version_id: testVersion.version_id,
        created_by: 'user-01',
        record_count: 100
      });

      const verification = artifactStore.verifyChecksum(raw.artifact_id);
      expect(verification.matches).toBe(true);
      expect(verification.storedChecksum).toBe(verification.computedChecksum);
    });
  });

  describe('3. State Transition Graph Rules & State Skipping Prevention', () => {
    it('should permit legal transitions', () => {
      const legalTransitions: [DataState, DataState][] = [
        ['RAW', 'WORKING_COPY'],
        ['WORKING_COPY', 'CLEANED'],
        ['WORKING_COPY', 'WORKING_COPY'],
        ['CLEANED', 'VALIDATED'],
        ['CLEANED', 'CLEANED'],
        ['VALIDATED', 'ANALYSIS_READY'],
        ['VALIDATED', 'VALIDATED']
      ];

      for (const [from, to] of legalTransitions) {
        const payload: StateTransition = {
          transition_id: `trans-${from}-${to}`,
          dataset_version_id: testVersion.version_id,
          source_artifact_id: 'art-source',
          target_artifact_id: 'art-target',
          from_state: from,
          to_state: to,
          operation: 'LEGAL_OP',
          created_by: 'user-01',
          created_at: new Date().toISOString()
        };
        const res = StateTransitionValidator.validate(payload);
        expect(res.isValid).toBe(true);
      }
    });

    it('should strictly reject illegal state transitions and state skipping', () => {
      const illegalTransitions: [DataState, DataState][] = [
        ['RAW', 'CLEANED'], // Skips WORKING_COPY
        ['RAW', 'VALIDATED'], // Skips WORKING_COPY & CLEANED
        ['RAW', 'ANALYSIS_READY'], // Skips all
        ['WORKING_COPY', 'VALIDATED'], // Skips CLEANED
        ['WORKING_COPY', 'ANALYSIS_READY'], // Skips CLEANED & VALIDATED
        ['CLEANED', 'ANALYSIS_READY'] // Skips VALIDATED
      ];

      for (const [from, to] of illegalTransitions) {
        const payload = {
          transition_id: `trans-illegal-${from}-${to}`,
          dataset_version_id: testVersion.version_id,
          source_artifact_id: 'art-source',
          target_artifact_id: 'art-target',
          from_state: from,
          to_state: to,
          operation: 'ILLEGAL_OP',
          created_by: 'user-01',
          created_at: new Date().toISOString()
        };

        const res = StateTransitionValidator.validate(payload);
        expect(res.isValid).toBe(false);
        expect(res.errors.some((e) => e.includes('Illegal state transition'))).toBe(true);
        expect(() => StateTransitionValidator.assertValid(payload)).toThrowError(
          /DATA_STATE_ILLEGAL_TRANSITION/
        );
      }
    });
  });

  describe('4. Complete Sequential Lifecycle Pipeline Execution', () => {
    it('should step through RAW -> WORKING_COPY -> CLEANED -> VALIDATED -> ANALYSIS_READY', () => {
      // Step 1: Initialize RAW
      const rawArtifact = pipeline.initializeRawArtifact({
        artifact_id: 'art-step-1-raw',
        dataset_version_id: testVersion.version_id,
        created_by: 'user-01',
        record_count: 500,
        column_count: 10,
        description: 'Initial raw hospital export'
      });
      expect(rawArtifact.state).toBe('RAW');
      expect(rawArtifact.parent_artifact_id).toBeNull();

      // Step 2: Transition RAW -> WORKING_COPY
      const step2 = pipeline.executeTransition({
        transition_id: 'trans-01',
        execution_id: 'exec-01',
        dataset_version_id: testVersion.version_id,
        source_artifact_id: rawArtifact.artifact_id,
        target_artifact_id: 'art-step-2-wc',
        to_state: 'WORKING_COPY',
        operation: 'INITIALIZE_WORKING_COPY',
        created_by: 'user-01',
        reason: 'Preparing working copy for transformation'
      });
      expect(step2.targetArtifact.state).toBe('WORKING_COPY');
      expect(step2.targetArtifact.parent_artifact_id).toBe(rawArtifact.artifact_id);
      expect(step2.execution.status).toBe('COMPLETED');
      expect(step2.transition.from_state).toBe('RAW');
      expect(step2.transition.to_state).toBe('WORKING_COPY');

      // Step 3: Transition WORKING_COPY -> CLEANED
      const step3 = pipeline.executeTransition({
        transition_id: 'trans-02',
        execution_id: 'exec-02',
        dataset_version_id: testVersion.version_id,
        source_artifact_id: step2.targetArtifact.artifact_id,
        target_artifact_id: 'art-step-3-cleaned',
        to_state: 'CLEANED',
        operation: 'REMOVE_CORRUPTED_RECORDS',
        created_by: 'user-researcher',
        parameters: { rows_removed: 5 },
        target_record_count: 495,
        reason: 'Cleaned records with unparseable delimiters'
      });
      expect(step3.targetArtifact.state).toBe('CLEANED');
      expect(step3.targetArtifact.record_count).toBe(495);

      // Step 4: Transition CLEANED -> VALIDATED
      const step4 = pipeline.executeTransition({
        transition_id: 'trans-03',
        execution_id: 'exec-03',
        dataset_version_id: testVersion.version_id,
        source_artifact_id: step3.targetArtifact.artifact_id,
        target_artifact_id: 'art-step-4-val',
        to_state: 'VALIDATED',
        operation: 'SCHEMA_AND_BOUNDARY_VALIDATION',
        created_by: 'validator-engine',
        parameters: { profile: 'cohort_2026_profile' },
        reason: 'Validation profile executed with 0 errors'
      });
      expect(step4.targetArtifact.state).toBe('VALIDATED');

      // Step 5: Transition VALIDATED -> ANALYSIS_READY
      const step5 = pipeline.executeTransition({
        transition_id: 'trans-04',
        execution_id: 'exec-04',
        dataset_version_id: testVersion.version_id,
        source_artifact_id: step4.targetArtifact.artifact_id,
        target_artifact_id: 'art-step-5-ready',
        to_state: 'ANALYSIS_READY',
        operation: 'ANALYSIS_GATEWAY_CONFIRMATION',
        created_by: 'lead-pi',
        reason: 'Approved for primary statistical calculation'
      });
      expect(step5.targetArtifact.state).toBe('ANALYSIS_READY');

      // Verify ancestry chain from ANALYSIS_READY back to RAW
      const ancestry = artifactStore.getAncestry(step5.targetArtifact.artifact_id);
      expect(ancestry).toHaveLength(4);
      expect(ancestry.map((a) => a.state)).toEqual(['VALIDATED', 'CLEANED', 'WORKING_COPY', 'RAW']);
      expect(ancestry[3].artifact_id).toBe(rawArtifact.artifact_id);
    });
  });

  describe('5. Immutability & Store Mutation Protection', () => {
    it('should freeze artifacts and reject external mutation', () => {
      const raw = pipeline.initializeRawArtifact({
        artifact_id: 'art-immut-raw',
        dataset_version_id: testVersion.version_id,
        created_by: 'user-01'
      });

      expect(() => {
        (raw as any).state = 'CLEANED';
      }).toThrow();

      const fetched = artifactStore.get(raw.artifact_id)!;
      expect(fetched.state).toBe('RAW');
    });

    it('should reject duplicate artifact_id', () => {
      pipeline.initializeRawArtifact({
        artifact_id: 'art-dup',
        dataset_version_id: testVersion.version_id,
        created_by: 'user-01'
      });

      expect(() =>
        pipeline.initializeRawArtifact({
          artifact_id: 'art-dup',
          dataset_version_id: testVersion.version_id,
          created_by: 'user-02'
        })
      ).toThrowError(/DATA_STATE_ARTIFACT_ALREADY_EXISTS/);
    });

    it('should reject artifact creation with non-existent dataset version', () => {
      expect(() =>
        createDataArtifact(
          {
            artifact_id: 'art-orphan',
            dataset_version_id: 'missing-version-id',
            state: 'RAW',
            created_by: 'user-01'
          },
          { versionStore }
        )
      ).toThrowError(/DATA_STATE_DATASET_VERSION_NOT_FOUND/);
    });

    it('should reject artifact creation with parent belonging to a different dataset version', () => {
      const otherVersion = versionStore.create(
        createDatasetVersion({
          version_id: 'dsv-other-version',
          dataset_id: testDataset.dataset_id,
          version_number: 2,
          created_by: 'user-01'
        })
      );

      const raw1 = pipeline.initializeRawArtifact({
        artifact_id: 'art-raw-v1',
        dataset_version_id: testVersion.version_id,
        created_by: 'user-01'
      });

      expect(() =>
        createDataArtifact(
          {
            artifact_id: 'art-wc-cross-version',
            dataset_version_id: otherVersion.version_id, // mismatch
            state: 'WORKING_COPY',
            parent_artifact_id: raw1.artifact_id,
            created_by: 'user-01'
          },
          { versionStore, artifactStore }
        )
      ).toThrowError(/DATA_STATE_PARENT_MISMATCH/);
    });
  });

  describe('6. Lineage, Branching & Trees', () => {
    it('should support multiple branching pipelines from a single working copy', () => {
      const raw = pipeline.initializeRawArtifact({
        artifact_id: 'raw-root',
        dataset_version_id: testVersion.version_id,
        created_by: 'user-01'
      });

      const wc = pipeline.executeTransition({
        transition_id: 't-wc',
        execution_id: 'e-wc',
        dataset_version_id: testVersion.version_id,
        source_artifact_id: raw.artifact_id,
        target_artifact_id: 'wc-main',
        to_state: 'WORKING_COPY',
        operation: 'SETUP_WC',
        created_by: 'user-01'
      }).targetArtifact;

      // Branch A: Method A cleaning
      const branchA = pipeline.executeTransition({
        transition_id: 't-clean-a',
        execution_id: 'e-clean-a',
        dataset_version_id: testVersion.version_id,
        source_artifact_id: wc.artifact_id,
        target_artifact_id: 'cleaned-method-a',
        to_state: 'CLEANED',
        operation: 'CLEANING_METHOD_A',
        created_by: 'investigator-a'
      }).targetArtifact;

      // Branch B: Method B cleaning
      const branchB = pipeline.executeTransition({
        transition_id: 't-clean-b',
        execution_id: 'e-clean-b',
        dataset_version_id: testVersion.version_id,
        source_artifact_id: wc.artifact_id,
        target_artifact_id: 'cleaned-method-b',
        to_state: 'CLEANED',
        operation: 'CLEANING_METHOD_B',
        created_by: 'investigator-b'
      }).targetArtifact;

      const tree = artifactStore.getLineageTree(testVersion.version_id);
      expect(tree).toHaveLength(1);
      expect(tree[0].artifact.artifact_id).toBe('raw-root');
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].artifact.artifact_id).toBe('wc-main');

      const wcChildren = tree[0].children[0].children;
      expect(wcChildren).toHaveLength(2);
      expect(wcChildren.map((c) => c.artifact.artifact_id)).toContain('cleaned-method-a');
      expect(wcChildren.map((c) => c.artifact.artifact_id)).toContain('cleaned-method-b');
    });

    it('should reject self-parenting and detect cycles', () => {
      const cyclic = {
        artifact_id: 'art-self',
        dataset_version_id: testVersion.version_id,
        state: 'WORKING_COPY' as DataState,
        parent_artifact_id: 'art-self',
        created_at: new Date().toISOString(),
        created_by: 'user-01',
        checksum: 'a'.repeat(64)
      };

      expect(() => artifactStore.create(cyclic)).toThrowError(/DATA_STATE_CYCLIC_LINEAGE/);
    });
  });

  describe('7. Pipeline Execution Lifecycle Tracking', () => {
    it('should validate all execution status values', () => {
      const expectedStatuses: PipelineExecutionStatus[] = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'];
      expect(Array.from(VALID_PIPELINE_STATUSES)).toEqual(expectedStatuses);
    });

    it('should track execution progression from PENDING to COMPLETED', () => {
      const exec = executionStore.create({
        execution_id: 'exec-flow-01',
        dataset_version_id: testVersion.version_id,
        source_artifact_id: 'art-01',
        operation: 'CONVERT_UNITS',
        status: 'PENDING',
        created_by: 'user-01',
        created_at: new Date().toISOString()
      });

      expect(exec.status).toBe('PENDING');

      const running = executionStore.updateStatus('exec-flow-01', 'RUNNING');
      expect(running.status).toBe('RUNNING');

      const completed = executionStore.updateStatus('exec-flow-01', 'COMPLETED', {
        target_artifact_id: 'art-02',
        warnings: ['Row 12 converted with precision flag']
      });

      expect(completed.status).toBe('COMPLETED');
      expect(completed.target_artifact_id).toBe('art-02');
      expect(completed.warnings).toHaveLength(1);
      expect(completed.completed_at).toBeDefined();
    });

    it('should track failed executions and preserve error details', () => {
      executionStore.create({
        execution_id: 'exec-fail-01',
        dataset_version_id: testVersion.version_id,
        source_artifact_id: 'art-01',
        operation: 'PARSE_CSV',
        status: 'RUNNING',
        created_by: 'user-01',
        created_at: new Date().toISOString()
      });

      const failed = executionStore.updateStatus('exec-fail-01', 'FAILED', {
        error: 'Invalid CSV delimiter detected at row 42.'
      });

      expect(failed.status).toBe('FAILED');
      expect(failed.error).toContain('Invalid CSV delimiter');
      expect(failed.completed_at).toBeDefined();
    });
  });

  describe('8. Pipeline Clear & Isolation', () => {
    it('should clear all stores on pipeline.clear()', () => {
      pipeline.initializeRawArtifact({
        artifact_id: 'art-to-clear',
        dataset_version_id: testVersion.version_id,
        created_by: 'user-01'
      });

      expect(artifactStore.list()).toHaveLength(1);
      pipeline.clear();
      expect(artifactStore.list()).toHaveLength(0);
      expect(transitionStore.list()).toHaveLength(0);
      expect(executionStore.list()).toHaveLength(0);
    });
  });

  describe('9. StateTransitionStore Queries & Provenance Verification', () => {
    it('should query transitions by artifact and dataset version', () => {
      const raw = pipeline.initializeRawArtifact({
        artifact_id: 'art-q-raw',
        dataset_version_id: testVersion.version_id,
        created_by: 'user-01'
      });

      const step = pipeline.executeTransition({
        transition_id: 'tr-q-01',
        execution_id: 'ex-q-01',
        dataset_version_id: testVersion.version_id,
        source_artifact_id: raw.artifact_id,
        target_artifact_id: 'art-q-wc',
        to_state: 'WORKING_COPY',
        operation: 'SETUP_WC',
        created_by: 'user-01',
        parameters: { encoding: 'utf-8' },
        reason: 'UTF-8 normalization'
      });

      const byDataset = transitionStore.findByDatasetVersion(testVersion.version_id);
      expect(byDataset).toHaveLength(1);
      expect(byDataset[0].parameters?.encoding).toBe('utf-8');

      const bySourceArtifact = transitionStore.findByArtifact('art-q-raw');
      expect(bySourceArtifact).toHaveLength(1);

      const byTargetArtifact = transitionStore.findByArtifact('art-q-wc');
      expect(byTargetArtifact).toHaveLength(1);
    });

    it('should reject transition recording with illegal state skipping', () => {
      expect(() =>
        StateTransitionValidator.assertValid({
          transition_id: 'tr-illegal',
          dataset_version_id: testVersion.version_id,
          source_artifact_id: 'art-1',
          target_artifact_id: 'art-2',
          from_state: 'RAW',
          to_state: 'ANALYSIS_READY',
          operation: 'FAST_FORWARD',
          created_by: 'user-01',
          created_at: new Date().toISOString()
        })
      ).toThrowError(/DATA_STATE_ILLEGAL_TRANSITION/);
    });
  });

  describe('10. Pipeline Transition Execution Failure Handling', () => {
    it('should fail pipeline execution and throw when source artifact is missing', () => {
      expect(() =>
        pipeline.executeTransition({
          transition_id: 'tr-missing',
          execution_id: 'ex-missing',
          dataset_version_id: testVersion.version_id,
          source_artifact_id: 'art-non-existent',
          target_artifact_id: 'art-target',
          to_state: 'WORKING_COPY',
          operation: 'OP',
          created_by: 'user-01'
        })
      ).toThrowError(/DATA_STATE_ARTIFACT_NOT_FOUND/);
    });
  });
});
