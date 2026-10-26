import { describe, expect, it } from 'vitest';
import {
  computePowerMetrics,
  erf,
  fisherZ,
  invFisherZ,
  normalCdf,
  normalQuantile
} from '../data/powerAnalysis';
import {
  ResearchPowerRequest,
  ResearchPowerResult,
  validatePowerRequest
} from '../data/powerContracts';
import { D12_ENGINE_VERSION, ResearchPowerEngine } from '../data/powerEngine';

describe('Phase D12 — Research Power & Sample Size Engine', () => {
  // ==========================================
  // 1. CONTRACT & VALIDATION TESTS
  // ==========================================
  describe('Contract & Validation', () => {
    it('1. Validates a valid ResearchPowerRequest successfully', () => {
      const request: ResearchPowerRequest = {
        power_analysis_id: 'pow_001',
        analysis_type: 'ONE_SAMPLE_MEAN',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.5
      };

      const val = validatePowerRequest(request);
      expect(val.valid).toBe(true);
      expect(val.errors).toHaveLength(0);
    });

    it('2. Flags missing power_analysis_id', () => {
      const request = {
        power_analysis_id: '',
        analysis_type: 'ONE_SAMPLE_MEAN'
      } as ResearchPowerRequest;

      const val = validatePowerRequest(request);
      expect(val.valid).toBe(false);
      expect(val.errors.some((e) => e.includes('power_analysis_id'))).toBe(true);
    });

    it('3. Rejects invalid alpha values (alpha <= 0 or alpha >= 1)', () => {
      const badAlphas = [-0.05, 0, 1, 1.5, NaN];
      for (const alpha of badAlphas) {
        const req: ResearchPowerRequest = {
          power_analysis_id: 'pow_bad_alpha',
          analysis_type: 'ONE_SAMPLE_MEAN',
          alpha
        };
        const val = validatePowerRequest(req);
        expect(val.valid).toBe(false);
      }
    });

    it('4. Rejects invalid target_power values (target_power <= 0 or target_power >= 1)', () => {
      const badPowers = [-0.1, 0, 1, 1.2, Infinity];
      for (const target_power of badPowers) {
        const req: ResearchPowerRequest = {
          power_analysis_id: 'pow_bad_power',
          analysis_type: 'ONE_SAMPLE_MEAN',
          target_power
        };
        const val = validatePowerRequest(req);
        expect(val.valid).toBe(false);
      }
    });

    it('5. Rejects invalid dropout_rate (dropout_rate < 0 or dropout_rate >= 1)', () => {
      const badDropouts = [-0.1, 1.0, 1.5];
      for (const dropout_rate of badDropouts) {
        const req: ResearchPowerRequest = {
          power_analysis_id: 'pow_bad_dropout',
          analysis_type: 'ONE_SAMPLE_MEAN',
          configuration: { dropout_rate }
        };
        const val = validatePowerRequest(req);
        expect(val.valid).toBe(false);
      }
    });

    it('6. Rejects invalid allocation_ratio (allocation_ratio <= 0)', () => {
      const badRatios = [0, -1, NaN];
      for (const allocation_ratio of badRatios) {
        const req: ResearchPowerRequest = {
          power_analysis_id: 'pow_bad_alloc',
          analysis_type: 'TWO_SAMPLE_MEAN',
          configuration: { allocation_ratio }
        };
        const val = validatePowerRequest(req);
        expect(val.valid).toBe(false);
      }
    });
  });

  // ==========================================
  // 2. MATHEMATICAL DISTRIBUTION PRIMITIVES
  // ==========================================
  describe('Mathematical Distribution Primitives', () => {
    it('7. Calculates erf and normalCdf deterministically', () => {
      expect(erf(0)).toBe(0);
      expect(normalCdf(0)).toBeCloseTo(0.5, 5);
      expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
      expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
    });

    it('8. Calculates normalQuantile accurately', () => {
      expect(normalQuantile(0.5)).toBeCloseTo(0, 5);
      expect(normalQuantile(0.975)).toBeCloseTo(1.96, 2);
      expect(normalQuantile(0.025)).toBeCloseTo(-1.96, 2);
      expect(normalQuantile(0.95)).toBeCloseTo(1.645, 2);
    });

    it('9. Fisher Z transformation roundtrips accurately', () => {
      const r = 0.5;
      const z = fisherZ(r);
      const rBack = invFisherZ(z);
      expect(rBack).toBeCloseTo(r, 6);
    });
  });

  // ==========================================
  // 3. SAMPLE SIZE CALCULATION TESTS
  // ==========================================
  describe('Sample Size Engine', () => {
    it('10. Calculates sample size for ONE_SAMPLE_MEAN with integer ceiling rule', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_osm',
        analysis_type: 'ONE_SAMPLE_MEAN',
        calculation_mode: 'SAMPLE_SIZE',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.5
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.status).toBe('COMPLETED');
      expect(res.required_sample_size).toBeGreaterThan(0);
      expect(Number.isInteger(res.required_sample_size)).toBe(true);
      // For d=0.5, alpha=0.05 two-sided, power=0.80, zAlpha~1.96, zBeta~0.84 -> n ~ ((1.96+0.84)/0.5)^2 ~ 31.36 -> ceil=32
      expect(res.required_sample_size).toBe(32);
    });

    it('11. Calculates sample size for TWO_SAMPLE_MEAN', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_tsm',
        analysis_type: 'TWO_SAMPLE_MEAN',
        calculation_mode: 'SAMPLE_SIZE',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.5
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.status).toBe('COMPLETED');
      expect(res.required_sample_size).toBe(126); // 63 per group x 2
      expect(res.group_sample_sizes).toEqual({ group_a: 63, group_b: 63 });
    });

    it('12. Calculates sample size for PAIRED_MEAN', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_paired',
        analysis_type: 'PAIRED_MEAN',
        calculation_mode: 'SAMPLE_SIZE',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.5
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.status).toBe('COMPLETED');
      expect(res.required_sample_size).toBe(32);
    });

    it('13. Calculates sample size for ONE_PROPORTION', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_one_prop',
        analysis_type: 'ONE_PROPORTION',
        calculation_mode: 'SAMPLE_SIZE',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.3 // Cohen's h = 0.3
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.status).toBe('COMPLETED');
      expect(res.required_sample_size).toBe(88);
    });

    it('14. Calculates sample size for TWO_PROPORTIONS', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_two_prop',
        analysis_type: 'TWO_PROPORTIONS',
        calculation_mode: 'SAMPLE_SIZE',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.4
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.status).toBe('COMPLETED');
      expect(res.required_sample_size).toBe(198); // 99 per group
    });

    it('15. Calculates sample size for CORRELATION', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_corr',
        analysis_type: 'CORRELATION',
        calculation_mode: 'SAMPLE_SIZE',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.3 // Pearson r = 0.3
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.status).toBe('COMPLETED');
      expect(res.required_sample_size).toBe(85);
    });

    it('16. Calculates sample size for ANOVA', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_anova',
        analysis_type: 'ANOVA',
        calculation_mode: 'SAMPLE_SIZE',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.25, // Cohen's f = 0.25
        configuration: { groups: 4 }
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.status).toBe('COMPLETED');
      expect(res.group_sample_sizes).toBeDefined();
      expect(Object.keys(res.group_sample_sizes!)).toHaveLength(4);
    });

    it('17. Calculates sample size for CHI_SQUARE', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_chi',
        analysis_type: 'CHI_SQUARE',
        calculation_mode: 'SAMPLE_SIZE',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.3
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.status).toBe('COMPLETED');
      expect(res.required_sample_size).toBe(88);
    });

    it('18. Calculates sample size for LINEAR_REGRESSION', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_linreg',
        analysis_type: 'LINEAR_REGRESSION',
        calculation_mode: 'SAMPLE_SIZE',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.15, // f^2 = 0.15
        configuration: { num_predictors: 3 }
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.status).toBe('COMPLETED');
      expect(res.required_sample_size).toBeGreaterThan(0);
    });

    it('19. Calculates sample size for LOGISTIC_REGRESSION', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_logreg',
        analysis_type: 'LOGISTIC_REGRESSION',
        calculation_mode: 'SAMPLE_SIZE',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 1.5, // Odds Ratio = 1.5
        configuration: { baseline_proportion: 0.3 }
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.status).toBe('COMPLETED');
      expect(res.required_sample_size).toBeGreaterThan(0);
    });
  });

  // ==========================================
  // 4. POWER CALCULATION TESTS
  // ==========================================
  describe('Power Engine', () => {
    it('20. Calculates achieved power given sample size and effect size', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_achieved',
        analysis_type: 'ONE_SAMPLE_MEAN',
        calculation_mode: 'ACHIEVED_POWER',
        alpha: 0.05,
        sample_size: 32,
        effect_size: 0.5
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.status).toBe('COMPLETED');
      expect(res.achieved_power).toBeDefined();
      expect(res.achieved_power!).toBeGreaterThan(0.79);
      expect(res.achieved_power!).toBeLessThan(1.0);
    });

    it('21. Power increases monotonic with sample size', () => {
      const p1 = computePowerMetrics({
        analysis_type: 'ONE_SAMPLE_MEAN',
        mode: 'ACHIEVED_POWER',
        alpha: 0.05,
        sample_size: 20,
        effect_size: 0.5
      });

      const p2 = computePowerMetrics({
        analysis_type: 'ONE_SAMPLE_MEAN',
        mode: 'ACHIEVED_POWER',
        alpha: 0.05,
        sample_size: 50,
        effect_size: 0.5
      });

      expect(p2.achieved_power!).toBeGreaterThan(p1.achieved_power!);
    });

    it('22. Handles boundary case of very small sample size safely without throw', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_tiny',
        analysis_type: 'ONE_SAMPLE_MEAN',
        calculation_mode: 'ACHIEVED_POWER',
        alpha: 0.05,
        sample_size: 2,
        effect_size: 0.1
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.status).toBe('COMPLETED');
      expect(res.achieved_power).toBeGreaterThan(0);
    });
  });

  // ==========================================
  // 5. MINIMUM DETECTABLE EFFECT (MDE) TESTS
  // ==========================================
  describe('Minimum Detectable Effect (MDE)', () => {
    it('23. Calculates MDE given sample size and target power', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_mde',
        analysis_type: 'ONE_SAMPLE_MEAN',
        calculation_mode: 'MINIMUM_DETECTABLE_EFFECT',
        alpha: 0.05,
        target_power: 0.8,
        sample_size: 32
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.status).toBe('COMPLETED');
      expect(res.minimum_detectable_effect).toBeCloseTo(0.5, 1);
    });

    it('24. MDE decreases with larger sample size', () => {
      const mde1 = computePowerMetrics({
        analysis_type: 'ONE_SAMPLE_MEAN',
        mode: 'MINIMUM_DETECTABLE_EFFECT',
        alpha: 0.05,
        target_power: 0.8,
        sample_size: 30
      });

      const mde2 = computePowerMetrics({
        analysis_type: 'ONE_SAMPLE_MEAN',
        mode: 'MINIMUM_DETECTABLE_EFFECT',
        alpha: 0.05,
        target_power: 0.8,
        sample_size: 100
      });

      expect(mde2.minimum_detectable_effect!).toBeLessThan(mde1.minimum_detectable_effect!);
    });
  });

  // ==========================================
  // 6. DROPOUT / ATTRITION ADJUSTMENT
  // ==========================================
  describe('Dropout & Attrition Adjustment', () => {
    it('25. Leaves sample size unadjusted if dropout_rate is 0', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_no_drop',
        analysis_type: 'ONE_SAMPLE_MEAN',
        calculation_mode: 'SAMPLE_SIZE',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.5,
        configuration: { dropout_rate: 0 }
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.statistical_sample_size).toBe(res.attrition_adjusted_sample_size);
    });

    it('26. Correctly adjusts sample size for 20% dropout rate', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_drop_20',
        analysis_type: 'ONE_SAMPLE_MEAN',
        calculation_mode: 'SAMPLE_SIZE',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.5,
        configuration: { dropout_rate: 0.2 }
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.statistical_sample_size).toBe(32);
      // ceil(32 / 0.8) = ceil(40) = 40
      expect(res.attrition_adjusted_sample_size).toBe(40);
      expect(res.assumptions.some((a) => a.includes('Dropout / attrition adjustment rate = 0.2'))).toBe(true);
    });

    it('27. Correctly adjusts for high dropout rate (50%)', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_drop_50',
        analysis_type: 'ONE_SAMPLE_MEAN',
        calculation_mode: 'SAMPLE_SIZE',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.5,
        configuration: { dropout_rate: 0.5 }
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.statistical_sample_size).toBe(32);
      // ceil(32 / 0.5) = 64
      expect(res.attrition_adjusted_sample_size).toBe(64);
    });
  });

  // ==========================================
  // 7. ALLOCATION RATIO TESTS
  // ==========================================
  describe('Allocation Ratio Engine', () => {
    it('28. Handles equal allocation ratio 1:1', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_alloc_1',
        analysis_type: 'TWO_SAMPLE_MEAN',
        calculation_mode: 'SAMPLE_SIZE',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.5,
        configuration: { allocation_ratio: 1.0 }
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.group_sample_sizes).toEqual({ group_a: 63, group_b: 63 });
    });

    it('29. Handles unequal allocation ratio 2:1 (group_b twice group_a)', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_alloc_2',
        analysis_type: 'TWO_SAMPLE_MEAN',
        calculation_mode: 'SAMPLE_SIZE',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.5,
        configuration: { allocation_ratio: 2.0 }
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.group_sample_sizes?.group_b).toBeGreaterThan(res.group_sample_sizes?.group_a!);
    });
  });

  // ==========================================
  // 8. SENSITIVITY ANALYSIS GRID TESTS
  // ==========================================
  describe('Sensitivity Analysis Engine', () => {
    it('30. Computes sensitivity grid across specified sample sizes preserving array order', () => {
      const sampleSizes = [20, 40, 60, 80, 100];
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_sens',
        analysis_type: 'ONE_SAMPLE_MEAN',
        calculation_mode: 'ACHIEVED_POWER',
        alpha: 0.05,
        effect_size: 0.5,
        sample_size: 50,
        configuration: { sensitivity_sample_sizes: sampleSizes }
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.sensitivity_results).toBeDefined();
      expect(res.sensitivity_results!).toHaveLength(5);
      expect(res.sensitivity_results!.map((s) => s.sample_size)).toEqual(sampleSizes);

      // Powers should be monotonically increasing
      const powers = res.sensitivity_results!.map((s) => s.power!);
      for (let i = 1; i < powers.length; i++) {
        expect(powers[i]).toBeGreaterThan(powers[i - 1]);
      }
    });
  });

  // ==========================================
  // 9. PROVENANCE INTEGRITY TESTS
  // ==========================================
  describe('Provenance Integrity', () => {
    it('31. Same request produces identical provenance hash digest', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_prov_1',
        analysis_type: 'ONE_SAMPLE_MEAN',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.5,
        engine_version: D12_ENGINE_VERSION
      };

      const res1 = ResearchPowerEngine.execute(req);
      const res2 = ResearchPowerEngine.execute(req);

      expect(res1.provenance_hash).toBe(res2.provenance_hash);
      expect(res1.provenance_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('32. Changed alpha alters provenance hash digest', () => {
      const req1: ResearchPowerRequest = {
        power_analysis_id: 'pow_prov_a1',
        analysis_type: 'ONE_SAMPLE_MEAN',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.5,
        engine_version: D12_ENGINE_VERSION
      };

      const req2: ResearchPowerRequest = {
        ...req1,
        alpha: 0.01
      };

      const res1 = ResearchPowerEngine.execute(req1);
      const res2 = ResearchPowerEngine.execute(req2);

      expect(res1.provenance_hash).not.toBe(res2.provenance_hash);
    });

    it('33. Changed effect size alters provenance hash digest', () => {
      const req1: ResearchPowerRequest = {
        power_analysis_id: 'pow_prov_e1',
        analysis_type: 'ONE_SAMPLE_MEAN',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.5,
        engine_version: D12_ENGINE_VERSION
      };

      const req2: ResearchPowerRequest = {
        ...req1,
        effect_size: 0.8
      };

      const res1 = ResearchPowerEngine.execute(req1);
      const res2 = ResearchPowerEngine.execute(req2);

      expect(res1.provenance_hash).not.toBe(res2.provenance_hash);
    });

    it('34. Changed configuration alters provenance hash digest', () => {
      const req1: ResearchPowerRequest = {
        power_analysis_id: 'pow_prov_c1',
        analysis_type: 'TWO_SAMPLE_MEAN',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.5,
        configuration: { allocation_ratio: 1.0 },
        engine_version: D12_ENGINE_VERSION
      };

      const req2: ResearchPowerRequest = {
        ...req1,
        configuration: { allocation_ratio: 2.0 }
      };

      const res1 = ResearchPowerEngine.execute(req1);
      const res2 = ResearchPowerEngine.execute(req2);

      expect(res1.provenance_hash).not.toBe(res2.provenance_hash);
    });
  });

  // ==========================================
  // 10. IMMUTABILITY & DEEP FREEZE TESTS
  // ==========================================
  describe('Immutability Integrity', () => {
    it('35. Freezes output result deeply', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_freeze',
        analysis_type: 'ONE_SAMPLE_MEAN',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.5
      };

      const res = ResearchPowerEngine.execute(req);
      expect(Object.isFrozen(res)).toBe(true);
      expect(Object.isFrozen(res.assumptions)).toBe(true);
      expect(Object.isFrozen(res.warnings)).toBe(true);

      // Attempting mutation in strict mode throws TypeError
      expect(() => {
        (res as any).alpha = 0.01;
      }).toThrow();
    });

    it('36. Does not mutate input request object', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_no_mut',
        analysis_type: 'ONE_SAMPLE_MEAN',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.5,
        configuration: { dropout_rate: 0.1 }
      };

      const reqCopy = JSON.parse(JSON.stringify(req));
      ResearchPowerEngine.execute(req);
      expect(req).toEqual(reqCopy);
    });
  });

  // ==========================================
  // 11. SCIENTIFIC BOUNDARY & DEFAULT APPLIED
  // ==========================================
  describe('Scientific Boundary & Metadata', () => {
    it('37. Result scientific_validity is ALWAYS NOT_ESTABLISHED', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_boundary',
        analysis_type: 'ONE_SAMPLE_MEAN',
        alpha: 0.05,
        target_power: 0.8,
        effect_size: 0.5
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.scientific_validity).toBe('NOT_ESTABLISHED');
    });

    it('38. Sets default_applied = true when alpha or target_power is omitted', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_defaults',
        analysis_type: 'ONE_SAMPLE_MEAN',
        effect_size: 0.5
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.default_applied).toBe(true);
      expect(res.alpha).toBe(0.05);
      expect(res.target_power).toBe(0.8);
    });

    it('39. Sets default_applied = false when all explicit parameters supplied', () => {
      const req: ResearchPowerRequest = {
        power_analysis_id: 'pow_explicit',
        analysis_type: 'ONE_SAMPLE_MEAN',
        alpha: 0.01,
        target_power: 0.9,
        effect_size: 0.5
      };

      const res = ResearchPowerEngine.execute(req);
      expect(res.default_applied).toBe(false);
      expect(res.alpha).toBe(0.01);
      expect(res.target_power).toBe(0.9);
    });
  });

  // ==========================================
  // 12. SECURITY AUDIT
  // ==========================================
  describe('Security Audit', () => {
    it('40. Verification: Engine contains zero eval or dynamic execution', () => {
      const engineCode = ResearchPowerEngine.toString() + computePowerMetrics.toString();
      expect(engineCode).not.toContain('eval(');
      expect(engineCode).not.toContain('new Function(');
    });
  });
});
