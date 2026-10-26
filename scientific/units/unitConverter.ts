/**
 * NutriBodySim — Scientific Unit Registry & Normalization Engine
 * 
 * Supports conversion between standard SI and field units:
 * Mass, Length, Time, Energy, Volume, Temperature, Concentration, Percentage.
 * Always records original value/unit, normalized value/unit, and conversion step.
 */

import { ScientificUnit, MeasurementType } from '../types';

export const STANDARD_UNITS: ScientificUnit[] = [
  // Mass (Base: kg)
  { unit_id: 'UNIT_KG', symbol: 'kg', name: 'Kilogram', measurement_type: 'mass', base_unit: 'kg', to_base_multiplier: 1 },
  { unit_id: 'UNIT_G', symbol: 'g', name: 'Gram', measurement_type: 'mass', base_unit: 'kg', to_base_multiplier: 0.001 },
  { unit_id: 'UNIT_MG', symbol: 'mg', name: 'Milligram', measurement_type: 'mass', base_unit: 'kg', to_base_multiplier: 0.000001 },
  { unit_id: 'UNIT_LB', symbol: 'lb', name: 'Pound', measurement_type: 'mass', base_unit: 'kg', to_base_multiplier: 0.45359237 },
  
  // Length (Base: m)
  { unit_id: 'UNIT_M', symbol: 'm', name: 'Meter', measurement_type: 'length', base_unit: 'm', to_base_multiplier: 1 },
  { unit_id: 'UNIT_CM', symbol: 'cm', name: 'Centimeter', measurement_type: 'length', base_unit: 'm', to_base_multiplier: 0.01 },
  { unit_id: 'UNIT_MM', symbol: 'mm', name: 'Millimeter', measurement_type: 'length', base_unit: 'm', to_base_multiplier: 0.001 },
  { unit_id: 'UNIT_IN', symbol: 'in', name: 'Inch', measurement_type: 'length', base_unit: 'm', to_base_multiplier: 0.0254 },
  { unit_id: 'UNIT_FT', symbol: 'ft', name: 'Foot', measurement_type: 'length', base_unit: 'm', to_base_multiplier: 0.3048 },

  // Time (Base: s)
  { unit_id: 'UNIT_S', symbol: 's', name: 'Second', measurement_type: 'time', base_unit: 's', to_base_multiplier: 1 },
  { unit_id: 'UNIT_MIN', symbol: 'min', name: 'Minute', measurement_type: 'time', base_unit: 's', to_base_multiplier: 60 },
  { unit_id: 'UNIT_H', symbol: 'h', name: 'Hour', measurement_type: 'time', base_unit: 's', to_base_multiplier: 3600 },
  { unit_id: 'UNIT_DAY', symbol: 'day', name: 'Day', measurement_type: 'time', base_unit: 's', to_base_multiplier: 86400 },
  { unit_id: 'UNIT_YEAR', symbol: 'yr', name: 'Year', measurement_type: 'time', base_unit: 's', to_base_multiplier: 31536000 },

  // Energy (Base: J)
  { unit_id: 'UNIT_J', symbol: 'J', name: 'Joule', measurement_type: 'energy', base_unit: 'J', to_base_multiplier: 1 },
  { unit_id: 'UNIT_KJ', symbol: 'kJ', name: 'Kilojoule', measurement_type: 'energy', base_unit: 'J', to_base_multiplier: 1000 },
  { unit_id: 'UNIT_KCAL', symbol: 'kcal', name: 'Kilocalorie (Cal)', measurement_type: 'energy', base_unit: 'J', to_base_multiplier: 4184 },
  { unit_id: 'UNIT_CAL', symbol: 'cal', name: 'Calorie', measurement_type: 'energy', base_unit: 'J', to_base_multiplier: 4.184 },

  // Volume (Base: L)
  { unit_id: 'UNIT_L', symbol: 'L', name: 'Liter', measurement_type: 'volume', base_unit: 'L', to_base_multiplier: 1 },
  { unit_id: 'UNIT_ML', symbol: 'mL', name: 'Milliliter', measurement_type: 'volume', base_unit: 'L', to_base_multiplier: 0.001 },
  { unit_id: 'UNIT_DL', symbol: 'dL', name: 'Deciliter', measurement_type: 'volume', base_unit: 'L', to_base_multiplier: 0.1 },

  // Temperature (Base: K)
  { unit_id: 'UNIT_K', symbol: 'K', name: 'Kelvin', measurement_type: 'temperature', base_unit: 'K', to_base_multiplier: 1, to_base_offset: 0 },
  { unit_id: 'UNIT_C', symbol: '°C', name: 'Celsius', measurement_type: 'temperature', base_unit: 'K', to_base_multiplier: 1, to_base_offset: 273.15 },
  { unit_id: 'UNIT_F', symbol: '°F', name: 'Fahrenheit', measurement_type: 'temperature', base_unit: 'K', to_base_multiplier: 5 / 9, to_base_offset: 273.15 - (32 * 5 / 9) },

  // Concentration (Base: mmol/L)
  { unit_id: 'UNIT_MMOL_L', symbol: 'mmol/L', name: 'Millimole per Liter', measurement_type: 'concentration', base_unit: 'mmol/L', to_base_multiplier: 1 },
  { unit_id: 'UNIT_MG_DL', symbol: 'mg/dL', name: 'Milligram per Deciliter', measurement_type: 'concentration', base_unit: 'mmol/L', to_base_multiplier: 1 }, // conversion depends on molecular weight in full science, handled via algorithm

  // Pressure (Base: Pa, Hemodynamic Standard: mmHg)
  { unit_id: 'UNIT_PA', symbol: 'Pa', name: 'Pascal', measurement_type: 'pressure', base_unit: 'Pa', to_base_multiplier: 1 },
  { unit_id: 'UNIT_KPA', symbol: 'kPa', name: 'Kilopascal', measurement_type: 'pressure', base_unit: 'Pa', to_base_multiplier: 1000 },
  { unit_id: 'UNIT_MMHG', symbol: 'mmHg', name: 'Millimeter of Mercury', measurement_type: 'pressure', base_unit: 'Pa', to_base_multiplier: 133.322387415 },
  { unit_id: 'UNIT_BAR', symbol: 'bar', name: 'Bar', measurement_type: 'pressure', base_unit: 'Pa', to_base_multiplier: 100000 },

  // Percentage & Dimensionless
  { unit_id: 'UNIT_PCT', symbol: '%', name: 'Percent', measurement_type: 'percentage', base_unit: '%', to_base_multiplier: 1 },
  { unit_id: 'UNIT_RATIO', symbol: 'ratio', name: 'Fraction / Ratio', measurement_type: 'ratio', base_unit: 'ratio', to_base_multiplier: 1 },
  { unit_id: 'UNIT_NONE', symbol: 'unitless', name: 'Dimensionless', measurement_type: 'dimensionless', base_unit: 'unitless', to_base_multiplier: 1 }
];

