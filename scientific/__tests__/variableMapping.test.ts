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
  createVariable,
  VariableStore
} from '../data/variableRegistry';
import {
  checkMappingDatatypeCompatibility,
  checkMappingUnitCompatibility,
  createVariableMapping,
  VALID_MAPPING_METHODS,
  VALID_MAPPING_STATUSES,
  VariableMappingStore,
  VariableMappingValidator
} from '../data/variableMapping';
import {
  Dataset,
  DatasetVersion,
  ScientificVariableMappingError,
  Variable,
  VariableMapping,
  VariableMappingMethod,
  VariableMappingStatus
} from '../types';

describe('Phase D4 — Scientific Data Layer: Variable Mapping', () => {
  let datasetStore: DatasetStore;
  let versionStore: DatasetVersionStore;
  let variableStore: VariableStore;
  let mappingStore: VariableMappingStore;

  let testDataset: Dataset;
  let testVersion: DatasetVersion;
  let varWeight: Variable;
  let varHeight: Variable;
  let varAge: Variable;

  beforeEach(() => {
    datasetStore = new DatasetStore();
    versionStore = new DatasetVersionStore(datasetStore);
    variableStore = new VariableStore();
    mappingStore = new VariableMappingStore({
      variableStore,
      versionStore
    });

    testDataset = datasetStore.create(
      createDataset({
        dataset_id: 'ds-metabolic-01',
        name: 'Metabolic Study',
        owner_id: 'user-01',
        purpose: 'RESEARCH',
        source: { type: 'PRIMARY_COLLECTION', name: 'Lab' }
      })
    );

    testVersion = versionStore.create(
      createDatasetVersion({
        version_id: 'dsv-metabolic-v1',
        dataset_id: testDataset.dataset_id,
        version_number: 1,
        created_by: 'user-01'
      })
    );

    varWeight = variableStore.create(
      createVariable({
        variable_id: 'VAR_BODY_WEIGHT',
        name: 'Body Weight',
        description: 'Total body mass in kg',
        datatype: 'NUMBER',
        unit: 'kg',
        dimension: 'mass',
        category: 'ANTHROPOMETRY'
      })
    );

    varHeight = variableStore.create(
      createVariable({
        variable_id: 'VAR_BODY_HEIGHT',
        name: 'Body Height',
        description: 'Standing height in cm',
        datatype: 'NUMBER',
        unit: 'cm',
        dimension: 'length',
        category: 'ANTHROPOMETRY'
      })
    );

    varAge = variableStore.create(
      createVariable({
        variable_id: 'VAR_AGE',
        name: 'Age',
        description: 'Chronological age in years',
        datatype: 'INTEGER',
        unit: 's', // time dimension
        dimension: 'time',
        category: 'DEMOGRAPHIC'
      })
    );
  });

  describe('1. VariableMapping Contract Validator', () => {
    it('should validate a complete valid VariableMapping payload', () => {
      const validPayload: VariableMapping = {
        mapping_id: 'map-001',
        dataset_version_id: testVersion.version_id,
        source_column: 'BB',
        variable_id: varWeight.variable_id,
        mapping_method: 'MANUAL',
        status: 'CONFIRMED',
        column_metadata: {
          name: 'BB',
          datatype: 'NUMBER',
          unit: 'kg',
          description: 'Berat Badan'
        },
        created_at: new Date().toISOString(),
        created_by: 'user-01'
      };

      const res = VariableMappingValidator.validate(validPayload, { targetVariable: varWeight });
      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(() =>
        VariableMappingValidator.assertValid(validPayload, { targetVariable: varWeight })
      ).not.toThrow();
    });

    it('should reject non-object or null input', () => {
      const resNull = VariableMappingValidator.validate(null);
      expect(resNull.isValid).toBe(false);
      expect(resNull.errors[0]).toContain('non-null object');

      const resStr = VariableMappingValidator.validate('invalid-mapping');
      expect(resStr.isValid).toBe(false);
    });

    it('should reject empty mapping_id', () => {
      const invalid = {
        mapping_id: '',
        dataset_version_id: testVersion.version_id,
        source_column: 'BB',
        variable_id: varWeight.variable_id,
        mapping_method: 'MANUAL',
        status: 'CONFIRMED',
        created_by: 'user-01',
        created_at: new Date().toISOString()
      };
      const res = VariableMappingValidator.validate(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes('mapping_id'))).toBe(true);
      expect(() => VariableMappingValidator.assertValid(invalid)).toThrowError(ScientificVariableMappingError);
    });

    it('should reject empty dataset_version_id', () => {
      const invalid = {
        mapping_id: 'map-01',
        dataset_version_id: '  ',
        source_column: 'BB',
        variable_id: varWeight.variable_id,
        mapping_method: 'MANUAL',
        status: 'CONFIRMED',
        created_by: 'user-01',
        created_at: new Date().toISOString()
      };
      const res = VariableMappingValidator.validate(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes('dataset_version_id'))).toBe(true);
    });

    it('should reject empty source_column', () => {
      const invalid = {
        mapping_id: 'map-01',
        dataset_version_id: testVersion.version_id,
        source_column: '',
        variable_id: varWeight.variable_id,
        mapping_method: 'MANUAL',
        status: 'CONFIRMED',
        created_by: 'user-01',
        created_at: new Date().toISOString()
      };
      const res = VariableMappingValidator.validate(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes('source_column'))).toBe(true);
    });

    it('should reject empty variable_id', () => {
      const invalid = {
        mapping_id: 'map-01',
        dataset_version_id: testVersion.version_id,
        source_column: 'BB',
        variable_id: '',
        mapping_method: 'MANUAL',
        status: 'CONFIRMED',
        created_by: 'user-01',
        created_at: new Date().toISOString()
      };
      const res = VariableMappingValidator.validate(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes('variable_id'))).toBe(true);
    });

    it('should validate all permitted mapping methods and reject invalid method', () => {
      for (const method of VALID_MAPPING_METHODS) {
        const payload = {
          mapping_id: `map-${method}`,
          dataset_version_id: testVersion.version_id,
          source_column: 'Col',
          variable_id: varWeight.variable_id,
          mapping_method: method,
          status: method === 'SUGGESTED' ? 'DRAFT' : 'CONFIRMED',
          created_by: 'user-01',
          created_at: new Date().toISOString()
        };
        expect(VariableMappingValidator.validate(payload).isValid).toBe(true);
      }

      const invalid = {
        mapping_id: 'map-bad-method',
        dataset_version_id: testVersion.version_id,
        source_column: 'Col',
        variable_id: varWeight.variable_id,
        mapping_method: 'MAGIC_AI_INFERENCE',
        status: 'CONFIRMED',
        created_by: 'user-01',
        created_at: new Date().toISOString()
      };
      expect(VariableMappingValidator.validate(invalid).isValid).toBe(false);
    });

    it('should validate all permitted statuses and reject invalid status', () => {
      for (const status of VALID_MAPPING_STATUSES) {
        const payload = {
          mapping_id: `map-${status}`,
          dataset_version_id: testVersion.version_id,
          source_column: 'Col',
          variable_id: varWeight.variable_id,
          mapping_method: 'MANUAL',
          status,
          created_by: 'user-01',
          created_at: new Date().toISOString()
        };
        expect(VariableMappingValidator.validate(payload).isValid).toBe(true);
      }

      const invalid = {
        mapping_id: 'map-bad-status',
        dataset_version_id: testVersion.version_id,
        source_column: 'Col',
        variable_id: varWeight.variable_id,
        mapping_method: 'MANUAL',
        status: 'UNKNOWN_STATUS',
        created_by: 'user-01',
        created_at: new Date().toISOString()
      };
      expect(VariableMappingValidator.validate(invalid).isValid).toBe(false);
    });

    it('should reject SUGGESTED method when paired with CONFIRMED status', () => {
      const suggestedConfirmed = {
        mapping_id: 'map-sugg-conf',
        dataset_version_id: testVersion.version_id,
        source_column: 'BB',
        variable_id: varWeight.variable_id,
        mapping_method: 'SUGGESTED',
        status: 'CONFIRMED',
        created_by: 'ai-system',
        created_at: new Date().toISOString()
      };

      const res = VariableMappingValidator.validate(suggestedConfirmed);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes('SUGGESTED mappings cannot have status "CONFIRMED"'))).toBe(true);
    });
  });

  describe('2. Unit & Datatype Compatibility', () => {
    it('should accept compatible units between column and variable', () => {
      const check = checkMappingUnitCompatibility('kg', 'kg', 'mass');
      expect(check.isCompatible).toBe(true);

      const checkGrams = checkMappingUnitCompatibility('g', 'kg', 'mass');
      expect(checkGrams.isCompatible).toBe(true); // Both are mass
    });

    it('should reject incompatible physical units/dimensions', () => {
      const check = checkMappingUnitCompatibility('cm', 'kg', 'mass');
      expect(check.isCompatible).toBe(false);
      expect(check.error).toContain('Incompatible');
    });

    it('should reject unknown column units', () => {
      const check = checkMappingUnitCompatibility('unknown_alien_unit', 'kg', 'mass');
      expect(check.isCompatible).toBe(false);
      expect(check.error).toContain('not recognized in the Scientific Unit Registry');
    });

    it('should accept compatible datatypes', () => {
      expect(checkMappingDatatypeCompatibility('NUMBER', 'NUMBER').isCompatible).toBe(true);
      expect(checkMappingDatatypeCompatibility('INTEGER', 'NUMBER').isCompatible).toBe(true);
      expect(checkMappingDatatypeCompatibility('STRING', 'CATEGORICAL').isCompatible).toBe(true);
    });

    it('should reject incompatible datatypes', () => {
      const checkStrNum = checkMappingDatatypeCompatibility('STRING', 'NUMBER');
      expect(checkStrNum.isCompatible).toBe(false);
      expect(checkStrNum.error).toContain('Incompatible datatype');

      const checkBoolNum = checkMappingDatatypeCompatibility('BOOLEAN', 'NUMBER');
      expect(checkBoolNum.isCompatible).toBe(false);
    });
  });

  describe('3. createVariableMapping Factory', () => {
    it('should construct, validate, and freeze a VariableMapping entity', () => {
      const mapping = createVariableMapping(
        {
          mapping_id: 'map-bb-weight',
          dataset_version_id: testVersion.version_id,
          source_column: 'BB',
          variable_id: varWeight.variable_id,
          mapping_method: 'MANUAL',
          column_metadata: {
            name: 'BB',
            datatype: 'NUMBER',
            unit: 'kg'
          },
          created_by: 'user-01'
        },
        { variableStore, versionStore }
      );

      expect(mapping.mapping_id).toBe('map-bb-weight');
      expect(mapping.status).toBe('CONFIRMED');
      expect(mapping.mapping_method).toBe('MANUAL');
      expect(Object.isFrozen(mapping)).toBe(true);
    });

    it('should reject mapping if target variable is not found in Variable Registry', () => {
      expect(() =>
        createVariableMapping(
          {
            mapping_id: 'map-missing-var',
            dataset_version_id: testVersion.version_id,
            source_column: 'Col',
            variable_id: 'NON_EXISTENT_VAR',
            mapping_method: 'MANUAL',
            created_by: 'user-01'
          },
          { variableStore, versionStore }
        )
      ).toThrowError(/MAPPING_VARIABLE_NOT_FOUND/);
    });

    it('should reject mapping if dataset_version_id is not found in DatasetVersionStore', () => {
      expect(() =>
        createVariableMapping(
          {
            mapping_id: 'map-missing-v',
            dataset_version_id: 'non-existent-version',
            source_column: 'Col',
            variable_id: varWeight.variable_id,
            mapping_method: 'MANUAL',
            created_by: 'user-01'
          },
          { variableStore, versionStore }
        )
      ).toThrowError(/MAPPING_DATASET_VERSION_NOT_FOUND/);
    });

    it('should reject mapping with incompatible unit during factory creation', () => {
      expect(() =>
        createVariableMapping(
          {
            mapping_id: 'map-incompat-unit',
            dataset_version_id: testVersion.version_id,
            source_column: 'TB',
            variable_id: varWeight.variable_id, // Weight (mass)
            mapping_method: 'MANUAL',
            column_metadata: {
              name: 'TB',
              unit: 'cm' // Length
            },
            created_by: 'user-01'
          },
          { variableStore, versionStore }
        )
      ).toThrowError(/MAPPING_INCOMPATIBLE_UNIT/);
    });
  });

  describe('4. VariableMappingStore & Conflict Rules', () => {
    it('should create and retrieve mappings by mapping_id', () => {
      const mapping = createVariableMapping({
        mapping_id: 'map-01',
        dataset_version_id: testVersion.version_id,
        source_column: 'BB',
        variable_id: varWeight.variable_id,
        mapping_method: 'MANUAL',
        created_by: 'user-01'
      });

      const stored = mappingStore.create(mapping);
      expect(stored.mapping_id).toBe('map-01');

      const fetched = mappingStore.get('map-01');
      expect(fetched).toBeDefined();
      expect(fetched?.source_column).toBe('BB');
      expect(fetched?.variable_id).toBe('VAR_BODY_WEIGHT');

      const missing = mappingStore.get('missing-map');
      expect(missing).toBeUndefined();
    });

    it('should reject exact duplicate mapping_id', () => {
      const mapping = createVariableMapping({
        mapping_id: 'map-01',
        dataset_version_id: testVersion.version_id,
        source_column: 'BB',
        variable_id: varWeight.variable_id,
        mapping_method: 'MANUAL',
        created_by: 'user-01'
      });

      mappingStore.create(mapping);
      expect(() => mappingStore.create(mapping)).toThrowError(/MAPPING_DUPLICATE_ENTRY/);
    });

    it('should reject duplicate CONFIRMED mapping for same column and variable in same dataset version', () => {
      mappingStore.create(
        createVariableMapping({
          mapping_id: 'map-01',
          dataset_version_id: testVersion.version_id,
          source_column: 'BB',
          variable_id: varWeight.variable_id,
          mapping_method: 'MANUAL',
          status: 'CONFIRMED',
          created_by: 'user-01'
        })
      );

      expect(() =>
        mappingStore.create(
          createVariableMapping({
            mapping_id: 'map-02',
            dataset_version_id: testVersion.version_id,
            source_column: 'BB',
            variable_id: varWeight.variable_id,
            mapping_method: 'IMPORTED',
            status: 'CONFIRMED',
            created_by: 'user-02'
          })
        )
      ).toThrowError(/MAPPING_DUPLICATE_ENTRY/);
    });

    it('should enforce 1 Source Column -> 1 Confirmed Variable conflict rule', () => {
      // BB is confirmed to BODY_WEIGHT
      mappingStore.create(
        createVariableMapping({
          mapping_id: 'map-bb-weight',
          dataset_version_id: testVersion.version_id,
          source_column: 'BB',
          variable_id: varWeight.variable_id,
          mapping_method: 'MANUAL',
          status: 'CONFIRMED',
          created_by: 'user-01'
        })
      );

      // Attempting to confirm BB to BODY_HEIGHT on same dataset version must be rejected
      expect(() =>
        mappingStore.create(
          createVariableMapping({
            mapping_id: 'map-bb-height',
            dataset_version_id: testVersion.version_id,
            source_column: 'BB',
            variable_id: varHeight.variable_id,
            mapping_method: 'MANUAL',
            status: 'CONFIRMED',
            created_by: 'user-01'
          })
        )
      ).toThrowError(/MAPPING_COLUMN_CONFLICT/);
    });

    it('should allow DRAFT or REJECTED mappings alongside CONFIRMED mappings for the same column', () => {
      mappingStore.create(
        createVariableMapping({
          mapping_id: 'map-bb-weight',
          dataset_version_id: testVersion.version_id,
          source_column: 'BB',
          variable_id: varWeight.variable_id,
          mapping_method: 'MANUAL',
          status: 'CONFIRMED',
          created_by: 'user-01'
        })
      );

      // Draft proposal for another variable is allowed as a non-active draft
      const draft = mappingStore.create(
        createVariableMapping({
          mapping_id: 'map-bb-other-draft',
          dataset_version_id: testVersion.version_id,
          source_column: 'BB',
          variable_id: varHeight.variable_id,
          mapping_method: 'SUGGESTED',
          status: 'DRAFT',
          created_by: 'suggestion-engine'
        })
      );

      expect(draft.status).toBe('DRAFT');
    });

    it('should reject status update to CONFIRMED if it causes column conflict', () => {
      mappingStore.create(
        createVariableMapping({
          mapping_id: 'map-confirmed-1',
          dataset_version_id: testVersion.version_id,
          source_column: 'BB',
          variable_id: varWeight.variable_id,
          status: 'CONFIRMED',
          mapping_method: 'MANUAL',
          created_by: 'user-01'
        })
      );

      mappingStore.create(
        createVariableMapping({
          mapping_id: 'map-draft-2',
          dataset_version_id: testVersion.version_id,
          source_column: 'BB',
          variable_id: varHeight.variable_id,
          status: 'DRAFT',
          mapping_method: 'MANUAL',
          created_by: 'user-01'
        })
      );

      expect(() => mappingStore.updateStatus('map-draft-2', 'CONFIRMED')).toThrowError(
        /MAPPING_COLUMN_CONFLICT/
      );
    });

    it('should support updating status and notes on existing mapping', () => {
      mappingStore.create(
        createVariableMapping({
          mapping_id: 'map-updatable',
          dataset_version_id: testVersion.version_id,
          source_column: 'TB',
          variable_id: varHeight.variable_id,
          status: 'DRAFT',
          mapping_method: 'MANUAL',
          created_by: 'user-01'
        })
      );

      const updated = mappingStore.updateStatus('map-updatable', 'CONFIRMED', {
        notes: 'Confirmed by primary investigator.'
      });

      expect(updated.status).toBe('CONFIRMED');
      expect(updated.notes).toBe('Confirmed by primary investigator.');
      expect(updated.mapping_id).toBe('map-updatable');
    });

    it('should reject updating non-existent mapping', () => {
      expect(() => mappingStore.updateStatus('non-existent', 'CONFIRMED')).toThrowError(/MAPPING_NOT_FOUND/);
    });

    it('should list and filter mappings by dataset_version_id, source_column, and variable_id', () => {
      mappingStore.create(
        createVariableMapping({
          mapping_id: 'm1',
          dataset_version_id: testVersion.version_id,
          source_column: 'BB',
          variable_id: varWeight.variable_id,
          mapping_method: 'MANUAL',
          status: 'CONFIRMED',
          created_by: 'user-01'
        })
      );

      mappingStore.create(
        createVariableMapping({
          mapping_id: 'm2',
          dataset_version_id: testVersion.version_id,
          source_column: 'TB',
          variable_id: varHeight.variable_id,
          mapping_method: 'MANUAL',
          status: 'CONFIRMED',
          created_by: 'user-01'
        })
      );

      mappingStore.create(
        createVariableMapping({
          mapping_id: 'm3',
          dataset_version_id: testVersion.version_id,
          source_column: 'Umur',
          variable_id: varAge.variable_id,
          mapping_method: 'MANUAL',
          status: 'DRAFT',
          created_by: 'user-02'
        })
      );

      const allForVersion = mappingStore.findByDatasetVersion(testVersion.version_id);
      expect(allForVersion).toHaveLength(3);

      const confirmedForVersion = mappingStore.findByDatasetVersion(testVersion.version_id, {
        status: 'CONFIRMED'
      });
      expect(confirmedForVersion).toHaveLength(2);

      const byCol = mappingStore.findBySourceColumn(testVersion.version_id, 'BB');
      expect(byCol).toHaveLength(1);
      expect(byCol[0].mapping_id).toBe('m1');

      const byVar = mappingStore.findByVariable(varWeight.variable_id);
      expect(byVar).toHaveLength(1);
    });
  });

  describe('5. Mapping Resolution Engine', () => {
    beforeEach(() => {
      mappingStore.create(
        createVariableMapping({
          mapping_id: 'map-res-bb',
          dataset_version_id: testVersion.version_id,
          source_column: 'BB',
          variable_id: varWeight.variable_id,
          mapping_method: 'MANUAL',
          status: 'CONFIRMED',
          created_by: 'user-01'
        })
      );

      mappingStore.create(
        createVariableMapping({
          mapping_id: 'map-res-tb',
          dataset_version_id: testVersion.version_id,
          source_column: 'TB',
          variable_id: varHeight.variable_id,
          mapping_method: 'MANUAL',
          status: 'CONFIRMED',
          created_by: 'user-01'
        })
      );

      mappingStore.create(
        createVariableMapping({
          mapping_id: 'map-res-draft',
          dataset_version_id: testVersion.version_id,
          source_column: 'Umur_Draft',
          variable_id: varAge.variable_id,
          mapping_method: 'SUGGESTED',
          status: 'DRAFT',
          created_by: 'ai-engine'
        })
      );
    });

    it('should resolve source_column to confirmed Variable entity', () => {
      const resolved = mappingStore.resolveColumnToVariable(testVersion.version_id, 'BB');
      expect(resolved).toBeDefined();
      expect(resolved?.variable_id).toBe('VAR_BODY_WEIGHT');
      expect(resolved?.unit).toBe('kg');
      expect(resolved?.dimension).toBe('mass');
    });

    it('should return undefined when resolving an unmapped or draft column', () => {
      const unmapped = mappingStore.resolveColumnToVariable(testVersion.version_id, 'UNMAPPED_COL');
      expect(unmapped).toBeUndefined();

      const draftOnly = mappingStore.resolveColumnToVariable(testVersion.version_id, 'Umur_Draft');
      expect(draftOnly).toBeUndefined();
    });

    it('should resolve Variable to source column', () => {
      const res = mappingStore.resolveVariableToColumn(testVersion.version_id, varWeight.variable_id);
      expect(res.source_columns).toEqual(['BB']);
      expect(res.primary_column).toBe('BB');
      expect(res.has_conflict).toBe(false);
    });

    it('should detect ambiguity if multiple columns map to the same variable in the same version', () => {
      // Add a second confirmed column mapping to BODY_WEIGHT (e.g. weight_alt)
      mappingStore.create(
        createVariableMapping({
          mapping_id: 'map-weight-alt',
          dataset_version_id: testVersion.version_id,
          source_column: 'weight_alt',
          variable_id: varWeight.variable_id,
          mapping_method: 'MANUAL',
          status: 'CONFIRMED',
          created_by: 'user-01'
        })
      );

      const res = mappingStore.resolveVariableToColumn(testVersion.version_id, varWeight.variable_id);
      expect(res.source_columns).toHaveLength(2);
      expect(res.source_columns).toContain('BB');
      expect(res.source_columns).toContain('weight_alt');
      expect(res.has_conflict).toBe(true);
      expect(res.message).toContain('Ambiguity detected');
    });
  });

  describe('6. Store Isolation, Clearing & Security', () => {
    it('should clear store upon clear() call', () => {
      mappingStore.create(
        createVariableMapping({
          mapping_id: 'map-clear-test',
          dataset_version_id: testVersion.version_id,
          source_column: 'BB',
          variable_id: varWeight.variable_id,
          mapping_method: 'MANUAL',
          created_by: 'user-01'
        })
      );

      expect(mappingStore.list()).toHaveLength(1);
      mappingStore.clear();
      expect(mappingStore.list()).toHaveLength(0);
      expect(mappingStore.get('map-clear-test')).toBeUndefined();
    });

    it('should isolate mutations outside the store via deep freeze', () => {
      mappingStore.create(
        createVariableMapping({
          mapping_id: 'map-immut',
          dataset_version_id: testVersion.version_id,
          source_column: 'BB',
          variable_id: varWeight.variable_id,
          mapping_method: 'MANUAL',
          created_by: 'user-01'
        })
      );

      const fetched = mappingStore.get('map-immut')!;
      expect(() => {
        (fetched as any).source_column = 'TAMPERED';
      }).toThrow();

      const secondFetch = mappingStore.get('map-immut')!;
      expect(secondFetch.source_column).toBe('BB');
    });
  });
});
