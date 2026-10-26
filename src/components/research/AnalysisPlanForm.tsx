import React, { useState, useEffect } from 'react';
import { 
  ResearchProject, 
  Variable, 
  AnalysisPlanType,
  ScientificProjectError,
  PlannedAnalysis
} from '../../../scientific';
import { 
  ResearchWorkspaceService, 
  PlanAnalysisFormData 
} from '../../services/researchWorkspaceService';
import { 
  Calculator, 
  CheckCircle2, 
  AlertCircle, 
  ShieldAlert, 
  Lock, 
  Layers, 
  Sliders, 
  FileText, 
  Eye, 
  Info,
  Database,
  Check,
  Cpu
} from 'lucide-react';
import { ExecutionPreviewView } from './ExecutionPreview';

interface AnalysisPlanFormProps {
  project: ResearchProject;
  service: ResearchWorkspaceService;
  onProjectUpdated: (project: ResearchProject) => void;
}

const ANALYSIS_TYPE_CONFIG: Record<
  AnalysisPlanType,
  { label: string; description: string; showGrouping: boolean; showPairing: boolean; alphaRequired: boolean }
> = {
  DESCRIPTIVE: {
    label: 'Descriptive Statistics',
    description: 'Summary metrics (mean, median, IQR, SD, distribution skewness) for characterization.',
    showGrouping: true,
    showPairing: false,
    alphaRequired: false
  },
  INFERENTIAL: {
    label: 'Inferential Hypothesis Testing',
    description: 'Formal parametric tests (t-tests, ANOVA) evaluating explicit hypotheses against null bounds.',
    showGrouping: true,
    showPairing: true,
    alphaRequired: true
  },
  REGRESSION: {
    label: 'Regression & Predictive Modeling',
    description: 'Linear, logistic, or multivariable regression modeling between predictors and outcomes.',
    showGrouping: true,
    showPairing: false,
    alphaRequired: true
  },
  POWER_ANALYSIS: {
    label: 'Statistical Power & Sample Size Plan',
    description: 'A priori or post-hoc power estimation, required sample size, and detectable effect sizing.',
    showGrouping: false,
    showPairing: false,
    alphaRequired: true
  },
  NON_PARAMETRIC: {
    label: 'Non-Parametric Analysis',
    description: 'Distribution-free tests (Mann-Whitney, Wilcoxon signed-rank, Kruskal-Wallis).',
    showGrouping: true,
    showPairing: true,
    alphaRequired: true
  }
};