export interface ConversionResult {
  originalValue: number;
  originalUnit: string;
  targetValue: number;
  targetUnit: string;
  trace: string;
}

export function findUnit(symbolOrId: string): ScientificUnit | undefined {
  const query = symbolOrId.trim().toLowerCase();
  return STANDARD_UNITS.find(
    u => u.unit_id.toLowerCase() === query || u.symbol.toLowerCase() === query || u.name.toLowerCase() === query
  );
}

export function convertUnit(
  value: number,
  fromUnitSymbol: string,
  toUnitSymbol: string
): ConversionResult {
  const from = findUnit(fromUnitSymbol);
  const to = findUnit(toUnitSymbol);

  if (!from) {
    throw new Error(`Unsupported source unit: "${fromUnitSymbol}"`);
  }
  if (!to) {
    throw new Error(`Unsupported target unit: "${toUnitSymbol}"`);
  }
  if (from.measurement_type !== to.measurement_type && from.measurement_type !== 'dimensionless' && to.measurement_type !== 'dimensionless') {
    throw new Error(`Incompatible measurement types: Cannot convert "${from.measurement_type}" (${from.symbol}) to "${to.measurement_type}" (${to.symbol})`);
  }

  // Convert from -> base
  const fromOffset = from.to_base_offset || 0;
  const baseValue = (value * from.to_base_multiplier) + fromOffset;

  // Convert base -> to
  const toOffset = to.to_base_offset || 0;
  const targetValue = (baseValue - toOffset) / to.to_base_multiplier;

  const trace = from.symbol === to.symbol
    ? `No conversion required: ${value} ${from.symbol}`
    : `${value} ${from.symbol} -> base ${baseValue.toFixed(6)} ${from.base_unit} -> ${targetValue.toFixed(6)} ${to.symbol}`;

  return {
    originalValue: value,
    originalUnit: from.symbol,
    targetValue,
    targetUnit: to.symbol,
    trace
  };
}

export class UnitConverter {
  static find(symbolOrId: string): ScientificUnit | undefined {
    return findUnit(symbolOrId);
  }

  static convert(value: number, fromUnit: string, toUnit: string): ConversionResult {
    return convertUnit(value, fromUnit, toUnit);
  }

  static canConvert(fromUnit: string, toUnit: string): boolean {
    const from = findUnit(fromUnit);
    const to = findUnit(toUnit);
    if (!from || !to) return false;
    return (
      from.measurement_type === to.measurement_type ||
      from.measurement_type === 'dimensionless' ||
      to.measurement_type === 'dimensionless'
    );
  }

  static getDimension(unit: string): string | undefined {
    return findUnit(unit)?.measurement_type;
  }
}
