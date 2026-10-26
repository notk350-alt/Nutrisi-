import { describe, it, expect, beforeEach } from 'vitest';
import {
  createDataset,
  DatasetStore
} from '../data/datasetContract';
import {
  computeDatasetVersionChecksum,
  createDatasetVersion,
  DatasetVersionContractValidator,
  DatasetVersionStore,
  DatasetVersionValidator,
  VALID_DATASET_VERSION_STATUSES
} from '../data/datasetVersion';
import {
  Dataset,
  DatasetVersion,
  DatasetVersionStatus,
  ScientificDatasetVersionError
} from '../types';

describe('Phase D2 — Scientific Data Layer: Dataset Versioning', () => {
  let datasetStore: DatasetStore;
  let versionStore: DatasetVersionStore;
  let baseDataset: Dataset;

  beforeEach(() => {
    datasetStore = new DatasetStore();
    versionStore = new DatasetVersionStore(datasetStore);

    baseDataset = datasetStore.create(
      createDataset({
        dataset_id: 'ds-metabolic-cohort-2026',
        name: 'Metabolic Health Longitudinal Cohort',
        owner_id: 'user-researcher-01',
        purpose: 'RESEARCH',
        source: {
          type: 'PRIMARY_COLLECTION',
          name: 'Metabolic Study Lab'
        }
      })
    );
  });

  describe('1. DatasetVersion Contract Validator', () => {
    it('should validate a complete valid DatasetVersion payload', () => {
      const rawVersion = {
        version_id: 'dsv-001',
        dataset_id: 'ds-metabolic-cohort-2026',
        version_number: 1,
        status: 'SEALED' as DatasetVersionStatus,
        created_at: new Date().toISOString(),
        created_by: 'user-researcher-01'
      };
      const checksum = computeDatasetVersionChecksum(rawVersion);
      const validVersion: DatasetVersion = {
        ...rawVersion,
        checksum
      };

      const result = DatasetVersionValidator.validate(validVersion);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(() => DatasetVersionValidator.assertValid(validVersion)).not.toThrow();
    });

    it('should reject non-object or null input', () => {
      const resNull = DatasetVersionValidator.validate(null);
      expect(resNull.isValid).toBe(false);
      expect(resNull.errors[0]).toContain('non-null object');

      const resString = DatasetVersionValidator.validate('string-payload');
      expect(resString.isValid).toBe(false);
    });

    it('should reject empty or missing version_id', () => {
      const invalid = {
        version_id: '',
        dataset_id: 'ds-01',
        version_number: 1,
        status: 'SEALED',
        created_by: 'user-01',
        created_at: new Date().toISOString(),
        checksum: 'a'.repeat(64)
      };
      const res = DatasetVersionValidator.validate(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes('version_id'))).toBe(true);
      expect(() => DatasetVersionValidator.assertValid(invalid)).toThrowError(ScientificDatasetVersionError);
    });

    it('should reject empty or missing dataset_id', () => {
      const invalid = {
        version_id: 'dsv-01',
        dataset_id: '   ',
        version_number: 1,
        status: 'SEALED',
        created_by: 'user-01',
        created_at: new Date().toISOString(),
        checksum: 'a'.repeat(64)
      };
      const res = DatasetVersionValidator.validate(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes('dataset_id'))).toBe(true);
    });

    it('should reject invalid version_number (0, negative, non-integer)', () => {
      const testCases = [0, -1, 1.5, '1', null];
      for (const invalidNum of testCases) {
        const payload = {
          version_id: 'dsv-01',
          dataset_id: 'ds-01',
          version_number: invalidNum,
          status: 'SEALED',
          created_by: 'user-01',
          created_at: new Date().toISOString(),
          checksum: 'a'.repeat(64)
        };
        const res = DatasetVersionValidator.validate(payload);
        expect(res.isValid).toBe(false);
        expect(res.errors.some((e) => e.includes('version_number'))).toBe(true);
      }
    });

    it('should validate all permitted status enum values', () => {
      for (const status of VALID_DATASET_VERSION_STATUSES) {
        const payload = {
          version_id: 'dsv-01',
          dataset_id: 'ds-01',
          version_number: 1,
          status,
          created_by: 'user-01',
          created_at: new Date().toISOString(),
          checksum: 'a'.repeat(64)
        };
        const res = DatasetVersionValidator.validate(payload);
        expect(res.isValid).toBe(true);
      }
    });

    it('should reject invalid status value', () => {
      const invalid = {
        version_id: 'dsv-01',
        dataset_id: 'ds-01',
        version_number: 1,
        status: 'UNKNOWN_STATUS',
        created_by: 'user-01',
        created_at: new Date().toISOString(),
        checksum: 'a'.repeat(64)
      };
      const res = DatasetVersionValidator.validate(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes('status'))).toBe(true);
    });

    it('should reject empty created_by', () => {
      const invalid = {
        version_id: 'dsv-01',
        dataset_id: 'ds-01',
        version_number: 1,
        status: 'SEALED',
        created_by: '',
        created_at: new Date().toISOString(),
        checksum: 'a'.repeat(64)
      };
      const res = DatasetVersionValidator.validate(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes('created_by'))).toBe(true);
    });

    it('should reject invalid created_at timestamp', () => {
      const invalid = {
        version_id: 'dsv-01',
        dataset_id: 'ds-01',
        version_number: 1,
        status: 'SEALED',
        created_by: 'user-01',
        created_at: 'not-a-timestamp',
        checksum: 'a'.repeat(64)
      };
      const res = DatasetVersionValidator.validate(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes('created_at'))).toBe(true);
    });

    it('should reject malformed checksum string (not 64-hex)', () => {
      const invalidChecksums = ['short-hash', 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)];
      for (const chk of invalidChecksums) {
        const payload = {
          version_id: 'dsv-01',
          dataset_id: 'ds-01',
          version_number: 1,
          status: 'SEALED',
          created_by: 'user-01',
          created_at: new Date().toISOString(),
          checksum: chk
        };
        const res = DatasetVersionValidator.validate(payload);
        expect(res.isValid).toBe(false);
        expect(res.errors.some((e) => e.includes('checksum'))).toBe(true);
      }
    });

    it('should reject negative record_count or column_count', () => {
      const invalidCounts = [
        { record_count: -5 },
        { column_count: -1 },
        { record_count: 3.14 }
      ];
      for (const cnt of invalidCounts) {
        const payload = {
          version_id: 'dsv-01',
          dataset_id: 'ds-01',
          version_number: 1,
          status: 'SEALED',
          created_by: 'user-01',
          created_at: new Date().toISOString(),
          checksum: 'a'.repeat(64),
          ...cnt
        };
        const res = DatasetVersionValidator.validate(payload);
        expect(res.isValid).toBe(false);
      }
    });
  });

  describe('2. Deterministic Checksum Calculation', () => {
    it('should produce identical SHA-256 checksums for identical payloads regardless of key insertion order', () => {
      const payloadA = {
        version_id: 'dsv-101',
        dataset_id: 'ds-01',
        version_number: 1,
        created_by: 'user-01',
        created_at: '2026-09-24T00:00:00.000Z',
        record_count: 500,
        metadata: { a: 1, b: 2 }
      };

      const payloadB = {
        metadata: { b: 2, a: 1 },
        created_at: '2026-09-24T00:00:00.000Z',
        version_number: 1,
        dataset_id: 'ds-01',
        record_count: 500,
        version_id: 'dsv-101',
        created_by: 'user-01'
      };

      const hashA = computeDatasetVersionChecksum(payloadA);
      const hashB = computeDatasetVersionChecksum(payloadB);

      expect(hashA).toHaveLength(64);
      expect(hashA).toBe(hashB);
    });

    it('should produce distinct checksums when version content changes', () => {
      const payloadBase = {
        version_id: 'dsv-101',
        dataset_id: 'ds-01',
        version_number: 1,
        created_by: 'user-01',
        created_at: '2026-09-24T00:00:00.000Z'
      };

      const hashBase = computeDatasetVersionChecksum(payloadBase);
      const hashDiffCount = computeDatasetVersionChecksum({ ...payloadBase, record_count: 100 });
      const hashDiffParent = computeDatasetVersionChecksum({ ...payloadBase, parent_version_id: 'dsv-099' });
      const hashDiffRef = computeDatasetVersionChecksum({
        ...payloadBase,
        data_reference: { storage_uri: 's3://bucket/data.parquet' }
      });

      expect(hashBase).not.toBe(hashDiffCount);
      expect(hashBase).not.toBe(hashDiffParent);
      expect(hashBase).not.toBe(hashDiffRef);
    });
  });

  describe('3. createDatasetVersion Factory', () => {
    it('should create and freeze a valid DatasetVersion with auto-computed checksum', () => {
      const version = createDatasetVersion({
        version_id: 'dsv-2026-01',
        dataset_id: baseDataset.dataset_id,
        created_by: 'user-researcher-01',
        version_tag: 'v1.0.0-baseline',
        description: 'Baseline clinical assessment version',
        record_count: 120,
        column_count: 15,
        data_reference: {
          storage_uri: 'vault://datasets/metabolic_2026_v1.csv',
          format: 'CSV',
          checksum: 'sha256-data-blob'
        }
      });

      expect(version.version_id).toBe('dsv-2026-01');
      expect(version.dataset_id).toBe(baseDataset.dataset_id);
      expect(version.version_number).toBe(1);
      expect(version.status).toBe('SEALED');
      expect(version.checksum).toHaveLength(64);
      expect(Object.isFrozen(version)).toBe(true);
    });

    it('should throw VERSION_INTEGRITY_MISMATCH when explicitly supplied checksum does not match calculated hash', () => {
      expect(() =>
        createDatasetVersion({
          version_id: 'dsv-2026-01',
          dataset_id: baseDataset.dataset_id,
          created_by: 'user-01',
          checksum: 'f'.repeat(64)
        })
      ).toThrowError(/VERSION_INTEGRITY_MISMATCH/);
    });

    it('should verify dataset existence when datasetStore option is passed', () => {
      expect(() =>
        createDatasetVersion(
          {
            version_id: 'dsv-orphan',
            dataset_id: 'non-existent-dataset-id',
            created_by: 'user-01'
          },
          { datasetStore }
        )
      ).toThrowError(/VERSION_DATASET_NOT_FOUND/);
    });

    it('should verify parent version existence when versionStore option is passed', () => {
      expect(() =>
        createDatasetVersion(
          {
            version_id: 'dsv-v2',
            dataset_id: baseDataset.dataset_id,
            parent_version_id: 'missing-parent-id',
            created_by: 'user-01'
          },
          { datasetStore, versionStore }
        )
      ).toThrowError(/VERSION_PARENT_NOT_FOUND/);
    });

    it('should reject parent version belonging to a different dataset', () => {
      const otherDataset = datasetStore.create(
        createDataset({
          dataset_id: 'ds-cardio-01',
          name: 'Cardio Cohort',
          owner_id: 'user-02',
          purpose: 'RESEARCH',
          source: { type: 'IMPORTED', name: 'Import' }
        })
      );

      const vOther = versionStore.create(
        createDatasetVersion({
          version_id: 'dsv-cardio-v1',
          dataset_id: otherDataset.dataset_id,
          created_by: 'user-02'
        })
      );

      expect(() =>
        createDatasetVersion(
          {
            version_id: 'dsv-metabolic-v2',
            dataset_id: baseDataset.dataset_id,
            parent_version_id: vOther.version_id,
            created_by: 'user-01'
          },
          { datasetStore, versionStore }
        )
      ).toThrowError(/VERSION_PARENT_MISMATCH/);
    });
  });

  describe('4. DatasetVersionStore Repository & Lifecycle', () => {
    it('should register and retrieve a version', () => {
      const v1 = createDatasetVersion({
        version_id: 'dsv-v1',
        dataset_id: baseDataset.dataset_id,
        version_number: 1,
        created_by: 'user-researcher-01'
      });

      const stored = versionStore.create(v1);
      expect(stored.version_id).toBe('dsv-v1');

      const retrieved = versionStore.get('dsv-v1');
      expect(retrieved).toBeDefined();
      expect(retrieved?.version_id).toBe('dsv-v1');
      expect(retrieved?.version_number).toBe(1);
    });

    it('should retrieve version by dataset_id and version_number', () => {
      const v1 = versionStore.create(
        createDatasetVersion({
          version_id: 'dsv-v1',
          dataset_id: baseDataset.dataset_id,
          version_number: 1,
          created_by: 'user-01'
        })
      );

      const retrieved = versionStore.getByDatasetAndNumber(baseDataset.dataset_id, 1);
      expect(retrieved).toBeDefined();
      expect(retrieved?.version_id).toBe(v1.version_id);

      const missing = versionStore.getByDatasetAndNumber(baseDataset.dataset_id, 999);
      expect(missing).toBeUndefined();
    });

    it('should reject duplicate version_id', () => {
      const v1 = createDatasetVersion({
        version_id: 'dsv-v1',
        dataset_id: baseDataset.dataset_id,
        created_by: 'user-01'
      });
      versionStore.create(v1);

      expect(() => versionStore.create(v1)).toThrowError(/VERSION_ALREADY_EXISTS/);
    });

    it('should reject duplicate version_number within the same dataset', () => {
      versionStore.create(
        createDatasetVersion({
          version_id: 'dsv-v1-a',
          dataset_id: baseDataset.dataset_id,
          version_number: 1,
          created_by: 'user-01'
        })
      );

      expect(() =>
        versionStore.create(
          createDatasetVersion({
            version_id: 'dsv-v1-b',
            dataset_id: baseDataset.dataset_id,
            version_number: 1,
            created_by: 'user-01'
          })
        )
      ).toThrowError(/VERSION_DUPLICATE_NUMBER/);
    });

    it('should allow identical version_number across different datasets', () => {
      const otherDataset = datasetStore.create(
        createDataset({
          dataset_id: 'ds-other-dataset',
          name: 'Other Dataset',
          owner_id: 'user-02',
          purpose: 'SIMULATION',
          source: { type: 'SYNTHETIC', name: 'Sim' }
        })
      );

      const v1 = versionStore.create(
        createDatasetVersion({
          version_id: 'dsv-ds1-v1',
          dataset_id: baseDataset.dataset_id,
          version_number: 1,
          created_by: 'user-01'
        })
      );

      const v2 = versionStore.create(
        createDatasetVersion({
          version_id: 'dsv-ds2-v1',
          dataset_id: otherDataset.dataset_id,
          version_number: 1,
          created_by: 'user-02'
        })
      );

      expect(v1.version_number).toBe(1);
      expect(v2.version_number).toBe(1);
    });

    it('should list versions by dataset sorted ascending by version_number', () => {
      versionStore.create(
        createDatasetVersion({
          version_id: 'dsv-3',
          dataset_id: baseDataset.dataset_id,
          version_number: 3,
          created_by: 'user-01'
        })
      );
      versionStore.create(
        createDatasetVersion({
          version_id: 'dsv-1',
          dataset_id: baseDataset.dataset_id,
          version_number: 1,
          created_by: 'user-01'
        })
      );
      versionStore.create(
        createDatasetVersion({
          version_id: 'dsv-2',
          dataset_id: baseDataset.dataset_id,
          version_number: 2,
          created_by: 'user-01'
        })
      );

      const list = versionStore.listByDataset(baseDataset.dataset_id);
      expect(list).toHaveLength(3);
      expect(list.map((v) => v.version_number)).toEqual([1, 2, 3]);
    });

    it('should filter versions by status and author', () => {
      versionStore.create(
        createDatasetVersion({
          version_id: 'dsv-v1',
          dataset_id: baseDataset.dataset_id,
          version_number: 1,
          status: 'ARCHIVED',
          created_by: 'user-01'
        })
      );
      versionStore.create(
        createDatasetVersion({
          version_id: 'dsv-v2',
          dataset_id: baseDataset.dataset_id,
          version_number: 2,
          status: 'ACTIVE',
          created_by: 'user-02'
        })
      );
      versionStore.create(
        createDatasetVersion({
          version_id: 'dsv-v3',
          dataset_id: baseDataset.dataset_id,
          version_number: 3,
          status: 'ACTIVE',
          created_by: 'user-01'
        })
      );

      const activeList = versionStore.list({ status: 'ACTIVE' });
      expect(activeList).toHaveLength(2);

      const user01Active = versionStore.list({ status: 'ACTIVE', created_by: 'user-01' });
      expect(user01Active).toHaveLength(1);
      expect(user01Active[0].version_id).toBe('dsv-v3');
    });

    it('should support status updates while preserving immutable fields', () => {
      const original = versionStore.create(
        createDatasetVersion({
          version_id: 'dsv-v1',
          dataset_id: baseDataset.dataset_id,
          version_number: 1,
          status: 'DRAFT',
          created_by: 'user-01',
          description: 'Initial draft'
        })
      );

      const updated = versionStore.updateStatus('dsv-v1', 'SEALED', 'Finalized dataset version');
      expect(updated.status).toBe('SEALED');
      expect(updated.description).toBe('Finalized dataset version');

      // Verify immutable fields remain intact
      expect(updated.version_id).toBe(original.version_id);
      expect(updated.dataset_id).toBe(original.dataset_id);
      expect(updated.version_number).toBe(original.version_number);
      expect(updated.created_at).toBe(original.created_at);
      expect(updated.created_by).toBe(original.created_by);
      expect(updated.checksum).toBe(original.checksum);
    });

    it('should reject status update for non-existent version', () => {
      expect(() => versionStore.updateStatus('missing-v-id', 'ARCHIVED')).toThrowError(/VERSION_NOT_FOUND/);
    });

    it('should reject invalid status transition', () => {
      versionStore.create(
        createDatasetVersion({
          version_id: 'dsv-v1',
          dataset_id: baseDataset.dataset_id,
          created_by: 'user-01'
        })
      );

      expect(() => versionStore.updateStatus('dsv-v1', 'INVALID' as any)).toThrowError(/VERSION_INVALID_STATUS/);
    });
  });

  describe('5. Lineage Tracking & Cycle Detection', () => {
    it('should correctly trace linear version ancestry', () => {
      const v1 = versionStore.create(
        createDatasetVersion({
          version_id: 'dsv-lineage-1',
          dataset_id: baseDataset.dataset_id,
          version_number: 1,
          created_by: 'user-01'
        })
      );

      const v2 = versionStore.create(
        createDatasetVersion({
          version_id: 'dsv-lineage-2',
          dataset_id: baseDataset.dataset_id,
          version_number: 2,
          parent_version_id: v1.version_id,
          created_by: 'user-01'
        })
      );

      const v3 = versionStore.create(
        createDatasetVersion({
          version_id: 'dsv-lineage-3',
          dataset_id: baseDataset.dataset_id,
          version_number: 3,
          parent_version_id: v2.version_id,
          created_by: 'user-01'
        })
      );

      const ancestry = versionStore.getAncestry(v3.version_id);
      expect(ancestry).toHaveLength(2);
      expect(ancestry[0].version_id).toBe(v2.version_id);
      expect(ancestry[1].version_id).toBe(v1.version_id);

      const v1Ancestry = versionStore.getAncestry(v1.version_id);
      expect(v1Ancestry).toHaveLength(0);
    });

    it('should reject self-parenting', () => {
      const selfParentVersion: DatasetVersion = {
        version_id: 'dsv-self',
        dataset_id: baseDataset.dataset_id,
        version_number: 1,
        parent_version_id: 'dsv-self',
        status: 'SEALED',
        created_at: new Date().toISOString(),
        created_by: 'user-01',
        checksum: 'a'.repeat(64)
      };

      expect(() => versionStore.create(selfParentVersion)).toThrowError(/VERSION_CYCLIC_LINEAGE/);
    });

    it('should build hierarchical lineage tree', () => {
      const v1 = versionStore.create(
        createDatasetVersion({
          version_id: 'v1',
          dataset_id: baseDataset.dataset_id,
          version_number: 1,
          created_by: 'user-01'
        })
      );

      const v2a = versionStore.create(
        createDatasetVersion({
          version_id: 'v2a',
          dataset_id: baseDataset.dataset_id,
          version_number: 2,
          parent_version_id: 'v1',
          created_by: 'user-01'
        })
      );

      const v2b = versionStore.create(
        createDatasetVersion({
          version_id: 'v2b',
          dataset_id: baseDataset.dataset_id,
          version_number: 3,
          parent_version_id: 'v1',
          created_by: 'user-02'
        })
      );

      const v3 = versionStore.create(
        createDatasetVersion({
          version_id: 'v3',
          dataset_id: baseDataset.dataset_id,
          version_number: 4,
          parent_version_id: 'v2a',
          created_by: 'user-01'
        })
      );

      const tree = versionStore.getLineageTree(baseDataset.dataset_id);
      expect(tree).toHaveLength(1);
      expect(tree[0].version.version_id).toBe('v1');
      expect(tree[0].children).toHaveLength(2);

      const childV2a = tree[0].children.find((c) => c.version.version_id === 'v2a');
      expect(childV2a?.children).toHaveLength(1);
      expect(childV2a?.children[0].version.version_id).toBe('v3');
    });
  });

  describe('6. Checksum Verification & Tamper Detection', () => {
    it('should verify valid stored checksum', () => {
      const v = versionStore.create(
        createDatasetVersion({
          version_id: 'dsv-verified',
          dataset_id: baseDataset.dataset_id,
          version_number: 1,
          created_by: 'user-01',
          record_count: 50,
          metadata: { study_arm: 'control' }
        })
      );

      const verification = versionStore.verifyChecksum(v.version_id);
      expect(verification.matches).toBe(true);
      expect(verification.storedChecksum).toBe(verification.computedChecksum);
    });

    it('should isolate mutations outside the store', () => {
      const v = versionStore.create(
        createDatasetVersion({
          version_id: 'dsv-mut',
          dataset_id: baseDataset.dataset_id,
          created_by: 'user-01',
          metadata: { initial: true }
        })
      );

      const retrieved = versionStore.get(v.version_id)!;
      expect(() => {
        (retrieved as any).version_id = 'tampered';
      }).toThrow(); // Because object is frozen

      // Internal store remains pristine
      const secondFetch = versionStore.get(v.version_id)!;
      expect(secondFetch.version_id).toBe('dsv-mut');
    });
  });

  describe('7. Store Reset Isolation', () => {
    it('should clear store upon clear() call', () => {
      versionStore.create(
        createDatasetVersion({
          version_id: 'dsv-to-clear',
          dataset_id: baseDataset.dataset_id,
          created_by: 'user-01'
        })
      );

      expect(versionStore.list()).toHaveLength(1);
      versionStore.clear();
      expect(versionStore.list()).toHaveLength(0);
      expect(versionStore.get('dsv-to-clear')).toBeUndefined();
    });
  });

  describe('8. Multi-generation Lineage & Forest Lineage', () => {
    it('should handle deep multi-generation lineage chains (5+ generations)', () => {
      let previousVersionId: string | null = null;
      const createdIds: string[] = [];

      for (let i = 1; i <= 6; i++) {
        const v = versionStore.create(
          createDatasetVersion({
            version_id: `dsv-gen-${i}`,
            dataset_id: baseDataset.dataset_id,
            version_number: i,
            parent_version_id: previousVersionId,
            created_by: 'user-01',
            description: `Generation ${i}`
          })
        );
        createdIds.push(v.version_id);
        previousVersionId = v.version_id;
      }

      const ancestry = versionStore.getAncestry('dsv-gen-6');
      expect(ancestry).toHaveLength(5);
      expect(ancestry.map((a) => a.version_id)).toEqual([
        'dsv-gen-5',
        'dsv-gen-4',
        'dsv-gen-3',
        'dsv-gen-2',
        'dsv-gen-1'
      ]);
    });

    it('should handle multiple root versions (forest structure) for the same dataset', () => {
      const rootA = versionStore.create(
        createDatasetVersion({
          version_id: 'root-a',
          dataset_id: baseDataset.dataset_id,
          version_number: 1,
          created_by: 'user-01'
        })
      );

      const rootB = versionStore.create(
        createDatasetVersion({
          version_id: 'root-b',
          dataset_id: baseDataset.dataset_id,
          version_number: 2,
          created_by: 'user-02'
        })
      );

      const childA1 = versionStore.create(
        createDatasetVersion({
          version_id: 'child-a1',
          dataset_id: baseDataset.dataset_id,
          version_number: 3,
          parent_version_id: 'root-a',
          created_by: 'user-01'
        })
      );

      const tree = versionStore.getLineageTree(baseDataset.dataset_id);
      expect(tree).toHaveLength(2);
      expect(tree[0].version.version_id).toBe('root-a');
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].version.version_id).toBe('child-a1');
      expect(tree[1].version.version_id).toBe('root-b');
      expect(tree[1].children).toHaveLength(0);
    });
  });

  describe('9. DatasetVersion Linkage to Provenance & Execution Contract', () => {
    it('should provide deterministic version reference compatible with Phase C Provenance', () => {
      const version = versionStore.create(
        createDatasetVersion({
          version_id: 'dsv-for-provenance',
          dataset_id: baseDataset.dataset_id,
          version_number: 1,
          created_by: 'user-researcher',
          data_reference: {
            storage_uri: 'provenance://blobs/records_v1.parquet',
            format: 'PARQUET',
            checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            record_count: 1000
          }
        })
      );

      expect(version.dataset_id).toBe('ds-metabolic-cohort-2026');
      expect(version.version_id).toBe('dsv-for-provenance');
      expect(version.checksum).toBeDefined();
    });
  });
});
