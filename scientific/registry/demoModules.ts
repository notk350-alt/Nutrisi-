/**
 * NutriBodySim — Demo Scientific Registry Modules
 * 
 * CRITICAL COMPLIANCE NOTICE (Section 51 & 62):
 * These modules are DEMO / PLACEHOLDER objects created solely for testing
 * the computational platform infrastructure.
 * They are NOT SCIENTIFICALLY VERIFIED and must not be treated as clinical truth.
 */

import { 
  ScientificVariable, 
  ScientificParameter, 
  ScientificFormula, 
  ScientificModel, 
  ScientificReference,
  InterpretationRule
} from '../types';

export const DEMO_REFERENCES: ScientificReference[] = [
  {
    reference_id: 'REF_DEMO_001',
    title: 'Demo Reference: Principles of Anthropometric Indexing in Computational Models',
    authors: ['Doe, J.', 'Smith, A.'],
    year: 2024,
    journal_or_publisher: 'Journal of Computational Physiology Demonstration',
    doi: '10.1000/demo.nutribodysim.001',
    citation_key: 'Doe2024Demo',
    abstract: 'This is a demo placeholder reference used solely to verify the NutriBodySim reference link pipeline.'
  },
  {
    reference_id: 'REF_DEMO_002',
    title: 'Demo Reference: Energy Expenditure Coefficients and Calibration Benchmarks',
    authors: ['Taylor, R.', 'Lin, K.'],
    year: 2023,
    journal_or_publisher: 'Nutritional Bioenergetics Archive (Mock)',
    doi: '10.1000/demo.nutribodysim.002',
    citation_key: 'Taylor2023Demo',
    abstract: 'Placeholder citation for testing parameter provenance and model attribution.'
  }
];

export const DEMO_VARIABLES: ScientificVariable[] = [
  {
    variable_id: 'VAR_DEMO_WEIGHT',
    name: 'Body Weight',
    label: 'Body Weight (Demo)',
    definition: '[DEMO PLACEHOLDER: Total body mass measured under standardized conditions]',
    datatype: 'number',
    unit: 'kg',
    measurement_type: 'mass',
    allowed_range: { min: 2, max: 500, warning_min: 30, warning_max: 250 },
    population: 'Adult human (Demo test cohort)',
    source_reference: 'REF_DEMO_001',
    version: '1.0.0',
    status: 'EXPERIMENTAL',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  },
  {
    variable_id: 'VAR_DEMO_HEIGHT',
    name: 'Body Height',
    label: 'Stature / Height (Demo)',
    definition: '[DEMO PLACEHOLDER: Standing height measured with stadiometer]',
    datatype: 'number',
    unit: 'm',
    measurement_type: 'length',
    allowed_range: { min: 0.4, max: 2.8, warning_min: 1.0, warning_max: 2.2 },
    population: 'Adult human (Demo test cohort)',
    source_reference: 'REF_DEMO_001',
    version: '1.0.0',
    status: 'EXPERIMENTAL',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  },
  {
    variable_id: 'VAR_DEMO_AGE',
    name: 'Chronological Age',
    label: 'Age in Years (Demo)',
    definition: '[DEMO PLACEHOLDER: Elapsed time since birth in complete solar years]',
    datatype: 'number',
    unit: 'yr',
    measurement_type: 'time',
    allowed_range: { min: 0, max: 130 },
    population: 'General population',
    version: '1.0.0',
    status: 'EXPERIMENTAL',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  },
  {
    variable_id: 'VAR_DEMO_RESTING_METABOLIC_RATE',
    name: 'Resting Metabolic Rate',
    label: 'Estimated Resting Energy Expenditure (Demo)',
    definition: '[DEMO PLACEHOLDER: Estimated baseline daily energy turnover]',
    datatype: 'number',
    unit: 'kcal',
    measurement_type: 'energy',
    allowed_range: { min: 400, max: 5000 },
    version: '1.0.0',
    status: 'EXPERIMENTAL',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  },
  {
    variable_id: 'VAR_DEMO_SBP',
    name: 'Systolic Blood Pressure',
    label: 'Tekanan Darah Sistolik (SBP)',
    definition: 'Tekanan puncak pada arteri sistemik selama fase ejeksi sistolik ventrikel kiri.',
    datatype: 'number',
    unit: 'mmHg',
    measurement_type: 'pressure',
    allowed_range: { min: 50, max: 260, warning_min: 90, warning_max: 180 },
    population: 'Adult human',
    version: '1.0.0',
    status: 'EXPERIMENTAL',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  },
  {
    variable_id: 'VAR_DEMO_DBP',
    name: 'Diastolic Blood Pressure',
    label: 'Tekanan Darah Diastolik (DBP)',
    definition: 'Tekanan minimum pada arteri sistemik selama fase relaksasi diastolik ventrikel.',
    datatype: 'number',
    unit: 'mmHg',
    measurement_type: 'pressure',
    allowed_range: { min: 30, max: 150, warning_min: 60, warning_max: 110 },
    population: 'Adult human',
    version: '1.0.0',
    status: 'EXPERIMENTAL',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  }
];