export const AnalysisPlanForm: React.FC<AnalysisPlanFormProps> = ({
  project,
  service,
  onProjectUpdated
}) => {
  const [registryVariables, setRegistryVariables] = useState<Variable[]>([]);
  const [analysisId, setAnalysisId] = useState<string>('');
  const [objectiveId, setObjectiveId] = useState<string>('');
  const [hypothesisId, setHypothesisId] = useState<string>('');
  const [analysisType, setAnalysisType] = useState<AnalysisPlanType>('INFERENTIAL');
  const [selectedVariableIds, setSelectedVariableIds] = useState<string[]>([]);
  const [groupingVariableId, setGroupingVariableId] = useState<string>('');
  const [pairingVariableId, setPairingVariableId] = useState<string>('');
  const [alpha, setAlpha] = useState<string>('0.05');
  const [confidenceLevel, setConfidenceLevel] = useState<string>('0.95');
  const [rationale, setRationale] = useState<string>('');
  
  const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(true);
  const [inspectedPreviewAnalysisId, setInspectedPreviewAnalysisId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isImmutable = project.status === 'FINALIZED' || project.status === 'ARCHIVED';
  const hasDatasetBinding = Boolean(
    project.dataset_binding && 
    project.dataset_binding.dataset_version_id && 
    project.dataset_binding.data_artifact_id
  );

  useEffect(() => {
    const vars = service.listVariables();
    setRegistryVariables(vars);
    
    // Set default objective if available
    if (project.objectives.length > 0 && !objectiveId) {
      setObjectiveId(project.objectives[0].objective_id);
    }
    
    // Set default hypothesis if available
    if (project.hypotheses.length > 0 && !hypothesisId) {
      setHypothesisId(project.hypotheses[0].hypothesis_id);
    }

    // Prepopulate analysis ID if empty
    if (!analysisId) {
      setAnalysisId(`PLAN_${project.project_id}_${project.analysis_plan.length + 1}`);
    }
  }, [project, service]);

  const handleToggleVariable = (varId: string) => {
    setSelectedVariableIds((prev) => 
      prev.includes(varId) ? prev.filter((id) => id !== varId) : [...prev, varId]
    );
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    // Front-end Pre-validations
    if (!hasDatasetBinding) {
      setError('Dataset Binding is required. Please bind a dataset before planning an analysis.');
      return;
    }

    if (!analysisId.trim()) {
      setError('Analysis ID is required.');
      return;
    }

    if (!objectiveId.trim()) {
      setError('Research objective selection is required.');
      return;
    }

    if (selectedVariableIds.length === 0) {
      setError('At least one input variable must be selected from the Variable Registry.');
      return;
    }

    if (!rationale.trim()) {
      setError('Planned rationale is required. Please explain the scientific rationale for this analysis.');
      return;
    }

    const typeConfig = ANALYSIS_TYPE_CONFIG[analysisType];
    const parsedAlpha = alpha.trim() !== '' ? parseFloat(alpha) : undefined;
    if (typeConfig.alphaRequired && (parsedAlpha === undefined || isNaN(parsedAlpha))) {
      setError(`Alpha level is required for ${typeConfig.label}.`);
      return;
    }
    if (parsedAlpha !== undefined && (isNaN(parsedAlpha) || parsedAlpha <= 0 || parsedAlpha >= 1)) {
      setError('Alpha must be a probability strictly between 0 and 1 (exclusive), e.g. 0.05.');
      return;
    }

    const parsedConf = confidenceLevel.trim() !== '' ? parseFloat(confidenceLevel) : undefined;
    if (parsedConf !== undefined && (isNaN(parsedConf) || parsedConf <= 0 || parsedConf >= 1)) {
      setError('Confidence level must be a probability strictly between 0 and 1 (exclusive), e.g. 0.95.');
      return;
    }

    setIsSubmitting(true);

    try {
      const formData: PlanAnalysisFormData = {
        project_id: project.project_id,
        analysis_id: analysisId.trim(),
        objective_id: objectiveId.trim(),
        hypothesis_id: hypothesisId.trim() !== '' ? hypothesisId.trim() : undefined,
        analysis_type: analysisType,
        input_variable_ids: selectedVariableIds,
        grouping_variable_ids: groupingVariableId.trim() !== '' ? [groupingVariableId.trim()] : undefined,
        pairing_variable_ids: pairingVariableId.trim() !== '' ? [pairingVariableId.trim()] : undefined,
        alpha: parsedAlpha,
        confidence_level: parsedConf,
        planned_rationale: rationale.trim(),
        configuration: {
          created_in_phase: 'F2.1',
          timestamp: new Date().toISOString()
        }
      };

      const updated = service.planAnalysis(formData);
      setSuccessMsg(`Analysis plan '${formData.analysis_id}' saved with status PLANNED.`);
      onProjectUpdated(updated);

      // Increment ID for subsequent entry
      setAnalysisId(`PLAN_${project.project_id}_${updated.analysis_plan.length + 1}`);
      setRationale('');
    } catch (err: unknown) {
      if (err instanceof ScientificProjectError) {
        setError(`[${err.code}] ${err.message}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred while saving the analysis plan.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedObjective = project.objectives.find((o) => o.objective_id === objectiveId);
  const selectedHypothesis = project.hypotheses.find((h) => h.hypothesis_id === hypothesisId);
  const typeConfig = ANALYSIS_TYPE_CONFIG[analysisType];

  return (
    <div className="space-y-6">
      {/* Immutability Banner */}
      {isImmutable && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start space-x-3 text-amber-900">
          <Lock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs">
            <span className="font-bold">Project is {project.status}: Read-Only</span>
            <p className="mt-0.5 text-amber-700">
              Analysis plans cannot be modified or added to finalized or archived research projects.
            </p>
          </div>
        </div>
      )}

      {/* Dataset Safety Banner */}
      {!hasDatasetBinding && (
        <div 
          id="banner-dataset-binding-required"
          className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start space-x-3 text-rose-900"
        >
          <Database className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="text-xs">
            <span className="font-bold">Dataset Binding Required</span>
            <p className="mt-0.5 text-rose-700">
              An active dataset binding is strictly required before formulating an analysis plan.
              Please navigate to <strong>Form 2: Dataset Binding</strong> to verify and bind an artifact.
            </p>
          </div>
        </div>
      )}

      {/* Scientific Methodology Disclaimer */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-start space-x-2.5">
        <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
        <div className="leading-relaxed">
          <strong className="text-slate-800">Phase F2.1 Analysis Planning Workspace:</strong> All analyses defined here remain in status <code className="font-mono text-slate-900 font-semibold">PLANNED</code>. No statistical engines (D9–D13) execute during this phase. Variable designations and study designs are declarative metadata only; causality is never inferred.
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div id="alert-analysis-plan-error" className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-3 text-red-900">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="text-xs">
            <span className="font-bold">Validation Error</span>
            <p className="mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Success Message */}
      {successMsg && (
        <div id="alert-analysis-plan-success" className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start space-x-3 text-emerald-900">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-xs">
            <span className="font-bold">Analysis Plan Registered</span>
            <p className="mt-0.5">{successMsg}</p>
          </div>
        </div>
      )}

      {/* Main Analysis Plan Form */}
      <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-xl p-6 space-y-6 shadow-xs">
        <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Calculator className="w-5 h-5 text-slate-900" />
            <h3 className="text-sm font-bold text-slate-900">Form 4: Pre-Specified Analysis Plan</h3>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold uppercase">
            Status: PLANNED
          </span>
        </div>

        {/* Grid 1: Analysis ID & Type */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="input-analysis-id" className="block text-xs font-semibold text-slate-700 mb-1">
              Analysis ID <span className="text-red-500">*</span>
            </label>
            <input
              id="input-analysis-id"
              type="text"
              value={analysisId}
              onChange={(e) => setAnalysisId(e.target.value)}
              disabled={isImmutable || !hasDatasetBinding}
              placeholder="e.g. AP_PRIMARY_TTEST_01"
              className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:bg-slate-100 disabled:cursor-not-allowed"
            />
            <span className="text-[10px] text-slate-400 mt-1 block">Unique identifier for this pre-specified analysis step.</span>
          </div>

          <div>
            <label htmlFor="select-analysis-type" className="block text-xs font-semibold text-slate-700 mb-1">
              Analysis Type <span className="text-red-500">*</span>
            </label>
            <select
              id="select-analysis-type"
              value={analysisType}
              onChange={(e) => setAnalysisType(e.target.value as AnalysisPlanType)}
              disabled={isImmutable || !hasDatasetBinding}
              className="w-full text-xs font-semibold px-3 py-2 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:bg-slate-100 disabled:cursor-not-allowed"
            >
              <option value="DESCRIPTIVE">DESCRIPTIVE (Summary & Distribution Characterization)</option>
              <option value="INFERENTIAL">INFERENTIAL (Hypothesis Testing: t-test, ANOVA)</option>
              <option value="REGRESSION">REGRESSION (Linear / Logistic / Multivariable)</option>
              <option value="POWER_ANALYSIS">POWER_ANALYSIS (A priori / Post-hoc Power Estimation)</option>
              <option value="NON_PARAMETRIC">NON_PARAMETRIC (Distribution-free: Mann-Whitney, Wilcoxon)</option>
            </select>
            <span className="text-[10px] text-slate-500 mt-1 block">{typeConfig.description}</span>
          </div>
        </div>

        {/* Grid 2: Objective & Optional Hypothesis Selector */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="select-objective" className="block text-xs font-semibold text-slate-700 mb-1">
              Target Research Objective <span className="text-red-500">*</span>
            </label>
            <select
              id="select-objective"
              value={objectiveId}
              onChange={(e) => setObjectiveId(e.target.value)}
              disabled={isImmutable || !hasDatasetBinding || project.objectives.length === 0}
              className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:bg-slate-100 disabled:cursor-not-allowed"
            >
              {project.objectives.length === 0 ? (
                <option value="">No objectives found in project</option>
              ) : (
                project.objectives.map((obj) => (
                  <option key={obj.objective_id} value={obj.objective_id}>
                    [{obj.type}] {obj.description} ({obj.objective_id})
                  </option>
                ))
              )}
            </select>
            <span className="text-[10px] text-slate-400 mt-1 block">Ties this planned analysis to an explicit project objective.</span>
          </div>

          <div>
            <label htmlFor="select-hypothesis" className="block text-xs font-semibold text-slate-700 mb-1">
              Associated Hypothesis <span className="text-slate-400">(Optional)</span>
            </label>
            <select
              id="select-hypothesis"
              value={hypothesisId}
              onChange={(e) => setHypothesisId(e.target.value)}
              disabled={isImmutable || !hasDatasetBinding}
              className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:bg-slate-100 disabled:cursor-not-allowed"
            >
              <option value="">-- None / Unspecified (Exploratory / Descriptive) --</option>
              {project.hypotheses.map((hyp) => (
                <option key={hyp.hypothesis_id} value={hyp.hypothesis_id}>
                  [{hyp.direction}] {hyp.null_hypothesis.slice(0, 50)}... ({hyp.hypothesis_id})
                </option>
              ))}
            </select>
            <span className="text-[10px] text-slate-400 mt-1 block">Explicitly binds to pre-specified null/alternative hypothesis.</span>
          </div>
        </div>

        {/* Input Variables Selection */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Input Variables <span className="text-red-500">*</span>
          </label>
          <span className="text-[11px] text-slate-500 mb-2 block">
            Select one or more registered variables from the existing Variable Registry:
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-2 border border-slate-200 rounded-lg bg-slate-50/50">
            {registryVariables.map((v) => {
              const isChecked = selectedVariableIds.includes(v.variable_id);
              const isPlannedInProject = project.variable_plan.some((pv) => pv.variable_id === v.variable_id);
              return (
                <button
                  type="button"
                  key={v.variable_id}
                  onClick={() => handleToggleVariable(v.variable_id)}
                  disabled={isImmutable || !hasDatasetBinding}
                  className={`flex items-start space-x-2 text-left p-2 rounded-md border text-xs transition-colors ${
                    isChecked
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <div className={`w-3.5 h-3.5 mt-0.5 rounded border flex items-center justify-center shrink-0 ${
                    isChecked ? 'border-white bg-slate-800' : 'border-slate-400'
                  }`}>
                    {isChecked && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                  <div className="min-w-0">
                    <span className="font-semibold block truncate">{v.name}</span>
                    <span className={`text-[10px] font-mono block ${isChecked ? 'text-slate-300' : 'text-slate-400'}`}>
                      {v.variable_id} {v.unit ? `(${v.unit})` : ''} {isPlannedInProject ? '· planned' : ''}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">
            Selected: {selectedVariableIds.length} variable(s)
          </span>
        </div>

        {/* Grouping & Pairing Variables (Relevant to specific categories) */}
        {(typeConfig.showGrouping || typeConfig.showPairing) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3 bg-slate-50 border border-slate-200 rounded-lg">
            {typeConfig.showGrouping && (
              <div>
                <label htmlFor="select-grouping-variable" className="block text-xs font-semibold text-slate-700 mb-1">
                  Grouping Variable <span className="text-slate-400">(Optional / Between-Subjects)</span>
                </label>
                <select
                  id="select-grouping-variable"
                  value={groupingVariableId}
                  onChange={(e) => setGroupingVariableId(e.target.value)}
                  disabled={isImmutable || !hasDatasetBinding}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:bg-slate-100 disabled:cursor-not-allowed"
                >
                  <option value="">-- None / Single Cohort --</option>
                  {registryVariables.map((v) => (
                    <option key={v.variable_id} value={v.variable_id}>
                      {v.name} ({v.variable_id} · {v.datatype})
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Categorical grouping factor for 2-sample or multi-group comparison.
                </span>
              </div>
            )}

            {typeConfig.showPairing && (
              <div>
                <label htmlFor="select-pairing-variable" className="block text-xs font-semibold text-slate-700 mb-1">
                  Pairing Variable <span className="text-slate-400">(Optional / Dependent Samples)</span>
                </label>
                <select
                  id="select-pairing-variable"
                  value={pairingVariableId}
                  onChange={(e) => setPairingVariableId(e.target.value)}
                  disabled={isImmutable || !hasDatasetBinding}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:bg-slate-100 disabled:cursor-not-allowed"
                >
                  <option value="">-- None / Independent Samples --</option>
                  {registryVariables.map((v) => (
                    <option key={v.variable_id} value={v.variable_id}>
                      {v.name} ({v.variable_id})
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Subject ID or match key for paired or repeated measures.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Alpha & Confidence Level */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="input-alpha" className="block text-xs font-semibold text-slate-700 mb-1">
              Alpha Significance Threshold (α) {typeConfig.alphaRequired && <span className="text-red-500">*</span>}
            </label>
            <input
              id="input-alpha"
              type="number"
              step="0.001"
              min="0.0001"
              max="0.9999"
              value={alpha}
              onChange={(e) => setAlpha(e.target.value)}
              disabled={isImmutable || !hasDatasetBinding}
              placeholder="0.05"
              className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:bg-slate-100 disabled:cursor-not-allowed"
            />
            <span className="text-[10px] text-slate-400 mt-1 block">Pre-specified Type I error rate (e.g. 0.05 or 0.01).</span>
          </div>

          <div>
            <label htmlFor="input-confidence-level" className="block text-xs font-semibold text-slate-700 mb-1">
              Confidence Interval Level (1 - α)
            </label>
            <input
              id="input-confidence-level"
              type="number"
              step="0.01"
              min="0.01"
              max="0.999"
              value={confidenceLevel}
              onChange={(e) => setConfidenceLevel(e.target.value)}
              disabled={isImmutable || !hasDatasetBinding}
              placeholder="0.95"
              className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:bg-slate-100 disabled:cursor-not-allowed"
            />
            <span className="text-[10px] text-slate-400 mt-1 block">Coverage level for parameter confidence intervals (e.g. 0.95).</span>
          </div>
        </div>

        {/* Planned Rationale */}
        <div>
          <label htmlFor="textarea-planned-rationale" className="block text-xs font-semibold text-slate-700 mb-1">
            Planned Scientific Rationale <span className="text-red-500">*</span>
          </label>
          <textarea
            id="textarea-planned-rationale"
            rows={3}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            disabled={isImmutable || !hasDatasetBinding}
            placeholder="Explicitly describe why this analysis is pre-specified, what hypotheses it tests, and how findings will be interpreted..."
            className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:bg-slate-100 disabled:cursor-not-allowed"
          />
          <span className="text-[10px] text-slate-400 mt-1 block">
            Explicitly user supplied. Pre-registration of rationale prevents p-hacking and exploratory bias.
          </span>
        </div>

        {/* Read-Only Form Preview */}
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div 
            onClick={() => setIsPreviewOpen(!isPreviewOpen)}
            className="bg-slate-100 px-4 py-2 flex items-center justify-between cursor-pointer select-none"
          >
            <div className="flex items-center space-x-2">
              <Eye className="w-4 h-4 text-slate-700" />
              <span className="text-xs font-bold text-slate-800">Form Preview (Read-Only)</span>
            </div>
            <span className="text-[10px] font-mono text-slate-500">
              {isPreviewOpen ? 'Hide Preview' : 'Show Preview'}
            </span>
          </div>

          {isPreviewOpen && (
            <div id="read-only-plan-preview" className="p-4 bg-slate-50/50 space-y-3 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <span className="text-[10px] font-mono text-slate-400 uppercase block">Analysis ID</span>
                  <strong className="text-slate-800 font-mono">{analysisId || '(Not set)'}</strong>
                </div>
                <div>
                  <span className="text-[10px] font-mono text-slate-400 uppercase block">Analysis Type</span>
                  <strong className="text-slate-800">{analysisType}</strong>
                </div>
                <div>
                  <span className="text-[10px] font-mono text-slate-400 uppercase block">Alpha / Conf</span>
                  <span className="text-slate-800 font-mono">α = {alpha || 'N/A'} · CI = {confidenceLevel || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-mono text-slate-400 uppercase block">Status</span>
                  <span className="font-mono font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded text-[11px]">
                    PLANNED
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                <div>
                  <span className="text-[10px] font-mono text-slate-400 uppercase block">Objective</span>
                  <span className="text-slate-700">
                    {selectedObjective ? `[${selectedObjective.type}] ${selectedObjective.description}` : '(None selected)'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-mono text-slate-400 uppercase block">Hypothesis</span>
                  <span className="text-slate-700">
                    {selectedHypothesis 
                      ? `[${selectedHypothesis.direction}] Null: ${selectedHypothesis.null_hypothesis}` 
                      : '(None / Exploratory)'}
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <span className="text-[10px] font-mono text-slate-400 uppercase block">Selected Variables ({selectedVariableIds.length})</span>
                  <span className="text-slate-700 font-mono text-[11px]">
                    {selectedVariableIds.length > 0 ? selectedVariableIds.join(', ') : '(None)'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-mono text-slate-400 uppercase block">Grouping Variable</span>
                  <span className="text-slate-700 font-mono text-[11px]">{groupingVariableId || '(None)'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-mono text-slate-400 uppercase block">Pairing Variable</span>
                  <span className="text-slate-700 font-mono text-[11px]">{pairingVariableId || '(None)'}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <span className="text-[10px] font-mono text-slate-400 uppercase block">Dataset Version (Inherited)</span>
                  <span className="text-slate-800 font-mono text-[11px]">
                    {project.dataset_binding?.dataset_version_id || '(No dataset bound)'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-mono text-slate-400 uppercase block">Data Artifact (Inherited)</span>
                  <span className="text-slate-800 font-mono text-[11px]">
                    {project.dataset_binding?.data_artifact_id || '(No artifact bound)'}
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200">
                <span className="text-[10px] font-mono text-slate-400 uppercase block">Rationale</span>
                <p className="text-slate-700 italic text-[11px] mt-0.5">
                  {rationale || '(No rationale entered yet)'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Submit Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <div className="text-[11px] text-slate-400 font-mono">
            Scientific Validity: <strong className="text-amber-700">{project.scientific_validity}</strong>
          </div>

          <button
            id="btn-save-analysis-plan"
            type="submit"
            disabled={isImmutable || !hasDatasetBinding || isSubmitting}
            className="inline-flex items-center space-x-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{isSubmitting ? 'Validating & Saving...' : 'Save Analysis Plan (Status: PLANNED)'}</span>
          </button>
        </div>
      </form>

      {/* Currently Planned Analyses List */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2">
            <Layers className="w-5 h-5 text-slate-900" />
            <h4 className="text-sm font-bold text-slate-900">
              Pre-Specified Analysis Plans in Project ({project.analysis_plan.length})
            </h4>
          </div>
          <span className="text-[11px] font-mono text-slate-500">
            Immutable Historical Registry
          </span>
        </div>

        {project.analysis_plan.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400 font-mono">
            No analyses pre-specified yet. Use the form above to formulate your first planned analysis.
          </div>
        ) : (
          <div className="space-y-3">
            {project.analysis_plan.map((plan: PlannedAnalysis) => {
              const preflight = service.preflightAnalysis(project.project_id, plan.analysis_id);
              const isPreflightReady = preflight.status === 'READY';

              return (
                <div 
                  key={plan.analysis_id} 
                  className="p-3.5 border border-slate-200 rounded-lg bg-slate-50/50 space-y-2 text-xs"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-slate-900 font-mono">{plan.analysis_id}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-semibold uppercase">
                        {plan.analysis_type}
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
                        {plan.status}
                      </span>
                      <span 
                        className={`text-[10px] font-mono px-2 py-0.5 rounded font-semibold ${
                          isPreflightReady
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                        title={isPreflightReady ? `Resolved module: ${preflight.resolved_module_id}` : preflight.errors.join('; ')}
                      >
                        Preflight: {preflight.status}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="text-[11px] font-mono text-slate-500">
                        Obj: <strong>{plan.objective_id}</strong>
                        {plan.hypothesis_id && ` · Hyp: ${plan.hypothesis_id}`}
                        {preflight.resolved_module_id && ` · Module: ${preflight.resolved_module_id}`}
                      </div>
                      <button
                        type="button"
                        onClick={() => setInspectedPreviewAnalysisId(inspectedPreviewAnalysisId === plan.analysis_id ? null : plan.analysis_id)}
                        className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-[10px] border border-slate-300 transition-colors"
                        title="View deterministic Phase F2.2B Execution Preview snapshot"
                      >
                        <Eye className="w-3 h-3 text-indigo-600" />
                        <span>{inspectedPreviewAnalysisId === plan.analysis_id ? 'Hide Preview' : 'F2.2B Preview'}</span>
                      </button>
                    </div>
                  </div>

                <div className="text-slate-600 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                  <div>
                    <span className="text-slate-400">Inputs:</span>{' '}
                    <span className="font-mono">{plan.input_variables.join(', ')}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Grouping:</span>{' '}
                    <span className="font-mono">{plan.grouping_variable || 'None'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Alpha / CI:</span>{' '}
                    <span className="font-mono">
                      {plan.alpha !== undefined ? `α=${plan.alpha}` : 'None'} · {plan.confidence_level !== undefined ? `CI=${plan.confidence_level}` : 'None'}
                    </span>
                  </div>
                </div>

                <div className="text-slate-500 text-[11px] italic border-t border-slate-200/60 pt-1.5">
                  &ldquo;{plan.planned_rationale}&rdquo;
                </div>

                {inspectedPreviewAnalysisId === plan.analysis_id && (
                  <div className="pt-2">
                    <ExecutionPreviewView
                      preview={service.previewExecution(project.project_id, plan.analysis_id)}
                      authorization={service.getAuthorizationForAnalysis(project.project_id, plan.analysis_id)}
                      onAuthorize={(authorizer) => {
                        service.authorizeExecution(project.project_id, plan.analysis_id, authorizer);
                        setSuccessMsg(`Analysis ${plan.analysis_id} successfully authorized by ${authorizer}.`);
                      }}
                      dispatchPacket={service.getDispatchForAnalysis(project.project_id, plan.analysis_id)}
                      onDispatch={() => {
                        service.dispatchAuthorizedExecution(project.project_id, plan.analysis_id);
                        setSuccessMsg(`Analysis ${plan.analysis_id} successfully adapted and dispatched to scientific engine.`);
                      }}
                      executionResult={service.getExecutionForAnalysis(project.project_id, plan.analysis_id)}
                      onExecute={() => {
                        const dispatch = service.getDispatchForAnalysis(project.project_id, plan.analysis_id);
                        if (dispatch) {
                          service.executeAuthorizedDispatch(dispatch);
                          setSuccessMsg(`Statistical execution for analysis ${plan.analysis_id} completed successfully (software validity: PASS, scientific validity: NOT_ESTABLISHED).`);
                        }
                      }}
                      onClose={() => setInspectedPreviewAnalysisId(null)}
                    />
                  </div>
                )}
              </div>
            );
          })}
          </div>
        )}
      </div>
    </div>
  );
};
