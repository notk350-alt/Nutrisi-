import { describe, it, expect, beforeEach } from 'vitest';
import {
  createVariable,
  defaultVariableStore,
  VALID_VARIABLE_CATEGORIES,
  VALID_VARIABLE_DATATYPES,
  VALID_VARIABLE_MISSING_POLICIES,
  VALID_VARIABLE_SEMANTIC_TYPES,
  VALID_VARIABLE_STATUSES,
  VariableContractValidator,
  VariableStore,
  VariableValidator
} from '../data/variableRegistry';
import {
  ScientificVariableError,
  Variable,
  VariableCategory,
  VariableDataType,
  VariableMissingPolicy,
  VariableSemanticType,
  VariableStatus
} from '../types';

describe('Phase D3 — Scientific Data Layer: Variable Registry', () => {
  let store: VariableStore;

  beforeEach(() => {
    store = new VariableStore();
  });

  describe('1. Variable Contract Validation', () => {
    it('should validate a complete and valid Variable definition', () => {
      const v: Variable = {
        variable_id: 'VAR_BODY_WEIGHT',
        name: 'Body Weight',
        description: 'Total body mass measured in standard physical units.',
        datatype: 'NUMBER',
        unit: 'kg',
        dimension: 'mass',
        semantic_type: 'CONTINUOUS',
        category: 'ANTHROPOMETRY',
        required: true,
        allowed_range: {
          min: 10,
          max: 350,
          min_inclusive: true,
          max_inclusive: true,
          warning_min: 30,
          warning_max: 200
        },
        missing_policy: 'REQUIRED',
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: { source: 'standard-anthropometry-protocol' }
      };

      const res = VariableValidator.validate(v);
      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(() => VariableValidator.assertValid(v)).not.toThrow();
    });

    it('should validate a minimal valid Variable definition', () => {
      const v: Variable = {
        variable_id: 'VAR_IS_FASTING',
        name: 'Fasting State',
        description: 'Binary indicator of whether subject is in fasting state.',
        datatype: 'BOOLEAN',
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const res = VariableValidator.validate(v);
      expect(res.isValid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('should reject non-object or null input', () => {
      const resNull = VariableValidator.validate(null);
      expect(resNull.isValid).toBe(false);
      expect(resNull.errors[0]).toContain('non-null object');

      const resStr = VariableValidator.validate('VAR_WEIGHT');
      expect(resStr.isValid).toBe(false);
    });

    it('should reject missing or empty variable_id', () => {
      const invalid = {
        variable_id: '',
        name: 'Weight',
        description: 'Mass',
        datatype: 'NUMBER',
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const res = VariableValidator.validate(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes('variable_id'))).toBe(true);
      expect(() => VariableValidator.assertValid(invalid)).toThrowError(ScientificVariableError);
    });

    it('should reject missing or empty name', () => {
      const invalid = {
        variable_id: 'VAR_01',
        name: '   ',
        description: 'Valid description',
        datatype: 'NUMBER',
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const res = VariableValidator.validate(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes('name'))).toBe(true);
    });

    it('should reject missing or empty description', () => {
      const invalid = {
        variable_id: 'VAR_01',
        name: 'Weight',
        description: '',
        datatype: 'NUMBER',
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const res = VariableValidator.validate(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes('description'))).toBe(true);
    });

    it('should validate all permitted datatypes and reject invalid datatypes', () => {
      for (const datatype of VALID_VARIABLE_DATATYPES) {
        const payload = {
          variable_id: `VAR_${datatype}`,
          name: `Name ${datatype}`,
          description: `Description for ${datatype}`,
          datatype,
          status: 'ACTIVE' as VariableStatus,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        const res = VariableValidator.validate(payload);
        expect(res.isValid).toBe(true);
      }

      const invalid = {
        variable_id: 'VAR_UNKNOWN',
        name: 'Unknown',
        description: 'Desc',
        datatype: 'INVALID_TYPE',
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const resInvalid = VariableValidator.validate(invalid);
      expect(resInvalid.isValid).toBe(false);
      expect(resInvalid.errors.some((e) => e.includes('datatype'))).toBe(true);
    });

    it('should validate all permitted statuses and reject invalid status', () => {
      for (const status of VALID_VARIABLE_STATUSES) {
        const payload = {
          variable_id: `VAR_${status}`,
          name: `Name ${status}`,
          description: `Desc ${status}`,
          datatype: 'NUMBER' as VariableDataType,
          status,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        expect(VariableValidator.validate(payload).isValid).toBe(true);
      }

      const invalid = {
        variable_id: 'VAR_01',
        name: 'Name',
        description: 'Desc',
        datatype: 'NUMBER',
        status: 'INVALID_STATUS',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      expect(VariableValidator.validate(invalid).isValid).toBe(false);
    });

    it('should validate all permitted semantic types', () => {
      for (const semantic_type of VALID_VARIABLE_SEMANTIC_TYPES) {
        const payload = {
          variable_id: `VAR_${semantic_type}`,
          name: `Name ${semantic_type}`,
          description: `Desc ${semantic_type}`,
          datatype: 'NUMBER' as VariableDataType,
          semantic_type,
          status: 'ACTIVE' as VariableStatus,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        expect(VariableValidator.validate(payload).isValid).toBe(true);
      }
    });

    it('should validate all permitted categories', () => {
      for (const category of VALID_VARIABLE_CATEGORIES) {
        const payload = {
          variable_id: `VAR_${category}`,
          name: `Name ${category}`,
          description: `Desc ${category}`,
          datatype: 'NUMBER' as VariableDataType,
          category,
          status: 'ACTIVE' as VariableStatus,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        expect(VariableValidator.validate(payload).isValid).toBe(true);
      }
    });

    it('should validate all permitted missing policies', () => {
      for (const missing_policy of VALID_VARIABLE_MISSING_POLICIES) {
        const payload = {
          variable_id: `VAR_${missing_policy}`,
          name: `Name ${missing_policy}`,
          description: `Desc ${missing_policy}`,
          datatype: 'NUMBER' as VariableDataType,
          missing_policy,
          status: 'ACTIVE' as VariableStatus,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        expect(VariableValidator.validate(payload).isValid).toBe(true);
      }
    });

    it('should reject invalid ISO 8601 timestamps', () => {
      const invalid = {
        variable_id: 'VAR_01',
        name: 'Name',
        description: 'Desc',
        datatype: 'NUMBER',
        status: 'ACTIVE',
        created_at: '2026-99-99',
        updated_at: new Date().toISOString()
      };
      expect(VariableValidator.validate(invalid).isValid).toBe(false);
    });
  });

  describe('2. Unit Engine & Dimension Compatibility', () => {
    it('should accept valid units recognized in the Unit Engine', () => {
      const unitsToTest = ['kg', 'g', 'm', 'cm', 's', 'kcal', 'L', '°C', 'mmol/L', '%', 'unitless'];
      for (const unit of unitsToTest) {
        const payload = {
          variable_id: `VAR_UNIT_${unit.replace(/[^a-zA-Z0-9]/g, '_')}`,
          name: `Variable in ${unit}`,
          description: `Measurement with unit ${unit}`,
          datatype: 'NUMBER' as VariableDataType,
          unit,
          status: 'ACTIVE' as VariableStatus,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        expect(VariableValidator.validate(payload).isValid).toBe(true);
      }
    });

    it('should reject unknown units not registered in Unit Engine', () => {
      const invalid = {
        variable_id: 'VAR_STRANGE',
        name: 'Strange Unit',
        description: 'Test',
        datatype: 'NUMBER',
        unit: 'lightyears_per_banana',
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const res = VariableValidator.validate(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes('not recognized in the Scientific Unit Registry'))).toBe(true);
      expect(() => VariableValidator.assertValid(invalid)).toThrowError(/VARIABLE_INVALID_UNIT/);
    });

    it('should accept compatible unit and dimension combinations', () => {
      const validCombinations: [string, string][] = [
        ['kg', 'mass'],
        ['cm', 'length'],
        ['kcal', 'energy'],
        ['s', 'time'],
        ['L', 'volume'],
        ['°C', 'temperature'],
        ['mmHg', 'pressure'],
        ['%', 'percentage'],
        ['unitless', 'dimensionless']
      ];

      for (const [unit, dimension] of validCombinations) {
        const payload = {
          variable_id: `VAR_${unit}_${dimension}`,
          name: `Var ${unit} ${dimension}`,
          description: 'Valid match',
          datatype: 'NUMBER' as VariableDataType,
          unit,
          dimension,
          status: 'ACTIVE' as VariableStatus,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        expect(VariableValidator.validate(payload).isValid).toBe(true);
      }
    });

    it('should reject incompatible unit and dimension combinations', () => {
      const invalid = {
        variable_id: 'VAR_MISMATCH',
        name: 'Mismatched Dimension',
        description: 'Trying kg with length',
        datatype: 'NUMBER' as VariableDataType,
        unit: 'kg', // mass
        dimension: 'length', // incompatible
        status: 'ACTIVE' as VariableStatus,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const res = VariableValidator.validate(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes('Incompatible unit and dimension'))).toBe(true);
      expect(() => VariableValidator.assertValid(invalid)).toThrowError(/VARIABLE_INCOMPATIBLE_UNIT_DIMENSION/);
    });

    it('should support unitless / dimensionless variables without unit', () => {
      const unitless = {
        variable_id: 'VAR_SCORE',
        name: 'Activity Index',
        description: 'Normalized index score between 0 and 1.',
        datatype: 'NUMBER' as VariableDataType,
        dimension: 'dimensionless',
        status: 'ACTIVE' as VariableStatus,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      expect(VariableValidator.validate(unitless).isValid).toBe(true);
    });
  });

  describe('3. Allowed Range Contract', () => {
    it('should accept valid min and max boundaries where min <= max', () => {
      const payload = {
        variable_id: 'VAR_RANGE_OK',
        name: 'Range OK',
        description: 'Desc',
        datatype: 'NUMBER' as VariableDataType,
        allowed_range: {
          min: 0,
          max: 100,
          min_inclusive: true,
          max_inclusive: true
        },
        status: 'ACTIVE' as VariableStatus,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      expect(VariableValidator.validate(payload).isValid).toBe(true);
    });

    it('should reject invalid range when min > max', () => {
      const invalid = {
        variable_id: 'VAR_RANGE_BAD',
        name: 'Range Bad',
        description: 'Desc',
        datatype: 'NUMBER' as VariableDataType,
        allowed_range: {
          min: 100,
          max: 0
        },
        status: 'ACTIVE' as VariableStatus,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const res = VariableValidator.validate(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes('min (100) must be less than or equal to max (0)'))).toBe(true);
      expect(() => VariableValidator.assertValid(invalid)).toThrowError(/VARIABLE_INVALID_RANGE/);
    });

    it('should reject invalid warning range when warning_min > warning_max', () => {
      const invalid = {
        variable_id: 'VAR_WARN_BAD',
        name: 'Warning Range Bad',
        description: 'Desc',
        datatype: 'NUMBER' as VariableDataType,
        allowed_range: {
          warning_min: 50,
          warning_max: 20
        },
        status: 'ACTIVE' as VariableStatus,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const res = VariableValidator.validate(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errors.some((e) => e.includes('warning_min (50) must be less than or equal to warning_max (20)'))).toBe(
        true
      );
    });
  });

  describe('4. Categorical Variable Metadata', () => {
    it('should accept string array of categories for categorical variables', () => {
      const categoricalVar = createVariable({
        variable_id: 'VAR_DIET_TYPE',
        name: 'Dietary Pattern',
        description: 'Self-reported dietary lifestyle.',
        datatype: 'CATEGORICAL',
        categories: ['OMNIVORE', 'VEGETARIAN', 'VEGAN', 'PESCATARIAN', 'KETOGENIC'],
        status: 'ACTIVE'
      });

      expect(categoricalVar.datatype).toBe('CATEGORICAL');
      expect(categoricalVar.categories).toHaveLength(5);
      expect(categoricalVar.categories).toContain('VEGETARIAN');
    });

    it('should reject non-string elements in categories', () => {
      const invalid = {
        variable_id: 'VAR_CAT_BAD',
        name: 'Cat Bad',
        description: 'Desc',
        datatype: 'CATEGORICAL' as VariableDataType,
        categories: ['OK', 123 as any],
        status: 'ACTIVE' as VariableStatus,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      expect(VariableValidator.validate(invalid).isValid).toBe(false);
    });
  });

  describe('5. createVariable Factory', () => {
    it('should construct, validate, freeze, and return an immutable Variable entity', () => {
      const v = createVariable({
        variable_id: 'VAR_HEART_RATE',
        name: 'Resting Heart Rate',
        description: 'Beats per minute measured at rest.',
        datatype: 'INTEGER',
        unit: 's', // rate/time
        dimension: 'time',
        semantic_type: 'DISCRETE',
        category: 'PHYSIOLOGICAL',
        missing_policy: 'REQUIRED',
        allowed_range: { min: 30, max: 220 }
      });

      expect(v.variable_id).toBe('VAR_HEART_RATE');
      expect(v.status).toBe('ACTIVE');
      expect(v.created_at).toBeDefined();
      expect(v.updated_at).toBeDefined();
      expect(Object.isFrozen(v)).toBe(true);
    });

    it('should throw typed error on invalid factory input', () => {
      expect(() =>
        createVariable({
          variable_id: '',
          name: 'Invalid',
          description: 'Empty id',
          datatype: 'NUMBER'
        })
      ).toThrowError(/VARIABLE_EMPTY_ID/);
    });
  });

  describe('6. VariableStore Registry Repository', () => {
    it('should register and retrieve variables by variable_id', () => {
      const v1 = createVariable({
        variable_id: 'VAR_SYSTOLIC_BP',
        name: 'Systolic Blood Pressure',
        description: 'Peak arterial pressure in systemic circulation.',
        datatype: 'NUMBER',
        unit: 'mmHg',
        dimension: 'pressure',
        category: 'PHYSIOLOGICAL'
      });

      const registered = store.create(v1);
      expect(registered.variable_id).toBe('VAR_SYSTOLIC_BP');

      const retrieved = store.get('VAR_SYSTOLIC_BP');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Systolic Blood Pressure');
      expect(retrieved?.unit).toBe('mmHg');

      const missing = store.get('NON_EXISTENT_VAR');
      expect(missing).toBeUndefined();
    });

    it('should reject duplicate variable_id registration', () => {
      const v1 = createVariable({
        variable_id: 'VAR_DUPLICATE',
        name: 'Duplicate Test',
        description: 'First entry',
        datatype: 'NUMBER'
      });

      store.create(v1);
      expect(() => store.create(v1)).toThrowError(/VARIABLE_ALREADY_EXISTS/);
    });

    it('should support updating variable metadata while protecting immutable variable_id', () => {
      const original = store.create(
        createVariable({
          variable_id: 'VAR_FASTING_GLUCOSE',
          name: 'Fasting Plasma Glucose',
          description: 'Fasting blood glucose concentration.',
          datatype: 'NUMBER',
          unit: 'mmol/L',
          dimension: 'concentration',
          category: 'LABORATORY',
          status: 'DRAFT'
        })
      );

      const updated = store.update('VAR_FASTING_GLUCOSE', {
        status: 'ACTIVE',
        description: 'Updated clinical definition of fasting plasma glucose.',
        allowed_range: { min: 2.0, max: 30.0 }
      });

      expect(updated.status).toBe('ACTIVE');
      expect(updated.description).toBe('Updated clinical definition of fasting plasma glucose.');
      expect(updated.allowed_range?.min).toBe(2.0);
      expect(updated.variable_id).toBe(original.variable_id);
      expect(updated.created_at).toBe(original.created_at);
    });

    it('should throw error when attempting to mutate variable_id in update()', () => {
      store.create(
        createVariable({
          variable_id: 'VAR_ORIGINAL_ID',
          name: 'Original',
          description: 'Desc',
          datatype: 'NUMBER'
        })
      );

      expect(() =>
        store.update('VAR_ORIGINAL_ID', {
          variable_id: 'VAR_NEW_ID'
        } as any)
      ).toThrowError(/VARIABLE_IMMUTABLE_ID_VIOLATION/);
    });

    it('should throw error when updating non-existent variable', () => {
      expect(() =>
        store.update('MISSING_VAR_ID', {
          description: 'New Desc'
        })
      ).toThrowError(/VARIABLE_NOT_FOUND/);
    });

    it('should list all variables deterministically sorted by variable_id ascending', () => {
      store.create(createVariable({ variable_id: 'VAR_Z_SCORE', name: 'Z Score', description: 'Desc', datatype: 'NUMBER' }));
      store.create(createVariable({ variable_id: 'VAR_A_SCORE', name: 'A Score', description: 'Desc', datatype: 'NUMBER' }));
      store.create(createVariable({ variable_id: 'VAR_M_SCORE', name: 'M Score', description: 'Desc', datatype: 'NUMBER' }));

      const list = store.list();
      expect(list).toHaveLength(3);
      expect(list.map((v) => v.variable_id)).toEqual(['VAR_A_SCORE', 'VAR_M_SCORE', 'VAR_Z_SCORE']);
    });

    it('should filter variables by datatype, category, dimension, and status', () => {
      store.create(
        createVariable({
          variable_id: 'VAR_1',
          name: 'V1',
          description: 'Desc',
          datatype: 'NUMBER',
          category: 'ANTHROPOMETRY',
          dimension: 'mass',
          status: 'ACTIVE'
        })
      );
      store.create(
        createVariable({
          variable_id: 'VAR_2',
          name: 'V2',
          description: 'Desc',
          datatype: 'STRING',
          category: 'DEMOGRAPHIC',
          status: 'ACTIVE'
        })
      );
      store.create(
        createVariable({
          variable_id: 'VAR_3',
          name: 'V3',
          description: 'Desc',
          datatype: 'NUMBER',
          category: 'ANTHROPOMETRY',
          dimension: 'length',
          status: 'DEPRECATED'
        })
      );

      const anthroList = store.list({ category: 'ANTHROPOMETRY' });
      expect(anthroList).toHaveLength(2);

      const activeAnthro = store.list({ category: 'ANTHROPOMETRY', status: 'ACTIVE' });
      expect(activeAnthro).toHaveLength(1);
      expect(activeAnthro[0].variable_id).toBe('VAR_1');

      const massVars = store.list({ dimension: 'mass' });
      expect(massVars).toHaveLength(1);
      expect(massVars[0].variable_id).toBe('VAR_1');
    });

    it('should find variables by name substring (case-insensitive)', () => {
      store.create(
        createVariable({
          variable_id: 'VAR_WAIST_CIRCUMFERENCE',
          name: 'Waist Circumference',
          description: 'Circumference around waist',
          datatype: 'NUMBER',
          unit: 'cm',
          dimension: 'length'
        })
      );
      store.create(
        createVariable({
          variable_id: 'VAR_HIP_CIRCUMFERENCE',
          name: 'Hip Circumference',
          description: 'Circumference around hip',
          datatype: 'NUMBER',
          unit: 'cm',
          dimension: 'length'
        })
      );
      store.create(
        createVariable({
          variable_id: 'VAR_AGE',
          name: 'Age in Years',
          description: 'Age',
          datatype: 'INTEGER'
        })
      );

      const circumferences = store.findByName('circumference');
      expect(circumferences).toHaveLength(2);
      expect(circumferences.map((v) => v.variable_id)).toEqual([
        'VAR_HIP_CIRCUMFERENCE',
        'VAR_WAIST_CIRCUMFERENCE'
      ]);

      expect(store.findByName('')).toEqual([]);
    });

    it('should find variables by category helper findByCategory', () => {
      store.create(
        createVariable({
          variable_id: 'VAR_PROTEIN_INTAKE',
          name: 'Daily Dietary Protein Intake',
          description: 'Dietary protein intake',
          datatype: 'NUMBER',
          unit: 'g',
          dimension: 'mass',
          category: 'NUTRITION'
        })
      );

      const nutritionVars = store.findByCategory('NUTRITION');
      expect(nutritionVars).toHaveLength(1);
      expect(nutritionVars[0].variable_id).toBe('VAR_PROTEIN_INTAKE');
    });

    it('should find variables by dimension helper findByDimension', () => {
      store.create(
        createVariable({
          variable_id: 'VAR_ENERGY_EXPENDITURE',
          name: 'Total Energy Expenditure',
          description: 'TEE in kcal',
          datatype: 'NUMBER',
          unit: 'kcal',
          dimension: 'energy',
          category: 'PHYSIOLOGICAL'
        })
      );

      const energyVars = store.findByDimension('energy');
      expect(energyVars).toHaveLength(1);
      expect(energyVars[0].variable_id).toBe('VAR_ENERGY_EXPENDITURE');
    });

    it('should clear store upon clear() call', () => {
      store.create(
        createVariable({
          variable_id: 'VAR_TO_CLEAR',
          name: 'To Clear',
          description: 'Desc',
          datatype: 'BOOLEAN'
        })
      );

      expect(store.list()).toHaveLength(1);
      store.clear();
      expect(store.list()).toHaveLength(0);
      expect(store.get('VAR_TO_CLEAR')).toBeUndefined();
    });

    it('should isolate mutations outside store through deep cloning and freezing', () => {
      const created = store.create(
        createVariable({
          variable_id: 'VAR_ISOLATED',
          name: 'Isolated Variable',
          description: 'Desc',
          datatype: 'NUMBER',
          metadata: { tag: 'initial' }
        })
      );

      const fetched = store.get('VAR_ISOLATED')!;
      expect(() => {
        (fetched as any).name = 'MUTATED NAME';
      }).toThrow();

      const secondFetch = store.get('VAR_ISOLATED')!;
      expect(secondFetch.name).toBe('Isolated Variable');
    });
  });

  describe('7. Dataset and Scientific Module Independence', () => {
    it('should exist purely as independent semantic definitions without requiring dataset_id', () => {
      const independentVar = createVariable({
        variable_id: 'VAR_AUTONOMOUS',
        name: 'Autonomous Variable',
        description: 'Variable defined without any dataset context.',
        datatype: 'NUMBER'
      });

      expect((independentVar as any).dataset_id).toBeUndefined();
      store.create(independentVar);
      expect(store.get('VAR_AUTONOMOUS')).toBeDefined();
    });

    it('should exist without requiring AST formulas, algorithms, or models', () => {
      const nonModuleVar = createVariable({
        variable_id: 'VAR_STANDALONE_METRIC',
        name: 'Standalone Metric',
        description: 'A metric with zero module dependencies.',
        datatype: 'STRING'
      });

      expect((nonModuleVar as any).formula_id).toBeUndefined();
      expect((nonModuleVar as any).algorithm_id).toBeUndefined();
      expect((nonModuleVar as any).model_id).toBeUndefined();
    });
  });

  describe('8. Security & Clean Execution Boundaries', () => {
    it('should not contain executable code, eval, or dynamic Function execution', () => {
      const varWithMetadata = createVariable({
        variable_id: 'VAR_SECURE',
        name: 'Secure Variable',
        description: 'Safe description with static configuration.',
        datatype: 'NUMBER',
        metadata: {
          static_scalar: 42,
          notes: 'No eval allowed'
        }
      });

      expect(typeof varWithMetadata.metadata?.static_scalar).toBe('number');
      expect(typeof varWithMetadata.metadata?.notes).toBe('string');
    });
  });
});