export const DEMO_PARAMETERS: ScientificParameter[] = [
  {
    parameter_id: 'PARAM_DEMO_WEIGHT_EXPONENT',
    name: 'Weight Scaling Exponent (Demo)',
    description: '[DEMO ONLY - NOT SCIENTIFICALLY VERIFIED] Scaling power for body mass in demo calculation.',
    value: 1.0,
    unit: 'unitless',
    valid_range: { min: 0.5, max: 2.0 },
    reference_ids: ['REF_DEMO_001'],
    version: '1.0.0',
    status: 'EXPERIMENTAL',
    is_constant: false,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  },
  {
    parameter_id: 'PARAM_DEMO_HEIGHT_EXPONENT',
    name: 'Height Power Exponent (Demo)',
    description: '[DEMO ONLY - NOT SCIENTIFICALLY VERIFIED] Geometric dimensional power for height.',
    value: 2.0,
    unit: 'unitless',
    valid_range: { min: 1.0, max: 3.5 },
    reference_ids: ['REF_DEMO_001'],
    version: '1.0.0',
    status: 'EXPERIMENTAL',
    is_constant: false,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  },
  {
    parameter_id: 'PARAM_DEMO_BEE_BASE',
    name: 'Baseline Metabolic Coefficient (Demo)',
    description: '[DEMO ONLY - NOT SCIENTIFICALLY VERIFIED] Additive constant for demo energy model.',
    value: 500.0,
    unit: 'kcal',
    valid_range: { min: 0, max: 1000 },
    reference_ids: ['REF_DEMO_002'],
    version: '1.0.0',
    status: 'EXPERIMENTAL',
    is_constant: false,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  },
  {
    parameter_id: 'PARAM_BMR_SEX_OFFSET',
    name: 'Mifflin-St Jeor Sex-Specific Energy Offset',
    description: 'Sex-specific constant in the Mifflin-St Jeor basal metabolic rate equation (+5 kcal/day for males, -161 kcal/day for females).',
    value: 5.0,
    unit: 'kcal',
    valid_range: { min: -250, max: 50 },
    reference_ids: ['REF_DEMO_002'],
    version: '1.0.0',
    status: 'VERIFIED',
    is_constant: false,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  }
];

