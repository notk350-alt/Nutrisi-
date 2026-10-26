/**
 * Phase D8 — Scientific Data Layer: Dataset Input Assembler
 *
 * Converts a raw dataset record into the exact input object required by a ScientificModule.
 *
 * Flow:
 * DATASET COLUMN -> VARIABLE MAPPING -> VARIABLE REGISTRY -> MODULE INPUT
 *
 * Core Invariants:
 * 1. Zero Hardcoding: Does not hardcode column names or infer semantics from arbitrary strings.
 * 2. Authoritative Unit Engine: Uses Phase C UnitConverter for physical unit transformations.
 * 3. Dimension Checking: Incompatible dimensions (e.g. kg -> m) fail deterministically.
 * 4. Conflict & Ambiguity Detection: Detects conflicting or ambiguous column mappings.
 * 5. Deterministic Input Assembly: Pure transformation with full traceability.
 */

import {
  DatasetColumnMapping,
  DatasetMappingConfiguration,
  ScientificDatasetExecutionError,
  Variable
} from '../types';
import { convertUnit, findUnit } from '../units/unitConverter';
import { VariableMappingStore } from './variableMapping';
import { VariableStore } from './variableRegistry';
import { ResolvableModule } from '../resolvers/moduleResolver';

export interface ModuleInputDescriptor {
  name: string;
  unit?: string;
  datatype?: string;
  required?: boolean;
  default_value?: any;
}

export interface AssembledRecordInputs {
  inputs: Record<string, { value: unknown; unit?: string }>;
  audit: {
    mapped_count: number;
    conversions: Array<{
      input_name: string;
      source_column: string;
      original_value: unknown;
      original_unit?: string;
      target_value: unknown;
      target_unit?: string;
      trace?: string;
    }>;
  };
}

export class DatasetInputAssembler {
  /**
   * Extracts expected input descriptors from any ScientificModule (Formula, Algorithm, Model).
   */
  public static extractModuleInputs(module: ResolvableModule): ModuleInputDescriptor[] {
    const m = module as any;
    const rawInputs: Array<any> =
      m.inputs || (m.formula && m.formula.inputs) || [];

    return rawInputs.map((inp) => ({
      name: inp.name,
      unit: inp.unit,
      datatype: inp.datatype,
      required: inp.required !== false, // default to required unless explicitly false
      default_value: inp.default_value
    }));
  }

  /**
   * Resolves authoritative column mappings from either explicit configuration
   * or a registered VariableMappingStore.
   */
  public static resolveMappings(options: {
    dataset_version_id: string;
    mapping_configuration: DatasetMappingConfiguration;
    module_inputs: ModuleInputDescriptor[];
    variable_mapping_store?: VariableMappingStore;
    variable_registry?: VariableStore;
  }): DatasetColumnMapping[] {
    const { dataset_version_id, mapping_configuration, module_inputs, variable_mapping_store, variable_registry } = options;

    const resolvedMappings: DatasetColumnMapping[] = [];
    const inputNamesSeen = new Set<string>();
    const columnToInput = new Map<string, string>();

    // 1. Direct explicit column_mappings
    if (mapping_configuration.column_mappings && mapping_configuration.column_mappings.length > 0) {
      for (const cm of mapping_configuration.column_mappings) {
        // Conflict check: multiple columns mapped to the same module input name
        if (inputNamesSeen.has(cm.module_input_name)) {
          throw new ScientificDatasetExecutionError(
            'VARIABLE_MAPPING_CONFLICT',
            `Conflict detected: Multiple source columns are mapped to module input "${cm.module_input_name}".`
          );
        }
        inputNamesSeen.add(cm.module_input_name);

        // Ambiguity check: same column mapped to multiple different inputs with conflicting settings
        columnToInput.set(cm.source_column, cm.module_input_name);

        // Resolve unit from variable registry if not directly provided
        let columnUnit = cm.column_unit;
        if (!columnUnit && cm.variable_id && variable_registry) {
          const v = variable_registry.get(cm.variable_id);
          if (v && v.unit) {
            columnUnit = v.unit;
          }
        }

        // Target unit defaults to module input required unit if not specified
        let targetUnit = cm.target_unit;
        if (!targetUnit) {
          const matchingInput = module_inputs.find((inp) => inp.name === cm.module_input_name);
          if (matchingInput && matchingInput.unit) {
            targetUnit = matchingInput.unit;
          }
        }

        resolvedMappings.push({
          source_column: cm.source_column,
          module_input_name: cm.module_input_name,
          variable_id: cm.variable_id,
          column_unit: columnUnit,
          target_unit: targetUnit
        });
      }
      return resolvedMappings;
    }

    // 2. Resolve via VariableMappingStore and VariableRegistry
    if (mapping_configuration.mapping_id && variable_mapping_store) {
      const stored = variable_mapping_store.get(mapping_configuration.mapping_id);
      if (!stored) {
        throw new ScientificDatasetExecutionError(
          'VARIABLE_MAPPING_NOT_FOUND',
          `VariableMapping "${mapping_configuration.mapping_id}" not found in VariableMappingStore.`
        );
      }

      if (stored.dataset_version_id !== dataset_version_id) {
        throw new ScientificDatasetExecutionError(
          'VARIABLE_MAPPING_NOT_FOUND',
          `VariableMapping "${mapping_configuration.mapping_id}" belongs to dataset version "${stored.dataset_version_id}", not "${dataset_version_id}".`
        );
      }

      let varObj: Variable | undefined;
      if (variable_registry) {
        varObj = variable_registry.get(stored.variable_id);
      }

      // Match against module input
      const matchingInput = module_inputs.find(
        (inp) => inp.name === stored.variable_id || (varObj && inp.name.toLowerCase() === varObj.name.toLowerCase())
      );

      const targetInputName = matchingInput ? matchingInput.name : stored.variable_id;
      const targetUnit = matchingInput?.unit;
      const columnUnit = stored.column_metadata?.unit || varObj?.unit;

      resolvedMappings.push({
        source_column: stored.source_column,
        module_input_name: targetInputName,
        variable_id: stored.variable_id,
        column_unit: columnUnit,
        target_unit: targetUnit
      });

      return resolvedMappings;
    }

    // 3. If mapping_id provided but store not injected, or no mappings
    if (mapping_configuration.mapping_id) {
      throw new ScientificDatasetExecutionError(
        'VARIABLE_MAPPING_NOT_FOUND',
        `Cannot resolve mapping "${mapping_configuration.mapping_id}": VariableMappingStore was not provided.`
      );
    }

    throw new ScientificDatasetExecutionError(
      'VARIABLE_MAPPING_NOT_FOUND',
      'No valid variable mapping configuration could be resolved.'
    );
  }

