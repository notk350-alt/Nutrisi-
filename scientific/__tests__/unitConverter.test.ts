import { describe, it, expect } from 'vitest';
import { convertUnit, findUnit, STANDARD_UNITS } from '../units/unitConverter';

describe('Scientific Unit Engine (unitConverter)', () => {
  it('should find registered units by symbol or ID case-insensitively', () => {
    expect(findUnit('kg')).toBeDefined();
    expect(findUnit('KG')?.unit_id).toBe('UNIT_KG');
    expect(findUnit('mmHg')?.measurement_type).toBe('pressure');
    expect(findUnit('pa')?.unit_id).toBe('UNIT_PA');
  });

  it('should return undefined for unregistered units', () => {
    expect(findUnit('lightyears')).toBeUndefined();
    expect(findUnit('')).toBeUndefined();
  });

  describe('Mass conversions', () => {
    it('should accurately convert kilograms to grams and pounds', () => {
      const g = convertUnit(2.5, 'kg', 'g');
      expect(g.targetValue).toBeCloseTo(2500, 4);

      const lb = convertUnit(1, 'kg', 'lb');
      expect(lb.targetValue).toBeCloseTo(2.20462, 4);

      const backToKg = convertUnit(lb.targetValue, 'lb', 'kg');
      expect(backToKg.targetValue).toBeCloseTo(1, 4);
    });
  });

  describe('Length conversions', () => {
    it('should accurately convert meters to centimeters and inches', () => {
      const cm = convertUnit(1.75, 'm', 'cm');
      expect(cm.targetValue).toBeCloseTo(175, 4);

      const inches = convertUnit(1.75, 'm', 'in');
      expect(inches.targetValue).toBeCloseTo(68.8976, 3);
    });
  });

  describe('Temperature conversions (affine transformations with offsets)', () => {
    it('should convert Celsius to Kelvin and Fahrenheit', () => {
      const zeroCInK = convertUnit(0, '°C', 'K');
      expect(zeroCInK.targetValue).toBeCloseTo(273.15, 3);

      const bodyTempF = convertUnit(37, '°C', '°F');
      expect(bodyTempF.targetValue).toBeCloseTo(98.6, 2);

      const freezingF = convertUnit(32, '°F', '°C');
      expect(freezingF.targetValue).toBeCloseTo(0, 3);
    });
  });

  describe('Hemodynamic Pressure conversions (Phase A addition)', () => {
    it('should convert standard atmospheric 760 mmHg to Pascals (NIST standard)', () => {
      const pa = convertUnit(760, 'mmHg', 'Pa');
      expect(pa.targetValue).toBeCloseTo(101325.014, 2);
    });

    it('should convert 760 mmHg to Kilopascals', () => {
      const kpa = convertUnit(760, 'mmHg', 'kPa');
      expect(kpa.targetValue).toBeCloseTo(101.325, 2);
    });

    it('should convert standard blood pressure 120 mmHg to kPa', () => {
      const sbpKpa = convertUnit(120, 'mmHg', 'kPa');
      expect(sbpKpa.targetValue).toBeCloseTo(15.9987, 2);
    });

    it('should convert 1 bar to Pa', () => {
      const barToPa = convertUnit(1, 'bar', 'Pa');
      expect(barToPa.targetValue).toBeCloseTo(100000, 2);
    });
  });

  describe('Incompatible types and validation', () => {
    it('should throw an error when converting between incompatible measurement types', () => {
      expect(() => convertUnit(70, 'kg', 'mmHg')).toThrowError(/Incompatible measurement types/);
      expect(() => convertUnit(1.75, 'm', '°C')).toThrowError(/Incompatible measurement types/);
    });

    it('should throw an error when given an unknown unit', () => {
      expect(() => convertUnit(100, 'unknown_unit', 'kg')).toThrowError(/Unsupported source unit/);
      expect(() => convertUnit(100, 'kg', 'unknown_unit')).toThrowError(/Unsupported target unit/);
    });
  });
});