export const DEMO_FORMULAS: ScientificFormula[] = [
  {
    formula_id: 'FORMULA_DEMO_QUETELET',
    name: 'Demo Anthropometric Ratio Formula',
    description: '[DEMO ONLY - NOT SCIENTIFICALLY VERIFIED] Illustrative formula computing weight / (height ^ height_exponent).',
    version: '1.0.0',
    status: 'EXPERIMENTAL',
    inputs: [
      { variable_id: 'VAR_DEMO_WEIGHT', name: 'Weight', unit: 'kg', required: true, default_value: 70 },
      { variable_id: 'VAR_DEMO_HEIGHT', name: 'Height', unit: 'm', required: true, default_value: 1.75 }
    ],
    outputs: [
      { name: 'anthropometric_ratio', unit: 'kg/m^2', datatype: 'number', description: 'Calculated ratio' }
    ],
    parameter_ids: ['PARAM_DEMO_HEIGHT_EXPONENT'],
    expression_ast: {
      type: 'OPERATOR',
      op: 'DIVIDE',
      args: [
        { type: 'VARIABLE', variable_id: 'VAR_DEMO_WEIGHT', expected_unit: 'kg' },
        {
          type: 'OPERATOR',
          op: 'POWER',
          args: [
            { type: 'VARIABLE', variable_id: 'VAR_DEMO_HEIGHT', expected_unit: 'm' },
            { type: 'PARAMETER', parameter_id: 'PARAM_DEMO_HEIGHT_EXPONENT' }
          ]
        }
      ]
    },
    expression_string: 'Weight / (Height ^ PARAM_DEMO_HEIGHT_EXPONENT)',
    reference_ids: ['REF_DEMO_001'],
    assumptions: ['Standing posture stadiometry', 'Normohydrated state in demo test cohort'],
    limitations: ['Does not differentiate lean vs adipose tissue', 'Demo placeholder only'],
    validation_status: 'UNVERIFIED_DEMO',
    created_by: 'SYSTEM_SEEDED',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  },
  {
    formula_id: 'FORMULA_DEMO_LINEAR_RMR',
    name: 'Demo Energy Approximation Formula',
    description: '[DEMO ONLY - NOT SCIENTIFICALLY VERIFIED] Demonstrates multi-term additive expression with parameter offset: Base + (10 * Weight) + (6.25 * Height_cm) - (5 * Age).',
    version: '1.0.0',
    status: 'EXPERIMENTAL',
    inputs: [
      { variable_id: 'VAR_DEMO_WEIGHT', name: 'Weight', unit: 'kg', required: true, default_value: 70 },
      { variable_id: 'VAR_DEMO_HEIGHT', name: 'Height', unit: 'm', required: true, default_value: 1.75 },
      { variable_id: 'VAR_DEMO_AGE', name: 'Age', unit: 'yr', required: true, default_value: 25 }
    ],
    outputs: [
      { name: 'estimated_rmr', unit: 'kcal', datatype: 'number', description: 'Resting energy expenditure' }
    ],
    parameter_ids: ['PARAM_DEMO_BEE_BASE'],
    expression_ast: {
      type: 'OPERATOR',
      op: 'ADD',
      args: [
        { type: 'PARAMETER', parameter_id: 'PARAM_DEMO_BEE_BASE' },
        {
          type: 'OPERATOR',
          op: 'MULTIPLY',
          args: [
            { type: 'CONSTANT', value: 10 },
            { type: 'VARIABLE', variable_id: 'VAR_DEMO_WEIGHT' }
          ]
        },
        {
          type: 'OPERATOR',
          op: 'MULTIPLY',
          args: [
            { type: 'CONSTANT', value: 625 }, // 6.25 * 100 cm/m = 625 * height_m
            { type: 'VARIABLE', variable_id: 'VAR_DEMO_HEIGHT' }
          ]
        },
        {
          type: 'OPERATOR',
          op: 'MULTIPLY',
          args: [
            { type: 'CONSTANT', value: -5 },
            { type: 'VARIABLE', variable_id: 'VAR_DEMO_AGE' }
          ]
        }
      ]
    },
    expression_string: 'PARAM_DEMO_BEE_BASE + (10 * Weight) + (625 * Height_m) - (5 * Age)',
    reference_ids: ['REF_DEMO_002'],
    assumptions: ['Thermal neutrality', 'Fasting state >= 12h for test subjects'],
    limitations: ['Crude demographic model for platform testing only'],
    validation_status: 'UNVERIFIED_DEMO',
    created_by: 'SYSTEM_SEEDED',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  },
  {
    formula_id: 'FORMULA_BMI_QUETELET',
    name: 'Indeks Massa Tubuh (BMI / Body Mass Index - Quetelet)',
    description: 'Standar antropometri WHO untuk klasifikasi status gizi berdasarkan rasio Berat Badan (kg) terhadap kuadrat Tinggi Badan (m^2): Weight / (Height ^ 2).',
    version: '1.2.0',
    status: 'VERIFIED',
    inputs: [
      { variable_id: 'VAR_DEMO_WEIGHT', name: 'Berat Badan', unit: 'kg', required: true, default_value: 70 },
      { variable_id: 'VAR_DEMO_HEIGHT', name: 'Tinggi Badan', unit: 'm', required: true, default_value: 1.75 }
    ],
    outputs: [
      { name: 'bmi_index', unit: 'kg/m^2', datatype: 'number', description: 'Indeks Massa Tubuh (kg/m^2)' }
    ],
    parameter_ids: ['PARAM_DEMO_HEIGHT_EXPONENT'],
    expression_ast: {
      type: 'OPERATOR',
      op: 'DIVIDE',
      args: [
        { type: 'VARIABLE', variable_id: 'VAR_DEMO_WEIGHT', expected_unit: 'kg' },
        {
          type: 'OPERATOR',
          op: 'POWER',
          args: [
            { type: 'VARIABLE', variable_id: 'VAR_DEMO_HEIGHT', expected_unit: 'm' },
            { type: 'PARAMETER', parameter_id: 'PARAM_DEMO_HEIGHT_EXPONENT' }
          ]
        }
      ]
    },
    expression_string: 'Weight / (Height ^ PARAM_DEMO_HEIGHT_EXPONENT)',
    reference_ids: ['REF_DEMO_001'],
    assumptions: ['Postur berdiri tegak standar stadiometri', 'Status hidrasi normovolemik'],
    limitations: ['Tidak membedakan proporsi massa otot (FFM) vs adiposa'],
    validation_status: 'CLINICALLY_VERIFIED',
    created_by: 'WHO_STANDARD',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  },
  {
    module_id: 'FORMULA_BMR_MIFFLIN',
    module_type: 'FORMULA',
    formula_id: 'FORMULA_BMR_MIFFLIN',
    name: 'Laju Metabolisme Basal (BMR - Mifflin-St Jeor)',
    description: 'Standar emas klinis estimasi pengeluaran energi basal (BMR/REE): (10 * Berat_kg) + (625 * Tinggi_m) - (5 * Usia) + Sex_Offset (+5 Pria / -161 Wanita).',
    version: '1.2.0',
    status: 'VERIFIED',
    inputs: [
      { variable_id: 'VAR_DEMO_WEIGHT', name: 'Berat Badan', unit: 'kg', required: true, default_value: 70 },
      { variable_id: 'VAR_DEMO_HEIGHT', name: 'Tinggi Badan', unit: 'm', required: true, default_value: 1.75 },
      { variable_id: 'VAR_DEMO_AGE', name: 'Usia Kronologis', unit: 'yr', required: true, default_value: 28 }
    ],
    outputs: [
      { name: 'bmr_kcal', unit: 'kcal/day', datatype: 'number', description: 'Pengeluaran Energi Basal Harian' }
    ],
    parameter_ids: ['PARAM_BMR_SEX_OFFSET'],
    expression_ast: {
      type: 'OPERATOR',
      op: 'ADD',
      args: [
        {
          type: 'OPERATOR',
          op: 'MULTIPLY',
          args: [
            { type: 'CONSTANT', value: 10 },
            { type: 'VARIABLE', variable_id: 'VAR_DEMO_WEIGHT' }
          ]
        },
        {
          type: 'OPERATOR',
          op: 'MULTIPLY',
          args: [
            { type: 'CONSTANT', value: 625 },
            { type: 'VARIABLE', variable_id: 'VAR_DEMO_HEIGHT' }
          ]
        },
        {
          type: 'OPERATOR',
          op: 'MULTIPLY',
          args: [
            { type: 'CONSTANT', value: -5 },
            { type: 'VARIABLE', variable_id: 'VAR_DEMO_AGE' }
          ]
        },
        { type: 'PARAMETER', parameter_id: 'PARAM_BMR_SEX_OFFSET' }
      ]
    },
    expression_string: '(10 * Weight) + (625 * Height_m) - (5 * Age) + Sex_Offset',
    reference_ids: ['REF_DEMO_002'],
    assumptions: ['Suhu lingkungan termonetral', 'Puasa post-absorptif minimal 12 jam'],
    limitations: ['Sensitivitas berkurang pada atlet dengan massa otot ekstrim'],
    validation_status: 'CLINICALLY_VERIFIED',
    created_by: 'MIFFLIN_1990',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  },
  {
    formula_id: 'FORMULA_MAP_HEMODYNAMICS',
    name: 'Tekanan Arteri Rata-rata (MAP - Mean Arterial Pressure)',
    description: 'Tekanan perfusi organ vaskular rata-rata dalam satu siklus jantung: DBP + (SBP - DBP) / 3.',
    version: '1.0.0',
    status: 'VERIFIED',
    inputs: [
      { variable_id: 'VAR_DEMO_SBP', name: 'Tekanan Sistolik (SBP)', unit: 'mmHg', required: true, default_value: 120 },
      { variable_id: 'VAR_DEMO_DBP', name: 'Tekanan Diastolik (DBP)', unit: 'mmHg', required: true, default_value: 80 }
    ],
    outputs: [
      { name: 'map_pressure', unit: 'mmHg', datatype: 'number', description: 'Tekanan Arteri Rata-Rata (mmHg)' }
    ],
    parameter_ids: [],
    expression_ast: {
      type: 'OPERATOR',
      op: 'ADD',
      args: [
        { type: 'VARIABLE', variable_id: 'VAR_DEMO_DBP' },
        {
          type: 'OPERATOR',
          op: 'DIVIDE',
          args: [
            {
              type: 'OPERATOR',
              op: 'SUBTRACT',
              args: [
                { type: 'VARIABLE', variable_id: 'VAR_DEMO_SBP' },
                { type: 'VARIABLE', variable_id: 'VAR_DEMO_DBP' }
              ]
            },
            { type: 'CONSTANT', value: 3 }
          ]
        }
      ]
    },
    expression_string: 'DBP + ((SBP - DBP) / 3)',
    reference_ids: ['REF_DEMO_001'],
    assumptions: ['Irama sinus jantung teratur', 'Pemeriksaan tensimeter tervalidasi'],
    limitations: ['Perkiraan berkurang akurasinya pada takikardia berat (>120 bpm)'],
    validation_status: 'CLINICALLY_VERIFIED',
    created_by: 'GUYTON_HALL',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  }
];

