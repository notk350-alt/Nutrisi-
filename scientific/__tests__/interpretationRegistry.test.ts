import { describe, it, expect } from 'vitest';
import { DEMO_INTERPRETATION_RULES } from '../registry/demoModules';
import { InterpretationRule, InterpretationThreshold } from '../types';

export function matchThreshold(rule: InterpretationRule, value: number): InterpretationThreshold | undefined {
  return rule.thresholds.find(t => {
    const minPass = t.min === undefined || (t.min_inclusive ? value >= t.min : value > t.min);
    const maxPass = t.max === undefined || (t.max_inclusive ? value <= t.max : value < t.max);
    return minPass && maxPass;
  });
}

describe('Scientific Interpretation Registry (interpretationRegistry)', () => {
  it('should find registered interpretation rules', () => {
    expect(DEMO_INTERPRETATION_RULES.length).toBeGreaterThanOrEqual(2);
    const bmiRule = DEMO_INTERPRETATION_RULES.find(r => r.rule_id === 'RULE_BMI_WHO_ADULT');
    expect(bmiRule).toBeDefined();
    expect(bmiRule?.module_type).toBe('INTERPRETATION');
    expect(bmiRule?.status).toBe('VERIFIED');
  });

  describe('WHO Adult BMI Interpretation Rule (RULE_BMI_WHO_ADULT)', () => {
    const bmiRule = DEMO_INTERPRETATION_RULES.find(r => r.rule_id === 'RULE_BMI_WHO_ADULT')!;

    it('should classify BMI < 18.5 as Underweight', () => {
      const match = matchThreshold(bmiRule, 17.5);
      expect(match).toBeDefined();
      expect(match?.label).toBe('Underweight');
      expect(match?.clinical_status).toContain('Underweight');
      expect(match?.badge_color).toBe('amber');
    });

    it('should classify BMI 18.5 to 24.99 as Normal', () => {
      const matchLower = matchThreshold(bmiRule, 18.5);
      expect(matchLower?.label).toBe('Normal weight');

      const matchMid = matchThreshold(bmiRule, 22.8);
      expect(matchMid?.label).toBe('Normal weight');
      expect(matchMid?.clinical_status).toContain('Normal');
      expect(matchMid?.badge_color).toBe('emerald');

      const matchUpper = matchThreshold(bmiRule, 24.9);
      expect(matchUpper?.label).toBe('Normal weight');
    });

    it('should classify BMI 25.0 to 29.99 as Overweight', () => {
      const match = matchThreshold(bmiRule, 27.4);
      expect(match?.label).toBe('Overweight');
      expect(match?.clinical_status).toContain('Overweight');
    });

    it('should classify BMI 30.0 to 34.99 as Obesity Class I', () => {
      const match = matchThreshold(bmiRule, 32.1);
      expect(match?.label).toBe('Obesity Class I');
      expect(match?.clinical_status).toContain('Tingkat I');
    });

    it('should classify BMI >= 35.0 as Obesity Class II/III', () => {
      const match = matchThreshold(bmiRule, 38.5);
      expect(match?.label).toBe('Obesity Class II/III');
      expect(match?.badge_color).toBe('red');
    });
  });

  describe('Guyton-Hall MAP Hemodynamic Perfusion Rule (RULE_MAP_CLINICAL_PERFUSION)', () => {
    const mapRule = DEMO_INTERPRETATION_RULES.find(r => r.rule_id === 'RULE_MAP_CLINICAL_PERFUSION')!;

    it('should classify MAP < 65 mmHg as Low Perfusion Risk', () => {
      const match = matchThreshold(mapRule, 58);
      expect(match?.label).toBe('Low Perfusion');
      expect(match?.clinical_status).toContain('Hipotensi');
      expect(match?.badge_color).toBe('red');
    });

    it('should classify MAP 65-100 mmHg as Adequate Perfusion', () => {
      const match = matchThreshold(mapRule, 93.3);
      expect(match?.label).toBe('Adequate Perfusion');
      expect(match?.clinical_status).toContain('Adekuat');
      expect(match?.badge_color).toBe('emerald');
    });

    it('should classify MAP > 100 mmHg as Elevated Perfusion Load', () => {
      const match = matchThreshold(mapRule, 115);
      expect(match?.label).toBe('Elevated Perfusion Load');
      expect(match?.clinical_status).toContain('Hipertensi');
      expect(match?.badge_color).toBe('amber');
    });
  });
});
