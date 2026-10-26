import React, { useState, useEffect } from 'react';
import { 
  ScientificVariable, 
  ScientificUnit, 
  ScientificFormula, 
  ScientificParameter, 
  ScientificModel, 
  ScientificReference,
  User
} from '../../types';
import { api } from '../../api';
import { 
  Binary, 
  Layers, 
  Ruler, 
  FunctionSquare, 
  Sliders, 
  Box, 
  BookMarked, 
  Plus, 
  GitFork, 
  ShieldAlert, 
  Check, 
  AlertCircle,
  Eye,
  ChevronDown
} from 'lucide-react';

interface ScientificRegistryViewProps {
  currentUser: User;
  onExecuteFormulaInCalculator?: (formulaId: string) => void;
}

export const ScientificRegistryView: React.FC<ScientificRegistryViewProps> = ({
  currentUser,
  onExecuteFormulaInCalculator,
}) => {
  const [activeTab, setActiveTab] = useState<'formulas' | 'variables' | 'parameters' | 'models' | 'units' | 'references'>('formulas');

  const [variables, setVariables] = useState<ScientificVariable[]>([]);
  const [units, setUnits] = useState<ScientificUnit[]>([]);
  const [formulas, setFormulas] = useState<ScientificFormula[]>([]);
  const [parameters, setParameters] = useState<ScientificParameter[]>([]);
  const [models, setModels] = useState<ScientificModel[]>([]);
  const [references, setReferences] = useState<ScientificReference[]>([]);
  const [loading, setLoading] = useState(true);

  // Unit converter playground state
  const [convVal, setConvVal] = useState<number>(170);
  const [convFrom, setConvFrom] = useState<string>('cm');
  const [convTo, setConvTo] = useState<string>('m');
  const [convResult, setConvResult] = useState<string>('1.7000 m');

  // Clone Model Modal
  const [cloningModel, setCloningModel] = useState<ScientificModel | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [cloneNotes, setCloneNotes] = useState('');

  // Register Variable Modal
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [newVarId, setNewVarId] = useState('');
  const [newVarName, setNewVarName] = useState('');
  const [newVarUnit, setNewVarUnit] = useState('kg');
  const [newVarType, setNewVarType] = useState('mass');
  const [newVarMin, setNewVarMin] = useState('');
  const [newVarMax, setNewVarMax] = useState('');

  // AST viewer modal for formula
  const [inspectFormula, setInspectFormula] = useState<ScientificFormula | null>(null);

  const loadRegistry = async () => {
    try {
      setLoading(true);
      const [vRes, uRes, fRes, pRes, mRes, rRes] = await Promise.all([
        api.getVariables(),
        api.getUnits(),
        api.getFormulas(),
        api.getParameters(),
        api.getModels(),
        api.getReferences()
      ]);
      setVariables(vRes.variables);
      setUnits(uRes.units);
      setFormulas(fRes.formulas);
      setParameters(pRes.parameters);
      setModels(mRes.models);
      setReferences(rRes.references);
    } catch (err) {
      console.error('Failed to load scientific registry', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRegistry();
  }, []);

  const handleUnitConvert = (val: number, from: string, to: string) => {
    setConvVal(val);
    setConvFrom(from);
    setConvTo(to);
    // Simple lookup based on unit list
    const fromU = units.find(u => u.symbol === from);
    const toU = units.find(u => u.symbol === to);
    if (fromU && toU && fromU.measurement_type === toU.measurement_type) {
      const base = (val * fromU.to_base_multiplier) + (fromU.to_base_offset || 0);
      const target = (base - (toU.to_base_offset || 0)) / toU.to_base_multiplier;
      setConvResult(`${target.toFixed(4)} ${toU.symbol}`);
    } else {
      setConvResult('Incompatible units');
    }
  };

  const handleCloneModelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloningModel) return;

    try {
      await api.cloneModel(cloningModel.model_id, {
        new_name: cloneName.trim() || undefined,
        changed_notes: cloneNotes.trim() || undefined
      });
      setCloningModel(null);
      setCloneName('');
      setCloneNotes('');
      loadRegistry();
    } catch (err: any) {
      alert(`Model cloning failed: ${err.message}`);
    }
  };

  const handleCreateVariableSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVarId || !newVarName) return;

    try {
      await api.createVariable({
        variable_id: (newVarId || '').trim().toUpperCase(),
        name: (newVarName || '').trim(),
        unit: newVarUnit,
        measurement_type: newVarType,
        allowed_range: {
          min: newVarMin ? Number(newVarMin) : undefined,
          max: newVarMax ? Number(newVarMax) : undefined
        }
      });
      setIsRegisterOpen(false);
      setNewVarId('');
      setNewVarName('');
      setNewVarMin('');
      setNewVarMax('');
      loadRegistry();
    } catch (err: any) {
      alert(`Variable registration failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <Binary className="w-5 h-5 text-slate-700" />
            <h1 className="text-lg font-bold text-slate-900">Scientific Registry Container</h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Central repository of structured Variables, Units, AST Formulas, Parameters, Composite Models, and References.
          </p>
        </div>

        {currentUser.permissions.includes('CREATE') && (
          <button
            onClick={() => setIsRegisterOpen(true)}
            className="inline-flex items-center space-x-1.5 bg-slate-900 text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>+ Register Scientific Variable</span>
          </button>
        )}
      </div>

      {/* Compliance Notice Banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-start space-x-2.5">
        <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <span className="font-bold">Architectural Boundary (Sections 2, 51 & 62):</span>
          <p className="text-amber-800 text-[11px] leading-relaxed">
            All seeded objects below are explicitly marked <strong>[DEMO ONLY - NOT SCIENTIFICALLY VERIFIED]</strong>. 
            The platform executes registered AST expressions without hardcoding nutritional or clinical equations into UI templates.
          </p>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex border-b border-slate-200 space-x-1 overflow-x-auto text-xs font-semibold select-none">
        {[
          { id: 'formulas', label: `Formulas (${formulas.length})`, icon: FunctionSquare },
          { id: 'variables', label: `Variables (${variables.length})`, icon: Layers },
          { id: 'parameters', label: `Parameters (${parameters.length})`, icon: Sliders },
          { id: 'models', label: `Models (${models.length})`, icon: Box },
          { id: 'units', label: `Units (${units.length})`, icon: Ruler },
          { id: 'references', label: `References (${references.length})`, icon: BookMarked }
        ].map(t => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as any)}
              className={`flex items-center space-x-1.5 px-3.5 py-2.5 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                active 
                  ? 'border-slate-900 text-slate-900' 
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB CONTENT: FORMULAS */}
      {activeTab === 'formulas' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3">
            {formulas.map(f => (
              <div key={f.formula_id} className="bg-white p-4 rounded-xl border border-slate-200 text-xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono font-bold text-slate-900 text-xs">{f.formula_id}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold bg-amber-100 text-amber-800 border border-amber-200">
                        {f.status}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">v{f.version}</span>
                    </div>
                    <div className="text-sm font-bold text-slate-800">{f.name}</div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setInspectFormula(f)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center space-x-1"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Inspect AST</span>
                    </button>

                    {onExecuteFormulaInCalculator && (
                      <button
                        onClick={() => onExecuteFormulaInCalculator(f.formula_id)}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800 flex items-center space-x-1"
                      >
                        <span>Run in Calculator</span>
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-slate-600 leading-relaxed">{f.description}</p>

                {/* Mathematical Expression Box */}
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 font-mono text-xs">
                  <span className="text-slate-400 text-[10px] uppercase block mb-1">Structured Expression:</span>
                  <div className="font-semibold text-slate-900">{f.expression_string}</div>
                </div>

                {/* Inputs & Parameters */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                  <div className="p-2.5 rounded-lg bg-slate-50/70 border border-slate-100 space-y-1">
                    <span className="font-mono text-slate-400 font-semibold uppercase">Required Inputs:</span>
                    {f.inputs.map(inp => (
                      <div key={inp.variable_id} className="flex justify-between text-slate-700">
                        <span>{inp.name} ({inp.variable_id})</span>
                        <span className="font-mono font-semibold">[{inp.unit}]</span>
                      </div>
                    ))}
                  </div>

                  <div className="p-2.5 rounded-lg bg-slate-50/70 border border-slate-100 space-y-1">
                    <span className="font-mono text-slate-400 font-semibold uppercase">Bound Parameters:</span>
                    {f.parameter_ids.map(pId => (
                      <div key={pId} className="flex justify-between text-slate-700">
                        <span>{pId}</span>
                        <span className="font-mono text-slate-500">Configurable</span>
                      </div>
                    ))}
                  </div>
                </div>

                {f.assumptions.length > 0 && (
                  <div className="text-[11px] text-slate-500 italic">
                    Assumptions: {f.assumptions.join('; ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB CONTENT: VARIABLES */}
      {activeTab === 'variables' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden text-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-mono text-[10px] text-slate-500 uppercase">
                  <th className="p-3">Variable ID</th>
                  <th className="p-3">Name / Label</th>
                  <th className="p-3">Measurement</th>
                  <th className="p-3">Unit</th>
                  <th className="p-3">Allowed Range</th>
                  <th className="p-3">Population</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {variables.map(v => (
                  <tr key={v.variable_id} className="hover:bg-slate-50">
                    <td className="p-3 font-mono font-bold text-slate-900">{v.variable_id}</td>
                    <td className="p-3">
                      <div className="font-semibold text-slate-800">{v.name}</div>
                      <div className="text-[11px] text-slate-400">{v.definition}</div>
                    </td>
                    <td className="p-3 font-mono text-slate-600 uppercase">{v.measurement_type}</td>
                    <td className="p-3 font-mono font-bold text-slate-900">{v.unit}</td>
                    <td className="p-3 font-mono text-slate-600">
                      {v.allowed_range?.min !== undefined && v.allowed_range?.max !== undefined
                        ? `[${v.allowed_range.min} - ${v.allowed_range.max}]`
                        : 'Unbounded'}
                    </td>
                    <td className="p-3 text-slate-500">{v.population || 'General'}</td>
                    <td className="p-3">
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                        {v.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB CONTENT: PARAMETERS */}
      {activeTab === 'parameters' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden text-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-mono text-[10px] text-slate-500 uppercase">
                  <th className="p-3">Parameter ID</th>
                  <th className="p-3">Name</th>
                  <th className="p-3">Baseline Value</th>
                  <th className="p-3">Unit</th>
                  <th className="p-3">Valid Range</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {parameters.map(p => (
                  <tr key={p.parameter_id} className="hover:bg-slate-50">
                    <td className="p-3 font-mono font-bold text-slate-900">{p.parameter_id}</td>
                    <td className="p-3">
                      <div className="font-semibold text-slate-800">{p.name}</div>
                      <div className="text-[11px] text-slate-500">{p.description}</div>
                    </td>
                    <td className="p-3 font-mono font-bold text-slate-900">{String(p.value)}</td>
                    <td className="p-3 font-mono text-slate-600">{p.unit}</td>
                    <td className="p-3 font-mono text-slate-600">
                      {p.valid_range ? `[${p.valid_range.min} - ${p.valid_range.max}]` : 'Free range'}
                    </td>
                    <td className="p-3">
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB CONTENT: MODELS */}
      {activeTab === 'models' && (
        <div className="space-y-4">
          <div className="text-xs text-slate-600 leading-relaxed">
            Composite scientific models synthesize variables, formulas, and parameters into a coherent biological system.
            In compliance with Section 24, verified models cannot be overwritten directly. Researchers clone them into experimental branches.
          </div>

          <div className="grid grid-cols-1 gap-4">
            {models.map(m => (
              <div key={m.model_id} className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 text-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono font-bold text-slate-900">{m.model_id}</span>
                      <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                        m.is_verified ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {m.is_verified ? 'VERIFIED SYSTEM MODEL' : 'EXPERIMENTAL MODEL'}
                      </span>
                      {m.parent_model_id && (
                        <span className="text-[10px] font-mono text-slate-400">
                          (Derived from {m.parent_model_id})
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-slate-800">{m.name}</h3>
                  </div>

                  {currentUser.permissions.includes('CLONE') && (
                    <button
                      onClick={() => {
                        setCloningModel(m);
                        setCloneName(`[Experimental Clone] ${m.name}`);
                      }}
                      className="inline-flex items-center space-x-1.5 bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors"
                    >
                      <GitFork className="w-3.5 h-3.5" />
                      <span>Clone to Experimental Model</span>
                    </button>
                  )}
                </div>

                <p className="text-slate-600">{m.description}</p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                  <div className="p-2 bg-slate-50 rounded border border-slate-100">
                    <span className="text-slate-400 block text-[10px]">Variables:</span>
                    <span className="font-semibold text-slate-800">{m.variable_ids.length} Registered</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded border border-slate-100">
                    <span className="text-slate-400 block text-[10px]">Formulas:</span>
                    <span className="font-semibold text-slate-800">{m.formula_ids.length} Sub-equations</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded border border-slate-100">
                    <span className="text-slate-400 block text-[10px]">Parameters:</span>
                    <span className="font-semibold text-slate-800">{m.parameter_ids.length} Configurable</span>
                  </div>
                  <div className="p-2 bg-slate-50 rounded border border-slate-100">
                    <span className="text-slate-400 block text-[10px]">References:</span>
                    <span className="font-semibold text-slate-800">{m.reference_ids.length} Citations</span>
                  </div>
                </div>

                {m.changed_notes && (
                  <div className="p-2.5 rounded bg-blue-50 border border-blue-100 text-blue-900 text-[11px]">
                    <strong>Branch Modification Notes:</strong> {m.changed_notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB CONTENT: UNITS */}
      {activeTab === 'units' && (
        <div className="space-y-4">
          {/* Unit Converter Test Sandbox */}
          <div className="bg-slate-900 text-white p-4 rounded-xl space-y-3">
            <div className="flex items-center space-x-2 text-xs font-mono">
              <Ruler className="w-4 h-4 text-emerald-400" />
              <span className="font-bold uppercase tracking-wider text-emerald-400">Unit Normalization Engine Sandbox (Section 18)</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Value</label>
                <input
                  type="number"
                  value={convVal}
                  onChange={e => handleUnitConvert(Number(e.target.value), convFrom, convTo)}
                  className="w-full bg-slate-800 border border-slate-700 px-3 py-1.5 rounded text-white font-mono focus:outline-none"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">From Unit</label>
                <select
                  value={convFrom}
                  onChange={e => handleUnitConvert(convVal, e.target.value, convTo)}
                  className="w-full bg-slate-800 border border-slate-700 px-3 py-1.5 rounded text-white font-mono focus:outline-none"
                >
                  {units.map(u => (
                    <option key={u.symbol} value={u.symbol}>{u.name} ({u.symbol})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-slate-400 block mb-1">To Unit</label>
                <select
                  value={convTo}
                  onChange={e => handleUnitConvert(convVal, convFrom, e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 px-3 py-1.5 rounded text-white font-mono focus:outline-none"
                >
                  {units.map(u => (
                    <option key={u.symbol} value={u.symbol}>{u.name} ({u.symbol})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Normalized Output</label>
                <div className="px-3 py-1.5 bg-emerald-950/60 border border-emerald-800 text-emerald-400 font-mono font-bold rounded">
                  {convResult}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden text-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-mono text-[10px] text-slate-500 uppercase">
                  <th className="p-3">Symbol</th>
                  <th className="p-3">Unit Name</th>
                  <th className="p-3">Dimension</th>
                  <th className="p-3">Base Unit</th>
                  <th className="p-3">Multiplier to Base</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {units.map(u => (
                  <tr key={u.symbol} className="hover:bg-slate-50">
                    <td className="p-3 font-bold text-slate-900">{u.symbol}</td>
                    <td className="p-3 font-sans font-medium text-slate-800">{u.name}</td>
                    <td className="p-3 uppercase text-slate-500">{u.measurement_type}</td>
                    <td className="p-3 text-slate-700">{u.base_unit}</td>
                    <td className="p-3 text-slate-700">{u.to_base_multiplier}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB CONTENT: REFERENCES */}
      {activeTab === 'references' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3">
            {references.map(r => (
              <div key={r.reference_id} className="bg-white p-4 rounded-xl border border-slate-200 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-bold text-slate-900">{r.citation_key}</span>
                  <span className="font-mono text-slate-400 text-[11px]">{r.year}</span>
                </div>
                <h4 className="font-bold text-slate-900 text-sm">{r.title}</h4>
                <div className="text-slate-600 font-medium">{r.authors.join(', ')}</div>
                <div className="text-slate-500 text-[11px]">{r.journal_or_publisher}</div>
                {r.doi && <div className="text-[11px] font-mono text-blue-600">DOI: {r.doi}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CLONE MODEL MODAL (Section 24) */}
      {cloningModel && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Branch Experimental Model</h3>
              <button onClick={() => setCloningModel(null)} className="text-slate-400 hover:text-slate-600 text-sm font-semibold">✕</button>
            </div>

            <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200">
              Cloning from baseline model: <strong>{cloningModel.name}</strong> ({cloningModel.model_id}).
              The parent model remains strictly immutable.
            </div>

            <form onSubmit={handleCloneModelSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Experimental Model Name *</label>
                <input
                  type="text"
                  required
                  value={cloneName}
                  onChange={e => setCloneName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Hypothesis / Change Rationale</label>
                <textarea
                  rows={3}
                  placeholder="Explain why parameters or equations are modified in this experimental branch..."
                  value={cloneNotes}
                  onChange={e => setCloneNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCloningModel(null)}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-2 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800"
                >
                  Create Experimental Branch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INSPECT AST MODAL */}
      {inspectFormula && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 w-full max-w-lg p-5 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">{inspectFormula.name}</h3>
                <span className="text-[10px] font-mono text-slate-400">AST Expression Representation</span>
              </div>
              <button onClick={() => setInspectFormula(null)} className="text-slate-400 hover:text-slate-600 text-sm font-semibold">✕</button>
            </div>

            <div className="bg-slate-900 text-emerald-400 p-4 rounded-xl font-mono text-xs overflow-x-auto">
              <pre>{JSON.stringify(inspectFormula.expression_ast, null, 2)}</pre>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setInspectFormula(null)}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REGISTER VARIABLE MODAL */}
      {isRegisterOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Register Scientific Variable</h3>
              <button onClick={() => setIsRegisterOpen(false)} className="text-slate-400 hover:text-slate-600 text-sm font-semibold">✕</button>
            </div>

            <form onSubmit={handleCreateVariableSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Variable ID (e.g. VAR_FAT_FREE_MASS) *</label>
                <input
                  type="text"
                  required
                  value={newVarId}
                  onChange={e => setNewVarId(e.target.value)}
                  placeholder="VAR_EXAMPLE"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Variable Name *</label>
                <input
                  type="text"
                  required
                  value={newVarName}
                  onChange={e => setNewVarName(e.target.value)}
                  placeholder="Fat-Free Mass"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Standard Unit</label>
                  <select
                    value={newVarUnit}
                    onChange={e => setNewVarUnit(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none bg-white"
                  >
                    {units.map(u => (
                      <option key={u.symbol} value={u.symbol}>{u.name} ({u.symbol})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Measurement Type</label>
                  <select
                    value={newVarType}
                    onChange={e => setNewVarType(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none bg-white"
                  >
                    <option value="mass">Mass</option>
                    <option value="length">Length</option>
                    <option value="energy">Energy</option>
                    <option value="time">Time</option>
                    <option value="volume">Volume</option>
                    <option value="concentration">Concentration</option>
                    <option value="percentage">Percentage</option>
                    <option value="dimensionless">Dimensionless</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Allowed Min</label>
                  <input
                    type="number"
                    placeholder="0"
                    value={newVarMin}
                    onChange={e => setNewVarMin(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Allowed Max</label>
                  <input
                    type="number"
                    placeholder="500"
                    value={newVarMax}
                    onChange={e => setNewVarMax(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsRegisterOpen(false)}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-2 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800"
                >
                  Register Variable
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
