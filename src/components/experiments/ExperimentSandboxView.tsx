import React, { useState, useEffect } from 'react';
import { ScientificModel, ScientificParameter, Experiment, User } from '../../types';
import { api } from '../../api';
import { 
  FlaskConical, 
  Play, 
  GitCompare, 
  Sliders, 
  TrendingUp, 
  Check, 
  Hash, 
  ArrowRight,
  ShieldAlert,
  Save
} from 'lucide-react';

interface ExperimentSandboxViewProps {
  currentUser: User;
}

export const ExperimentSandboxView: React.FC<ExperimentSandboxViewProps> = ({ currentUser }) => {
  const [models, setModels] = useState<ScientificModel[]>([]);
  const [parameters, setParameters] = useState<ScientificParameter[]>([]);
  const [selectedBaselineId, setSelectedBaselineId] = useState<string>('');
  const [experiments, setExperiments] = useState<Experiment[]>([]);

  // Simulation settings
  const [testWeight, setTestWeight] = useState<number>(75);
  const [testStature, setTestStature] = useState<number>(178);
  const [testAge, setTestAge] = useState<number>(30);

  // Parameter delta: e.g. thermal factor or coefficient
  const [paramMultiplier, setParamMultiplier] = useState<number>(1.15); // +15% experimental deviation

  // Results
  const [baselineBMR, setBaselineBMR] = useState<number>(1700);
  const [experimentalBMR, setExperimentalBMR] = useState<number>(1955);
  const [isSimulated, setIsSimulated] = useState<boolean>(false);
  const [hypothesisText, setHypothesisText] = useState<string>('Higher ambient thermogenic response elevates daily resting metabolic rate by 15%');
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [mRes, pRes, expRes] = await Promise.all([
        api.getModels(),
        api.getParameters(),
        api.getExperiments()
      ]);
      setModels(mRes.models);
      setParameters(pRes.parameters);
      setExperiments(expRes.experiments);
      if (mRes.models.length > 0) {
        setSelectedBaselineId(mRes.models[0].model_id);
      }
    } catch (err) {
      console.error('Failed to load experiment sandbox data', err);
    }
  };

  const handleRunSideBySide = () => {
    // Mifflin-St Jeor baseline: (10*w) + (6.25*h) - (5*a) + 5
    const base = (10 * testWeight) + (6.25 * testStature) - (5 * testAge) + 5;
    const exp = base * paramMultiplier;

    setBaselineBMR(base);
    setExperimentalBMR(exp);
    setIsSimulated(true);
  };

  const handleSaveExperiment = async () => {
    if (!hypothesisText.trim()) return;

    try {
      const delta = experimentalBMR - baselineBMR;
      const pctDelta = (delta / baselineBMR) * 100;

      const res = await api.createExperiment({
        title: `Metabolic Sensitivity: ${paramMultiplier}x Factor Shift`,
        hypothesis: hypothesisText,
        baseline_model_id: selectedBaselineId,
        experimental_model_id: `${selectedBaselineId}_EXP_CLONE`,
        configuration: {
          test_weight: testWeight,
          test_stature: testStature,
          test_age: testAge,
          multiplier: paramMultiplier
        },
        results: {
          baseline_value: baselineBMR,
          experimental_value: experimentalBMR,
          absolute_delta: delta,
          percentage_delta: pctDelta,
          unit: 'kcal/day'
        }
      });
      setExperiments([res.experiment, ...experiments]);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } catch (err: any) {
      alert(`Save experiment failed: ${err.message}`);
    }
  };

  const selectedModel = models.find(m => m.model_id === selectedBaselineId);

  // Generate sensitivity curve points
  const curvePoints = [0.85, 0.90, 0.95, 1.0, 1.05, 1.10, 1.15, 1.20, 1.25].map(mult => {
    const bmr = ((10 * testWeight) + (6.25 * testStature) - (5 * testAge) + 5) * mult;
    return { mult: `${(mult * 100).toFixed(0)}%`, bmr: Math.round(bmr) };
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <FlaskConical className="w-5 h-5 text-slate-700" />
            <h1 className="text-lg font-bold text-slate-900">Experiment Sandbox & Sensitivity Studio</h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Side-by-side comparative simulation: Baseline Model (Immutable Verified) vs. Experimental Model (User Modified Branch).
          </p>
        </div>

        <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 font-medium">
          Non-Destructive Hypotheses Testing (Section 51)
        </span>
      </div>

      {/* Model Selection & Simulation Controls */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Select Verified Baseline Model (Section 51)
            </label>
            <select
              value={selectedBaselineId}
              onChange={e => setSelectedBaselineId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 bg-white focus:outline-none"
            >
              {models.map(m => (
                <option key={m.model_id} value={m.model_id}>
                  {m.name} ({m.model_id}) — {m.is_verified ? 'VERIFIED' : 'EXPERIMENTAL'}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              Verified baseline remains strictly immutable. Modifications take effect in the experimental sandbox fork.
            </p>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Experimental Hypothesis Statement
            </label>
            <input
              type="text"
              value={hypothesisText}
              onChange={e => setHypothesisText(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Formal scientific rationale committed to the provenance record.
            </p>
          </div>
        </div>

        {/* Input Parameters Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-2 border-t border-slate-100">
          <div>
            <label className="text-slate-600 block mb-1 font-medium">Subject Weight (kg)</label>
            <input
              type="number"
              value={testWeight}
              onChange={e => setTestWeight(Number(e.target.value))}
              className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="text-slate-600 block mb-1 font-medium">Subject Stature (cm)</label>
            <input
              type="number"
              value={testStature}
              onChange={e => setTestStature(Number(e.target.value))}
              className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="text-slate-600 block mb-1 font-medium">Subject Age (years)</label>
            <input
              type="number"
              value={testAge}
              onChange={e => setTestAge(Number(e.target.value))}
              className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono text-xs focus:outline-none"
            />
          </div>
          <div>
            <label className="text-slate-600 block mb-1 font-medium">
              Experimental Factor Multiplier
            </label>
            <input
              type="number"
              step="0.05"
              value={paramMultiplier}
              onChange={e => setParamMultiplier(Number(e.target.value))}
              className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono text-xs focus:outline-none"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={handleRunSideBySide}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800 transition-colors flex items-center space-x-1.5"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>Execute Side-by-Side Simulation</span>
          </button>
        </div>
      </div>

      {/* Side-by-Side Comparative Cards (Section 51) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Baseline Model Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 text-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                Baseline Model (VERIFIED)
              </span>
              <h3 className="font-bold text-slate-900 text-sm mt-1">{selectedModel?.name || 'Mifflin-St Jeor Reference'}</h3>
            </div>
            <span className="font-mono text-[11px] text-slate-400">Locked System</span>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl space-y-1">
            <span className="text-slate-500 font-mono text-[10px] uppercase">Simulated Energy Expenditure:</span>
            <div className="text-3xl font-black text-slate-900 font-mono">
              {baselineBMR.toFixed(1)} <span className="text-sm font-normal text-slate-500">kcal/day</span>
            </div>
          </div>

          <div className="text-slate-600 leading-relaxed text-[11px]">
            Computed according to peer-reviewed validated parameters. Baseline parameters: weight coeff = 10.0, height coeff = 6.25, age coeff = -5.0.
          </div>
        </div>

        {/* Experimental Model Card */}
        <div className="bg-white rounded-xl border border-blue-200 p-5 space-y-4 text-xs ring-1 ring-blue-100">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                Experimental Model (CLONE BRANCH)
              </span>
              <h3 className="font-bold text-slate-900 text-sm mt-1">Hypothesis Shift ({((paramMultiplier - 1) * 100).toFixed(0)}%)</h3>
            </div>
            <span className="font-mono text-[11px] text-blue-600 font-semibold">Live Sandbox</span>
          </div>

          <div className="p-4 bg-blue-50/60 rounded-xl space-y-1 border border-blue-100">
            <span className="text-blue-600 font-mono text-[10px] uppercase font-bold">Experimental Output:</span>
            <div className="text-3xl font-black text-blue-950 font-mono">
              {experimentalBMR.toFixed(1)} <span className="text-sm font-normal text-blue-600">kcal/day</span>
            </div>
          </div>

          <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg font-mono text-[11px]">
            <span className="text-slate-500">Absolute Delta:</span>
            <span className="font-bold text-slate-900">
              {experimentalBMR > baselineBMR ? `+${(experimentalBMR - baselineBMR).toFixed(1)}` : (experimentalBMR - baselineBMR).toFixed(1)} kcal/day
            </span>
          </div>
        </div>
      </div>

      {/* Sensitivity Analysis Curve (Section 52) */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 text-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2">
            <TrendingUp className="w-4 h-4 text-slate-700" />
            <h3 className="font-bold text-slate-900">Sensitivity Analysis Curve</h3>
          </div>
          <span className="text-[10px] font-mono text-slate-400">Parameter Sweep (85% to 125%)</span>
        </div>

        {/* CSS Bar-Chart representation of sensitivity sweep */}
        <div className="grid grid-cols-9 gap-2 items-end h-40 pt-6 px-2">
          {curvePoints.map(pt => {
            const minBMR = 1400;
            const maxBMR = 2500;
            const heightPct = Math.max(10, Math.min(100, ((pt.bmr - minBMR) / (maxBMR - minBMR)) * 100));

            return (
              <div key={pt.mult} className="flex flex-col items-center h-full justify-end group">
                <span className="text-[10px] font-mono text-slate-600 font-bold mb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {pt.bmr}
                </span>
                <div 
                  className="w-full bg-slate-800 rounded-t group-hover:bg-blue-600 transition-colors"
                  style={{ height: `${heightPct}%` }}
                ></div>
                <span className="text-[10px] font-mono text-slate-400 mt-2">{pt.mult}</span>
              </div>
            );
          })}
        </div>

        <div className="flex justify-between items-center pt-3 border-t border-slate-100">
          <div className="text-slate-500 text-[11px]">
            Shows linear response of daily energetic requirement across the parameter perturbation sweep.
          </div>

          <button
            onClick={handleSaveExperiment}
            className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-800 transition-colors flex items-center space-x-1.5"
          >
            {savedSuccess ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Save className="w-3.5 h-3.5" />}
            <span>{savedSuccess ? 'Saved to Audit Record' : 'Save Experiment to Project'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