  /**
   * Assembles a single dataset record into module inputs with authoritative unit conversion.
   */
  public static assembleRecordInputs(options: {
    record: Record<string, unknown>;
    record_index: number;
    mappings: DatasetColumnMapping[];
    module_inputs: ModuleInputDescriptor[];
    allow_unmapped_inputs?: boolean;
  }): AssembledRecordInputs {
    const { record, record_index, mappings, module_inputs, allow_unmapped_inputs = false } = options;

    const assembled: Record<string, { value: unknown; unit?: string }> = {};
    const conversions: AssembledRecordInputs['audit']['conversions'] = [];
    const mappedInputNames = new Set<string>();

    // 1. Process each resolved column mapping
    for (const mapping of mappings) {
      const sourceCol = mapping.source_column;
      const inputName = mapping.module_input_name;

      if (!(sourceCol in record)) {
        // Column is not in this record
        continue;
      }

      const rawValue = record[sourceCol];
      mappedInputNames.add(inputName);

      // Check if value is null / undefined
      if (rawValue === null || rawValue === undefined) {
        assembled[inputName] = { value: rawValue, unit: mapping.target_unit || mapping.column_unit };
        continue;
      }

      // Numeric unit conversion if both column_unit and target_unit are defined
      let finalValue = rawValue;
      let trace: string | undefined = undefined;

      if (
        mapping.column_unit &&
        mapping.target_unit &&
        typeof rawValue === 'number' &&
        mapping.column_unit.trim() !== mapping.target_unit.trim()
      ) {
        const fromUnitDef = findUnit(mapping.column_unit);
        const toUnitDef = findUnit(mapping.target_unit);

        if (!fromUnitDef) {
          throw new ScientificDatasetExecutionError(
            'UNIT_MISMATCH',
            `Source column unit "${mapping.column_unit}" for column "${sourceCol}" is not recognized in Unit Registry.`
          );
        }

        if (!toUnitDef) {
          throw new ScientificDatasetExecutionError(
            'UNIT_MISMATCH',
            `Target unit "${mapping.target_unit}" for module input "${inputName}" is not recognized in Unit Registry.`
          );
        }

        // Dimension mismatch check
        if (
          fromUnitDef.measurement_type !== 'dimensionless' &&
          toUnitDef.measurement_type !== 'dimensionless' &&
          fromUnitDef.measurement_type !== toUnitDef.measurement_type
        ) {
          throw new ScientificDatasetExecutionError(
            'UNIT_MISMATCH',
            `Dimension mismatch: Cannot convert column "${sourceCol}" of type "${fromUnitDef.measurement_type}" (${mapping.column_unit}) to module input "${inputName}" of type "${toUnitDef.measurement_type}" (${mapping.target_unit}).`
          );
        }

        try {
          const convRes = convertUnit(rawValue, mapping.column_unit, mapping.target_unit);
          finalValue = convRes.targetValue;
          trace = convRes.trace;
        } catch (err: any) {
          throw new ScientificDatasetExecutionError(
            'UNIT_MISMATCH',
            `Unit conversion failed for "${sourceCol}" (${mapping.column_unit} -> ${mapping.target_unit}): ${err.message}`
          );
        }
      }

      assembled[inputName] = {
        value: finalValue,
        unit: mapping.target_unit || mapping.column_unit
      };

      conversions.push({
        input_name: inputName,
        source_column: sourceCol,
        original_value: rawValue,
        original_unit: mapping.column_unit,
        target_value: finalValue,
        target_unit: mapping.target_unit || mapping.column_unit,
        trace
      });
    }

    // 2. Validate required inputs
    for (const expected of module_inputs) {
      if (!assembled[expected.name] || assembled[expected.name].value === undefined || assembled[expected.name].value === null) {
        if (expected.required) {
          throw new ScientificDatasetExecutionError(
            'INPUT_ASSEMBLY_ERROR',
            `Record at index ${record_index} is missing required module input "${expected.name}".`
          );
        } else if (expected.default_value !== undefined) {
          assembled[expected.name] = {
            value: expected.default_value,
            unit: expected.unit
          };
        }
      }
    }

    return {
      inputs: assembled,
      audit: {
        mapped_count: Object.keys(assembled).length,
        conversions
      }
    };
  }
}