export const DEMO_MODELS: ScientificModel[] = [
  {
    model_id: 'MODEL_DEMO_ANTHROPOMETRY_V1',
    name: 'Demo Anthropometric & Bioenergetic Baseline Model',
    description: '[DEMO ONLY - NOT SCIENTIFICALLY VERIFIED] Composite baseline model integrating demo ratio and metabolic calculation modules.',
    version: '1.0.0',
    status: 'EXPERIMENTAL',
    is_verified: false,
    variable_ids: ['VAR_DEMO_WEIGHT', 'VAR_DEMO_HEIGHT', 'VAR_DEMO_AGE', 'VAR_DEMO_RESTING_METABOLIC_RATE'],
    formula_ids: ['FORMULA_DEMO_QUETELET', 'FORMULA_DEMO_LINEAR_RMR'],
    algorithm_ids: [],
    parameter_ids: ['PARAM_DEMO_HEIGHT_EXPONENT', 'PARAM_DEMO_BEE_BASE'],
    reference_ids: ['REF_DEMO_001', 'REF_DEMO_002'],
    assumptions: [
      'Adult subjects aged 18-65',
      'Normal environmental conditions',
      'Infrastructure demo testing only'
    ],
    validation_criteria: 'Benchmarked against numerical integration unit tests',
    created_by: 'SYSTEM_SEEDED',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  }
];

