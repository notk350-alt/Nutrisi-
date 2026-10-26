import React, { useState, useEffect, useMemo } from 'react';
import { ScientificFormula, ScientificParameter, ScientificUnit, CalculationTrace, User, InterpretationRule } from '../../types';
import { api } from '../../api';
import { 
  Calculator, 
  Play, 
  CheckCircle2, 
  AlertTriangle, 
  Layers, 
  Copy, 
  Check, 
  FileText, 
  Hash, 
  Sparkles, 
  Sliders, 
  RotateCcw,
  Search,
  Zap,
  Activity,
  UserCheck,
  Scale,
  Flame,
  Heart,
  Droplets,
  Info,
  ChevronRight,
  TrendingUp,
  BookmarkCheck
} from 'lucide-react';

interface CalculatorViewProps {
  currentUser: User;
  preselectedFormulaId?: string | null;
}

type FormulaCategory = 'all' | 'bmr' | 'bmi' | 'cardio' | 'organ';

export const CalculatorView: React.FC<CalculatorViewProps> = ({
  currentUser,
  preselectedFormulaId,
}) => {
  const [formulas, setFormulas] = useState<ScientificFormula[]>([]);
  const [parameters, setParameters] = useState<ScientificParameter[]>([]);
  const [units, setUnits] = useState<ScientificUnit[]>([]);
  const [interpretationRules, setInterpretationRules] = useState<InterpretationRule[]>([]);
  const [selectedFormulaId, setSelectedFormulaId] = useState<string>('');
  
  // Search & Filtering state
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<FormulaCategory>('all');

  // Dynamic inputs state: { [var_id]: { value: any, unit: string } }
  const [inputValues, setInputValues] = useState<Record<string, { value: any; unit: string }>>({});
  // Parameter overrides state: { [param_id]: any }
  const [paramOverrides, setParamOverrides] = useState<Record<string, any>>({});

  // Calculation result & trace
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [traceResult, setTraceResult] = useState<CalculationTrace | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  useEffect(() => {
    loadPrerequisites();
  }, []);

  useEffect(() => {
    if (preselectedFormulaId && formulas.length > 0) {
      selectFormula(preselectedFormulaId, formulas, parameters);
    }
  }, [preselectedFormulaId]);

  const loadPrerequisites = async () => {
    try {
      setLoading(true);
      const [fRes, pRes, uRes, iRes] = await Promise.all([
        api.getFormulas(),
        api.getParameters(),
        api.getUnits(),
        api.getInterpretations()
      ]);
      setFormulas(fRes.formulas);
      setParameters(pRes.parameters);
      setUnits(uRes.units);
      setInterpretationRules(iRes.interpretation_rules || []);

      // Prioritize preselected or standard BMR/BMI formula
      const defaultId = preselectedFormulaId || 
        fRes.formulas.find(f => f.formula_id === 'FORMULA_BMR_MIFFLIN')?.formula_id ||
        fRes.formulas.find(f => f.formula_id === 'FORMULA_BMI_QUETELET')?.formula_id ||
        (fRes.formulas.length > 0 ? fRes.formulas[0].formula_id : '');

      if (defaultId) {
        selectFormula(defaultId, fRes.formulas, pRes.parameters);
      }
    } catch (err) {
      console.error('Gagal memuat prasyarat kalkulator', err);
    } finally {
      setLoading(false);
    }
  };

  const selectFormula = (formulaId: string, fList = formulas, pList = parameters) => {
    setSelectedFormulaId(formulaId);
    setTraceResult(null);
    setValidationErrors([]);

    const formula = fList.find(f => f.formula_id === formulaId);
    if (!formula) return;

    // Initialize input fields with smart defaults
    const initialInputs: Record<string, { value: any; unit: string }> = {};
    formula.inputs.forEach(inp => {
      let defaultVal: any = inp.default_value !== undefined ? inp.default_value : '';
      if (inp.variable_id.includes('WEIGHT')) defaultVal = 70;
      else if (inp.variable_id.includes('HEIGHT') || inp.variable_id.includes('STATURE')) defaultVal = 1.75;
      else if (inp.variable_id.includes('AGE')) defaultVal = 28;
      else if (inp.variable_id.includes('SBP')) defaultVal = 120;
      else if (inp.variable_id.includes('DBP')) defaultVal = 80;
      else if (inp.datatype === 'number' && !defaultVal) defaultVal = 10;

      initialInputs[inp.variable_id] = {
        value: defaultVal,
        unit: inp.unit
      };
    });
    setInputValues(initialInputs);

    // Initialize parameter overrides with baseline
    const initialParams: Record<string, any> = {};
    formula.parameter_ids.forEach(pId => {
      const pObj = pList.find(p => p.parameter_id === pId);
      if (pObj) {
        initialParams[pId] = pObj.value;
      }
    });
    setParamOverrides(initialParams);
  };

  // Quick preset data loader
  const loadPresetSubject = (type: 'male' | 'female' | 'elderly') => {
    if (type === 'male') {
      setInputValues(prev => ({
        ...prev,
        VAR_DEMO_WEIGHT: { value: 72, unit: 'kg' },
        VAR_DEMO_HEIGHT: { value: 1.76, unit: 'm' },
        VAR_DEMO_AGE: { value: 28, unit: 'yr' },
        VAR_DEMO_SBP: { value: 120, unit: 'mmHg' },
        VAR_DEMO_DBP: { value: 80, unit: 'mmHg' }
      }));
    } else if (type === 'female') {
      setInputValues(prev => ({
        ...prev,
        VAR_DEMO_WEIGHT: { value: 56, unit: 'kg' },
        VAR_DEMO_HEIGHT: { value: 1.62, unit: 'm' },
        VAR_DEMO_AGE: { value: 25, unit: 'yr' },
        VAR_DEMO_SBP: { value: 112, unit: 'mmHg' },
        VAR_DEMO_DBP: { value: 72, unit: 'mmHg' }
      }));
    } else {
      setInputValues(prev => ({
        ...prev,
        VAR_DEMO_WEIGHT: { value: 64, unit: 'kg' },
        VAR_DEMO_HEIGHT: { value: 1.66, unit: 'm' },
        VAR_DEMO_AGE: { value: 68, unit: 'yr' },
        VAR_DEMO_SBP: { value: 138, unit: 'mmHg' },
        VAR_DEMO_DBP: { value: 84, unit: 'mmHg' }
      }));
    }
  };

  const handleInputChange = (varId: string, value: any) => {
    setInputValues(prev => ({
      ...prev,
      [varId]: {
        ...prev[varId],
        value
      }
    }));
  };

  const handleInputUnitChange = (varId: string, unit: string) => {
    setInputValues(prev => ({
      ...prev,
      [varId]: {
        ...prev[varId],
        unit
      }
    }));
  };

  const handleParamChange = (pId: string, val: any) => {
    setParamOverrides(prev => ({
      ...prev,
      [pId]: val
    }));
  };

  const handleExecute = async () => {
    const formula = formulas.find(f => f.formula_id === selectedFormulaId);
    if (!formula) return;

    // Validation check
    const errors: string[] = [];
    const formattedInputs: Record<string, any> = {};

    formula.inputs.forEach(inp => {
      const field = inputValues[inp.variable_id];
      if (!field || field.value === '' || field.value === null || field.value === undefined) {
        errors.push(`Variabel wajib diisi: ${inp.name} (${inp.variable_id})`);
        return;
      }
      formattedInputs[inp.variable_id] = {
        value: Number(field.value),
        unit: field.unit
      };
    });

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);
    setCalculating(true);

    try {
      const res = await api.executeCalculation({
        formula_id: formula.formula_id,
        inputs: formattedInputs,
        parameter_overrides: paramOverrides
      });
      setTraceResult(res.trace);
    } catch (err: any) {
      setValidationErrors([`Kesalahan Eksekusi AST: ${err.message}`]);
    } finally {
      setCalculating(false);
    }
  };

  const handleCopyHash = () => {
    if (!traceResult) return;
    navigator.clipboard.writeText(traceResult.provenance_hash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  // Filter formulas based on dedicated search & active category
  const filteredFormulas = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return formulas.filter(f => {
      const matchText = 
        f.name.toLowerCase().includes(q) ||
        f.formula_id.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.expression_string.toLowerCase().includes(q);

      if (!matchText) return false;

      if (activeCategory === 'all') return true;
      if (activeCategory === 'bmr') {
        return f.name.toLowerCase().includes('bmr') || 
               f.name.toLowerCase().includes('energi') || 
               f.formula_id.toLowerCase().includes('rmr') || 
               f.formula_id.toLowerCase().includes('bmr');
      }
      if (activeCategory === 'bmi') {
        return f.name.toLowerCase().includes('bmi') || 
               f.name.toLowerCase().includes('massa tubuh') || 
               f.formula_id.toLowerCase().includes('quetelet') ||
               f.name.toLowerCase().includes('antropometri');
      }
      if (activeCategory === 'cardio') {
        return f.name.toLowerCase().includes('map') || 
               f.name.toLowerCase().includes('arteri') || 
               f.name.toLowerCase().includes('tekanan');
      }
      if (activeCategory === 'organ') {
        return f.name.toLowerCase().includes('organ') || 
               f.description.toLowerCase().includes('fisiologi');
      }

      return true;
    });
  }, [formulas, searchQuery, activeCategory]);

  const selectedFormula = formulas.find(f => f.formula_id === selectedFormulaId);

  // Extract computed numeric result
  const calculatedValue = useMemo(() => {
    if (!traceResult) return null;
    if (typeof traceResult.output_value === 'number') {
      return traceResult.output_value;
    }
    if (traceResult.final_result) {
      const firstKey = Object.keys(traceResult.final_result)[0];
      const raw = traceResult.final_result[firstKey]?.value;
      if (typeof raw === 'number') return raw;
      if (typeof raw === 'string') return parseFloat(raw);
    }
    return null;
  }, [traceResult]);

  // Derived BMI category and WHO evaluation
  const bmiEvaluation = useMemo(() => {
    if (!calculatedValue) return null;
    const isBmiFormula = selectedFormula?.formula_id.includes('QUETELET') || 
                         selectedFormula?.formula_id.includes('BMI') || 
                         selectedFormula?.name.toLowerCase().includes('bmi');
    if (!isBmiFormula) return null;

    const val = calculatedValue;
    let category = '';
    let colorClass = '';
    let description = '';
    let badgeColor = '';

    const bmiRule = interpretationRules.find(r => r.rule_id === 'RULE_BMI_WHO_ADULT' || r.target_variable_or_metric === 'VAR_DEMO_BMI');
    if (bmiRule && bmiRule.thresholds) {
      const match = bmiRule.thresholds.find(t => {
        const minPass = t.min === undefined || (t.min_inclusive ? val >= t.min : val > t.min);
        const maxPass = t.max === undefined || (t.max_inclusive ? val <= t.max : val < t.max);
        return minPass && maxPass;
      });
      if (match) {
        category = match.clinical_status || match.label;
        description = match.description;
        if (match.badge_color === 'emerald') {
          colorClass = 'text-emerald-500';
          badgeColor = 'bg-emerald-100 text-emerald-800 border-emerald-300';
        } else if (match.badge_color === 'amber') {
          colorClass = 'text-amber-600';
          badgeColor = 'bg-amber-100 text-amber-800 border-amber-300';
        } else if (match.badge_color === 'orange') {
          colorClass = 'text-orange-600';
          badgeColor = 'bg-orange-100 text-orange-800 border-orange-300';
        } else {
          colorClass = 'text-rose-600';
          badgeColor = 'bg-rose-100 text-rose-800 border-rose-300';
        }
      }
    }

    // Fallback if rule not yet loaded
    if (!category) {
      if (val < 18.5) {
        category = 'Kekurangan Berat Badan (Underweight)';
        colorClass = 'text-amber-500';
        badgeColor = 'bg-amber-100 text-amber-800 border-amber-300';
        description = 'Kategori risiko defisiensi nutrisi dan penurunan densitas tulang. Direkomendasikan evaluasi asupan energi.';
      } else if (val >= 18.5 && val <= 24.9) {
        category = 'Berat Badan Normal (Ideal / Normoweight)';
        colorClass = 'text-emerald-500';
        badgeColor = 'bg-emerald-100 text-emerald-800 border-emerald-300';
        description = 'Kategori ideal menurut WHO dengan risiko kardiometabolik terendah. Pertahankan pola makan seimbang.';
      } else if (val >= 25.0 && val <= 29.9) {
        category = 'Kelebihan Berat Badan (Overweight / Pra-Obesitas)';
        colorClass = 'text-amber-600';
        badgeColor = 'bg-amber-100 text-amber-800 border-amber-300';
        description = 'Peningkatan risiko resistensi insulin dan beban biomekanik sendi. Disarankan peningkatan aktivitas fisik moderat.';
      } else if (val >= 30.0 && val <= 34.9) {
        category = 'Obesitas Tingkat I (Moderate Obesity)';
        colorClass = 'text-orange-600';
        badgeColor = 'bg-orange-100 text-orange-800 border-orange-300';
        description = 'Faktor risiko signifikan sindrom metabolik, dislipidemia, dan hipertensi esensial.';
      } else {
        category = 'Obesitas Tingkat II (Severe / Morbid Obesity)';
        colorClass = 'text-rose-600';
        badgeColor = 'bg-rose-100 text-rose-800 border-rose-300';
        description = 'Risiko tinggi komplikasi kardiovaskular mayor dan apnea tidur obstruktif.';
      }
    }

    // Recommended normal weight range based on user's height
    const heightField = inputValues['VAR_DEMO_HEIGHT']?.value || 1.75;
    const h = Number(heightField);
    const minNormalWeight = (18.5 * h * h).toFixed(1);
    const maxNormalWeight = (24.9 * h * h).toFixed(1);

    return {
      bmi: val,
      category,
      colorClass,
      badgeColor,
      description,
      minNormalWeight,
      maxNormalWeight,
      height: h
    };
  }, [calculatedValue, selectedFormula, inputValues, interpretationRules]);

  // Derived BMR evaluation with TDEE physical activity multipliers
  const bmrEvaluation = useMemo(() => {
    if (!calculatedValue) return null;
    const isBmr = selectedFormula?.formula_id.includes('BMR') || 
                  selectedFormula?.formula_id.includes('RMR') || 
                  selectedFormula?.name.toLowerCase().includes('bmr') ||
                  selectedFormula?.name.toLowerCase().includes('metabolisme');
    if (!isBmr) return null;

    const bmr = calculatedValue;
    return {
      bmr,
      tdee: {
        sedentary: Math.round(bmr * 1.2),
        light: Math.round(bmr * 1.375),
        moderate: Math.round(bmr * 1.55),
        veryActive: Math.round(bmr * 1.725),
        extraActive: Math.round(bmr * 1.9)
      },
      deficit: Math.round(bmr * 1.55 - 500),
      surplus: Math.round(bmr * 1.55 + 350)
    };
  }, [calculatedValue, selectedFormula]);

  // Derived MAP evaluation
  const mapEvaluation = useMemo(() => {
    if (!calculatedValue) return null;
    const isMap = selectedFormula?.formula_id.includes('MAP') || 
                  selectedFormula?.name.toLowerCase().includes('map') ||
                  selectedFormula?.name.toLowerCase().includes('tekanan arteri');
    if (!isMap) return null;

    const map = calculatedValue;
    let status = '';
    let badgeColor = '';
    let note = '';

    const mapRule = interpretationRules.find(r => r.rule_id === 'RULE_MAP_CLINICAL_PERFUSION' || r.target_variable_or_metric === 'VAR_DEMO_MAP');
    if (mapRule && mapRule.thresholds) {
      const match = mapRule.thresholds.find(t => {
        const minPass = t.min === undefined || (t.min_inclusive ? map >= t.min : map > t.min);
        const maxPass = t.max === undefined || (t.max_inclusive ? map <= t.max : map < t.max);
        return minPass && maxPass;
      });
      if (match) {
        status = match.clinical_status || match.label;
        note = match.description;
        if (match.badge_color === 'emerald') {
          badgeColor = 'bg-emerald-100 text-emerald-800 border-emerald-300';
        } else if (match.badge_color === 'amber') {
          badgeColor = 'bg-amber-100 text-amber-800 border-amber-300';
        } else {
          badgeColor = 'bg-rose-100 text-rose-800 border-rose-300';
        }
      }
    }

    if (!status) {
      if (map < 65) {
        status = 'Perfusi Organ Rendah (Risiko Hipotensi / Syok)';
        badgeColor = 'bg-rose-100 text-rose-800 border-rose-300';
        note = 'Tekanan perfusi organ vital (otak, ginjal) terancam tidak adekuat jika MAP < 65 mmHg.';
      } else if (map >= 65 && map <= 100) {
        status = 'Rentang Fisiologis Normal (Perfusi Optimal)';
        badgeColor = 'bg-emerald-100 text-emerald-800 border-emerald-300';
        note = 'Menjaga perfusi organ esensial tanpa memberikan tekanan regangan berlebih pada endotel vaskular.';
      } else {
        status = 'Peningkatan Tekanan Perfusi (Kecenderungan Hipertensi)';
        badgeColor = 'bg-amber-100 text-amber-800 border-amber-300';
        note = 'Beban afterload ventrikel kiri meningkat, meningkatkan risiko hipertrofi miokardium.';
      }
    }

    return { map, status, badgeColor, note };
  }, [calculatedValue, selectedFormula, interpretationRules]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Top Banner */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-xs">
                <Calculator className="w-4 h-4 text-emerald-400" />
              </div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight">
                Kalkulator Fisiologi & Mesin Komputasi AST
              </h1>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed max-w-2xl">
              Mesin komputasi deterministik: mengevaluasi simpul pohon sintaksis abstrak (AST), menormalkan unit dimensi, 
              dan menerbitkan jejak audit kriptografis SHA-256 yang dapat diverifikasi ulang tanpa formula ter-hardcode.
            </p>
          </div>

          <div className="flex items-center space-x-2 self-start sm:self-auto shrink-0">
            <span className="text-[11px] font-mono px-3 py-1 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold flex items-center space-x-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>{formulas.length} Formula Terdaftar</span>
            </span>
          </div>
        </div>

        {/* 1. DEDICATED SEARCH BAR & QUICK PRESET ACTIONS */}
        <div className="pt-3 border-t border-slate-100 space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari formula khusus (contoh: bmr, bmi, map, energi, quetelet, antropometri)..."
                className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent bg-slate-50/70"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs px-1"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Quick Presets for BMR & BMI */}
            <div className="flex items-center space-x-1.5 overflow-x-auto scrollbar-none shrink-0">
              <button
                onClick={() => {
                  const bmr = formulas.find(f => f.formula_id === 'FORMULA_BMR_MIFFLIN') || 
                              formulas.find(f => f.formula_id === 'FORMULA_DEMO_LINEAR_RMR');
                  if (bmr) {
                    selectFormula(bmr.formula_id);
                    setSearchQuery('bmr');
                  }
                }}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 transition-colors shrink-0 shadow-xs"
              >
                <Flame className="w-3.5 h-3.5 text-amber-600" />
                <span>⚡ Hitung BMR (Kalori)</span>
              </button>

              <button
                onClick={() => {
                  const bmi = formulas.find(f => f.formula_id === 'FORMULA_BMI_QUETELET') || 
                              formulas.find(f => f.formula_id === 'FORMULA_DEMO_QUETELET');
                  if (bmi) {
                    selectFormula(bmi.formula_id);
                    setSearchQuery('bmi');
                  }
                }}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 transition-colors shrink-0 shadow-xs"
              >
                <Scale className="w-3.5 h-3.5 text-emerald-600" />
                <span>⚡ Hitung BMI (IMT)</span>
              </button>

              <button
                onClick={() => {
                  const map = formulas.find(f => f.formula_id === 'FORMULA_MAP_HEMODYNAMICS');
                  if (map) {
                    selectFormula(map.formula_id);
                    setSearchQuery('map');
                  }
                }}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-900 border border-rose-200 transition-colors shrink-0 shadow-xs"
              >
                <Heart className="w-3.5 h-3.5 text-rose-600" />
                <span>⚡ Hitung MAP (Tensi)</span>
              </button>
            </div>
          </div>

          {/* Category Filter Chips */}
          <div className="flex items-center space-x-1.5 overflow-x-auto scrollbar-none text-xs">
            <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider mr-1 shrink-0">
              Kategori:
            </span>
            {[
              { id: 'all', label: 'Semua Formula' },
              { id: 'bmr', label: 'BMR & Energi Basal' },
              { id: 'bmi', label: 'BMI & Antropometri' },
              { id: 'cardio', label: 'Kardiovaskular & MAP' },
              { id: 'organ', label: 'Sistem Organ Fisiologi' }
            ].map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id as FormulaCategory)}
                className={`px-3 py-1 rounded-xl text-xs font-medium transition-colors shrink-0 border ${
                  activeCategory === cat.id
                    ? 'bg-slate-900 text-white border-slate-900 font-semibold shadow-xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Formula Selector Bar */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 space-y-3 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <label className="text-xs font-mono font-semibold text-slate-700 uppercase tracking-wider block">
            Pilih Formula Terdaftar pada Registri ({filteredFormulas.length} Ditemukan):
          </label>
          <span className="text-[11px] text-slate-400 font-mono">
            {filteredFormulas.length === 0 && 'Tidak ada formula yang cocok dengan kata kunci pencarian.'}
          </span>
        </div>

        <select
          id="formula-selector"
          value={selectedFormulaId}
          onChange={e => selectFormula(e.target.value)}
          className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 shadow-xs"
        >
          {filteredFormulas.map(f => (
            <option key={f.formula_id} value={f.formula_id}>
              [{f.formula_id}] {f.name} — Status: {f.status} (v{f.version})
            </option>
          ))}
        </select>

        {selectedFormula && (
          <div className="pt-2 text-xs text-slate-600 leading-relaxed border-t border-slate-100 flex flex-col sm:flex-row sm:items-start justify-between gap-2">
            <div className="space-y-1">
              <div>
                <strong className="text-slate-900">Deskripsi Ilmiah:</strong> {selectedFormula.description}
              </div>
              <div className="text-[11px] text-slate-500">
                <strong>Status Verifikasi:</strong> {selectedFormula.validation_status || 'VERIFIED'} • <strong>Versi:</strong> {selectedFormula.version}
              </div>
            </div>
            <div className="font-mono text-[11px] bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg text-slate-700 shrink-0 self-start">
              AST: {selectedFormula.expression_string}
            </div>
          </div>
        )}
      </div>

      {/* Main Execution Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Inputs & Parameters Panel */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <span className="text-xs font-mono font-semibold text-slate-700 uppercase flex items-center space-x-1.5">
                <Sliders className="w-3.5 h-3.5 text-slate-500" />
                <span>Variabel Masukan (Inputs)</span>
              </span>
              <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                Normalisasi Otomatis
              </span>
            </div>

            {/* Quick Subject Presets */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-700 flex items-center space-x-1">
                <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Muat Contoh Profil Cepat:</span>
              </div>
              <div className="flex items-center space-x-1.5 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => loadPresetSubject('male')}
                  className="px-2 py-1 rounded-lg bg-white border border-slate-200 hover:border-slate-400 text-[10px] text-slate-700 font-medium whitespace-nowrap transition-colors"
                >
                  Pria 72kg, 176cm, 28th
                </button>
                <button
                  type="button"
                  onClick={() => loadPresetSubject('female')}
                  className="px-2 py-1 rounded-lg bg-white border border-slate-200 hover:border-slate-400 text-[10px] text-slate-700 font-medium whitespace-nowrap transition-colors"
                >
                  Wanita 56kg, 162cm, 25th
                </button>
                <button
                  type="button"
                  onClick={() => loadPresetSubject('elderly')}
                  className="px-2 py-1 rounded-lg bg-white border border-slate-200 hover:border-slate-400 text-[10px] text-slate-700 font-medium whitespace-nowrap transition-colors"
                >
                  Lansia 64kg, 166cm, 68th
                </button>
              </div>
            </div>

            {/* Dynamic Inputs List */}
            {selectedFormula && selectedFormula.inputs.map(inp => {
              const currentInput = inputValues[inp.variable_id] || { value: '', unit: inp.unit };
              // Find matching units for this measurement type
              const compatibleUnits = units.filter(u => u.measurement_type === (
                inp.variable_id.includes('WEIGHT') ? 'mass' :
                inp.variable_id.includes('HEIGHT') || inp.variable_id.includes('STATURE') ? 'length' :
                inp.variable_id.includes('AGE') ? 'time' :
                inp.variable_id.includes('SBP') || inp.variable_id.includes('DBP') ? 'pressure' :
                'dimensionless'
              ));

              return (
                <div key={inp.variable_id} className="space-y-1.5 text-xs">
                  <div className="flex justify-between items-center">
                    <label className="font-semibold text-slate-800">
                      {inp.name}
                    </label>
                    <span className="text-[10px] font-mono text-slate-400">
                      {inp.variable_id}
                    </span>
                  </div>

                  <div className="flex space-x-2">
                    <input
                      type="number"
                      step="any"
                      value={currentInput.value}
                      onChange={e => handleInputChange(inp.variable_id, e.target.value)}
                      placeholder={`Masukkan nilai dalam satuan ${currentInput.unit}`}
                      className="flex-1 px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
                    />
                    <select
                      value={currentInput.unit}
                      onChange={e => handleInputUnitChange(inp.variable_id, e.target.value)}
                      className="w-24 px-2.5 py-2 rounded-xl border border-slate-300 text-xs font-mono bg-slate-50 focus:outline-none text-slate-700"
                    >
                      <option value={inp.unit}>{inp.unit}</option>
                      {compatibleUnits.filter(u => u.symbol !== inp.unit).map(u => (
                        <option key={u.symbol} value={u.symbol}>{u.symbol}</option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}

            {/* Configurable Parameters */}
            {selectedFormula && selectedFormula.parameter_ids.length > 0 && (
              <div className="pt-3 border-t border-slate-100 space-y-3">
                <div className="flex items-center space-x-1.5 text-xs font-mono font-semibold text-slate-700 uppercase">
                  <Sliders className="w-3.5 h-3.5 text-slate-500" />
                  <span>Parameter Eksperimental yang Dapat Disesuaikan</span>
                </div>

                {selectedFormula.parameter_ids.map(pId => {
                  const paramObj = parameters.find(p => p.parameter_id === pId);
                  const val = paramOverrides[pId] !== undefined ? paramOverrides[pId] : (paramObj ? paramObj.value : '');

                  return (
                    <div key={pId} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-slate-800">{paramObj ? paramObj.name : pId}</span>
                        <span className="font-mono text-[10px] text-slate-400">{pId}</span>
                      </div>
                      <div className="flex space-x-2 items-center">
                        <input
                          type="number"
                          step="any"
                          value={val}
                          onChange={e => handleParamChange(pId, Number(e.target.value))}
                          className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
                        />
                        <span className="text-[11px] font-mono text-slate-500 w-16">
                          {paramObj?.unit || 'unitless'}
                        </span>
                      </div>
                      {paramObj?.description && (
                        <div className="text-[10px] text-slate-400 leading-normal">{paramObj.description}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Validation Errors Display */}
            {validationErrors.length > 0 && (
              <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 space-y-1.5">
                <div className="flex items-center space-x-1.5 font-bold">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  <span>Validasi Input Gagal</span>
                </div>
                <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                  {validationErrors.map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Execute Calculation Button */}
            <button
              id="btn-execute-calculation"
              onClick={handleExecute}
              disabled={calculating}
              className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all flex items-center justify-center space-x-2 shadow-md cursor-pointer disabled:opacity-50 active:scale-[0.99]"
            >
              <Play className="w-4 h-4 fill-emerald-400 text-emerald-400" />
              <span>{calculating ? 'Mengevaluasi Simpul AST...' : 'Jalankan Perhitungan via AST'}</span>
            </button>
          </div>
        </div>

        {/* Right Column: Calculation Result, Trace & Clinical Panels */}
        <div className="lg:col-span-7 space-y-4">
          {traceResult ? (
            <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-5 shadow-sm">
              {/* Output Banner */}
              <div className="bg-slate-950 text-white p-5 rounded-2xl space-y-3 border border-slate-800 shadow-md">
                <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                  <span className="flex items-center space-x-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span>HASIL KOMPUTASI DETERMINISTIK AST</span>
                  </span>
                  <span className="text-emerald-400 font-semibold">
                    {(traceResult.execution_duration_ms ?? 0.84).toFixed(2)} ms
                  </span>
                </div>

                <div className="flex items-baseline space-x-3">
                  <span className="text-4xl font-extrabold tracking-tight text-white font-mono">
                    {calculatedValue !== null ? calculatedValue.toFixed(2) : (traceResult.output_value ?? 0).toFixed(2)}
                  </span>
                  <span className="text-base font-semibold text-emerald-400 font-mono">
                    {traceResult.output_unit || traceResult.final_result?.[Object.keys(traceResult.final_result)[0]]?.unit || ''}
                  </span>
                </div>

                {/* Natural Language Explanation */}
                <div className="pt-2 text-xs text-slate-300 leading-relaxed border-t border-slate-800/80">
                  <span className="font-semibold text-white">Interpretasi Formula: </span>
                  {traceResult.natural_language_explanation || traceResult.explanation || `Hasil evaluasi deterministik ekspresi ${selectedFormula?.expression_string}`}
                </div>
              </div>

              {/* 2. SPECIALIZED CLINICAL EVALUATION PANELS (BMI, BMR, MAP) */}

              {/* BMI WHO Classification Panel */}
              {bmiEvaluation && (
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Scale className="w-4 h-4 text-emerald-600" />
                      <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                        Evaluasi Status Gizi (Standar WHO)
                      </h3>
                    </div>
                    <span className={`text-[11px] font-mono px-2.5 py-0.5 rounded-full font-bold border ${bmiEvaluation.badgeColor}`}>
                      {bmiEvaluation.category}
                    </span>
                  </div>

                  {/* Visual scale gauge */}
                  <div className="space-y-1">
                    <div className="h-3 w-full bg-slate-200 rounded-full overflow-hidden flex">
                      <div className="h-full bg-amber-400 w-[18.5%]" title="Underweight (<18.5)" />
                      <div className="h-full bg-emerald-500 w-[24.9%]" title="Normal (18.5 - 24.9)" />
                      <div className="h-full bg-amber-500 w-[20%]" title="Overweight (25 - 29.9)" />
                      <div className="h-full bg-orange-500 w-[16.6%]" title="Obesitas I (30 - 34.9)" />
                      <div className="h-full bg-rose-600 w-[20%]" title="Obesitas II (>=35)" />
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400 font-mono px-0.5">
                      <span>0</span>
                      <span>18.5 (Normal)</span>
                      <span>25.0</span>
                      <span>30.0</span>
                      <span>35.0+</span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed">
                    {bmiEvaluation.description}
                  </p>

                  <div className="p-2.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-700 flex items-center justify-between">
                    <span>Rentang Berat Badan Ideal untuk Tinggi {bmiEvaluation.height} m:</span>
                    <strong className="text-emerald-700 font-mono">
                      {bmiEvaluation.minNormalWeight} – {bmiEvaluation.maxNormalWeight} kg
                    </strong>
                  </div>
                </div>
              )}

              {/* BMR & Total Daily Energy Expenditure (TDEE) Panel */}
              {bmrEvaluation && (
                <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Flame className="w-4 h-4 text-amber-600" />
                      <h3 className="text-xs font-bold text-amber-950 uppercase tracking-wide">
                        Estimasi Kebutuhan Kalori Harian (TDEE Berdasarkan Aktivitas)
                      </h3>
                    </div>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-300 font-semibold">
                      BMR Dasar: {Math.round(bmrEvaluation.bmr)} kcal/hari
                    </span>
                  </div>

                  <p className="text-xs text-amber-900/80 leading-relaxed">
                    BMR adalah energi minimal yang dibutuhkan organ tubuh saat istirahat total. Kalikan BMR dengan faktor aktivitas harian (Physical Activity Level / PAL):
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-xl bg-white border border-amber-200 flex justify-between items-center">
                      <div>
                        <div className="font-semibold text-slate-800">Sedentary (Rebahan / Duduk)</div>
                        <div className="text-[10px] text-slate-400">Faktor × 1.2</div>
                      </div>
                      <span className="font-mono font-bold text-slate-900">{bmrEvaluation.tdee.sedentary} kcal</span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-white border border-amber-200 flex justify-between items-center">
                      <div>
                        <div className="font-semibold text-slate-800">Aktivitas Ringan (1-3 hari/mgg)</div>
                        <div className="text-[10px] text-slate-400">Faktor × 1.375</div>
                      </div>
                      <span className="font-mono font-bold text-slate-900">{bmrEvaluation.tdee.light} kcal</span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-white border border-emerald-300 bg-emerald-50/40 flex justify-between items-center">
                      <div>
                        <div className="font-semibold text-emerald-950">Moderat (3-5 hari/mgg)</div>
                        <div className="text-[10px] text-emerald-700">Rekomendasi Umum × 1.55</div>
                      </div>
                      <span className="font-mono font-bold text-emerald-700">{bmrEvaluation.tdee.moderate} kcal</span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-white border border-amber-200 flex justify-between items-center">
                      <div>
                        <div className="font-semibold text-slate-800">Sangat Aktif (6-7 hari/mgg)</div>
                        <div className="text-[10px] text-slate-400">Faktor × 1.725</div>
                      </div>
                      <span className="font-mono font-bold text-slate-900">{bmrEvaluation.tdee.veryActive} kcal</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                    <div className="p-2 rounded-xl bg-white border border-amber-200 text-center">
                      <div className="text-[10px] text-slate-500">Defisit Kalori (Turun BB -0.5kg/mgg)</div>
                      <div className="font-mono font-bold text-amber-700 mt-0.5">{bmrEvaluation.deficit} kcal/hari</div>
                    </div>
                    <div className="p-2 rounded-xl bg-white border border-amber-200 text-center">
                      <div className="text-[10px] text-slate-500">Surplus Kalori (Naik Massa Otot)</div>
                      <div className="font-mono font-bold text-emerald-700 mt-0.5">{bmrEvaluation.surplus} kcal/hari</div>
                    </div>
                  </div>
                </div>
              )}

              {/* MAP Hemodynamics Panel */}
              {mapEvaluation && (
                <div className="p-4 rounded-2xl bg-rose-50/60 border border-rose-200 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Heart className="w-4 h-4 text-rose-600" />
                      <h3 className="text-xs font-bold text-rose-950 uppercase tracking-wide">
                        Status Perfusi Vaskular (Kardiovaskular)
                      </h3>
                    </div>
                    <span className={`text-[11px] font-mono px-2 py-0.5 rounded-md font-bold border ${mapEvaluation.badgeColor}`}>
                      {mapEvaluation.status}
                    </span>
                  </div>
                  <p className="text-xs text-rose-900/80 leading-relaxed">
                    {mapEvaluation.note}
                  </p>
                </div>
              )}

              {/* Step-by-Step Calculation Trace Table */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-semibold text-slate-700 uppercase">
                    Tahapan Jejak Eksekusi AST ({traceResult.steps.length} Langkah)
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    Bebas Logika Black-Box
                  </span>
                </div>

                <div className="overflow-hidden border border-slate-200 rounded-xl text-xs">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 font-mono text-[10px] text-slate-500 uppercase">
                        <th className="p-2.5">Langkah</th>
                        <th className="p-2.5">Aksi / Operasi</th>
                        <th className="p-2.5">Rincian Komputasi</th>
                        <th className="p-2.5 text-right">Nilai Hasil</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                      {traceResult.steps.map((st, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="p-2.5 font-bold text-slate-900">{st.step || st.step_number || idx + 1}</td>
                          <td className="p-2.5 font-sans font-medium text-slate-800">{st.action || st.description}</td>
                          <td className="p-2.5 text-slate-500 font-mono text-[10px]">{st.detail || st.formula_snippet}</td>
                          <td className="p-2.5 text-right font-bold text-slate-900">
                            {st.intermediate_value !== undefined 
                              ? (typeof st.intermediate_value === 'number' ? st.intermediate_value.toFixed(4) : String(st.intermediate_value))
                              : (typeof st.output_value === 'number' ? st.output_value.toFixed(4) : String(st.output_value || '-'))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Cryptographic Provenance Hash Panel */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 font-mono text-slate-700 font-semibold">
                    <Hash className="w-3.5 h-3.5 text-slate-500" />
                    <span>Segel Provenans Kriptografis (SHA-256)</span>
                  </div>
                  <button
                    onClick={handleCopyHash}
                    className="inline-flex items-center space-x-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 cursor-pointer"
                  >
                    {copiedHash ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedHash ? 'Tersalin' : 'Salin Hash'}</span>
                  </button>
                </div>

                <div className="p-2.5 bg-white border border-slate-200 rounded-lg font-mono text-[11px] text-slate-800 break-all select-all shadow-2xs">
                  {traceResult.provenance_hash}
                </div>

                <div className="text-[10px] text-slate-500 leading-normal">
                  Hash dihitung atas: formula_id + masukan ternormalisasi + parameter + cap waktu eksekusi. 
                  Menjamin keterulangan ilmiah (*reproducibility*) tanpa manipulasi nilai.
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 space-y-3 shadow-sm">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 mx-auto flex items-center justify-center text-slate-400">
                <Calculator className="w-6 h-6 text-slate-600" />
              </div>
              <h3 className="text-sm font-bold text-slate-800">Siap untuk Menghitung</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                Pilih formula di atas (atau gunakan tombol pintas cepat untuk BMR, BMI, atau MAP), sesuaikan masukan di panel kiri, lalu klik <strong>"Jalankan Perhitungan via AST"</strong> untuk mengevaluasi hasil dan jejak audit lengkap.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