export const DEMO_INTERPRETATION_RULES: InterpretationRule[] = [
  {
    module_id: 'RULE_BMI_WHO_ADULT',
    module_type: 'INTERPRETATION',
    rule_id: 'RULE_BMI_WHO_ADULT',
    name: 'Klasifikasi Status Gizi Indeks Massa Tubuh Dewasa (WHO 2000)',
    description: 'Pedoman klasifikasi berat badan berdasarkan indeks massa tubuh untuk populasi dewasa usia ≥18 tahun (WHO Technical Report Series 854).',
    version: '1.0.0',
    status: 'VERIFIED',
    target_variable_or_metric: 'VAR_DEMO_BMI',
    unit: 'kg/m²',
    population: 'Adults (age >= 18)',
    reference_ids: ['REF_DEMO_001'],
    thresholds: [
      {
        label: 'Underweight',
        max: 18.49,
        max_inclusive: true,
        clinical_status: 'Gizi Kurang (Underweight)',
        badge_color: 'amber',
        description: 'Indeks massa tubuh di bawah ambang batas fisiologis normal; risiko defisiensi makronutrien dan penurunan imunitas.'
      },
      {
        label: 'Normal weight',
        min: 18.5,
        max: 24.99,
        min_inclusive: true,
        max_inclusive: true,
        clinical_status: 'Gizi Normal / Optimal',
        badge_color: 'emerald',
        description: 'Rentang berat badan optimal dengan risiko mortalitas dan morbiditas kardiometabolik terendah.'
      },
      {
        label: 'Overweight',
        min: 25.0,
        max: 29.99,
        min_inclusive: true,
        max_inclusive: true,
        clinical_status: 'Kelebihan Berat Badan (Overweight)',
        badge_color: 'amber',
        description: 'Peningkatan akumulasi adiposa pra-obesitas; indikasi peningkatan resistensi insulin dan beban biomekanik.'
      },
      {
        label: 'Obesity Class I',
        min: 30.0,
        max: 34.99,
        min_inclusive: true,
        max_inclusive: true,
        clinical_status: 'Obesitas Tingkat I',
        badge_color: 'rose',
        description: 'Akumulasi jaringan adiposa patologis sedang; peningkatan risiko aterosklerosis dan sindrom metabolik.'
      },
      {
        label: 'Obesity Class II/III',
        min: 35.0,
        min_inclusive: true,
        clinical_status: 'Obesitas Tingkat II/III (Berat)',
        badge_color: 'red',
        description: 'Obesitas klinis tingkat lanjut; risiko tinggi komorbiditas kardiometabolik, kardiovaskular, dan apnea tidur obstruktif.'
      }
    ],
    created_by: 'WHO_TRS_854',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  },
  {
    module_id: 'RULE_MAP_CLINICAL_PERFUSION',
    module_type: 'INTERPRETATION',
    rule_id: 'RULE_MAP_CLINICAL_PERFUSION',
    name: 'Kriteria Perfusi Hemodinamik Tekanan Arteri Rata-rata (MAP)',
    description: 'Evaluasi kecukupan tekanan perfusi koroner dan mikrosirkulasi organ vital sistemik (Guyton and Hall Textbook of Medical Physiology).',
    version: '1.0.0',
    status: 'VERIFIED',
    target_variable_or_metric: 'VAR_DEMO_MAP',
    unit: 'mmHg',
    population: 'Adults',
    reference_ids: ['REF_DEMO_001'],
    thresholds: [
      {
        label: 'Low Perfusion',
        max: 64.99,
        max_inclusive: true,
        clinical_status: 'Hipotensi / Risiko Hipoperfusi Jaringan',
        badge_color: 'red',
        description: 'Tekanan perfusi organ kritis (terutama ginjal dan serebral) berisiko terganggu jika MAP bertahan di bawah 65 mmHg.'
      },
      {
        label: 'Adequate Perfusion',
        min: 65.0,
        max: 100.0,
        min_inclusive: true,
        max_inclusive: true,
        clinical_status: 'Perfusi Organ Vital Adekuat (Normal)',
        badge_color: 'emerald',
        description: 'Gradien perfusi arteri sistemik berada dalam rentang hemodinamika fisiologis optimal.'
      },
      {
        label: 'Elevated Perfusion Load',
        min: 100.01,
        min_inclusive: true,
        clinical_status: 'Beban Vaskular Meningkat / Hipertensi',
        badge_color: 'amber',
        description: 'Beban afterload ventrikel kiri dan resistensi perifer sistemik meningkat; indikasi hipertensi vaskular.'
      }
    ],
    created_by: 'GUYTON_HALL_HEMODYNAMICS',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  }
];
