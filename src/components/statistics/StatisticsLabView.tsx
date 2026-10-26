import React, { useState, useEffect } from 'react';
import { StatisticsAnalysis, Dataset, DatasetVersion, User } from '../../types';
import { api } from '../../api';
import { 
  BarChart3, 
  Play, 
  FileText, 
  CheckCircle2, 
  Layers, 
  HelpCircle,
  TrendingUp,
  Activity,
  Award
} from 'lucide-react';

interface StatisticsLabViewProps {
  currentUser: User;
}

export const StatisticsLabView: React.FC<StatisticsLabViewProps> = ({ currentUser }) => {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');
  const [versions, setVersions] = useState<DatasetVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');

  const [analysisType, setAnalysisType] = useState<string>('DESCRIPTIVE');
  const [targetCol, setTargetCol] = useState<string>('weight_kg');
  const [groupCol, setGroupCol] = useState<string>('');

  const [running, setRunning] = useState(false);
  const [analyses, setAnalyses] = useState<StatisticsAnalysis[]>([]);
  const [currentResult, setCurrentResult] = useState<StatisticsAnalysis | null>(null);

  useEffect(() => {
    loadPrerequisites();
  }, []);

  const loadPrerequisites = async () => {
    try {
      const [dsRes, stRes] = await Promise.all([
        api.getDatasets(),
        api.getStatistics()
      ]);
      setDatasets(dsRes.datasets);
      setAnalyses(stRes.analyses);
      if (stRes.analyses.length > 0) {
        setCurrentResult(stRes.analyses[0]);
      }

      if (dsRes.datasets.length > 0) {
        const firstDs = dsRes.datasets[0];
        setSelectedDatasetId(firstDs.id);
        const vRes = await api.getDatasetVersions(firstDs.id);
        setVersions(vRes.versions);
        if (vRes.versions.length > 0) {
          setSelectedVersionId(vRes.versions[vRes.versions.length - 1].id);
        }
      }
    } catch (err) {
      console.error('Failed to load statistics prerequisites', err);
    }
  };

  const handleDatasetChange = async (dsId: string) => {
    setSelectedDatasetId(dsId);
    try {
      const vRes = await api.getDatasetVersions(dsId);
      setVersions(vRes.versions);
      if (vRes.versions.length > 0) {
        setSelectedVersionId(vRes.versions[vRes.versions.length - 1].id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRunAnalysis = async () => {
    if (!selectedVersionId || !targetCol) return;

    setRunning(true);
    try {
      const res = await api.runStatistics({
        dataset_version_id: selectedVersionId,
        analysis_type: analysisType,
        target_columns: [targetCol],
        grouping_column: groupCol || undefined,
        title: `${analysisType} of ${targetCol}`
      });
      setCurrentResult(res.analysis);
      setAnalyses([res.analysis, ...analyses]);
    } catch (err: any) {
      alert(`Statistical test error: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  const selectedVersion = versions.find(v => v.id === selectedVersionId);
  const versionColumns: any[] = selectedVersion?.columns || selectedVersion?.schema?.columns || [];
  const numericCols = versionColumns.filter((c: any) => (c.detected_type === 'number' || c.datatype === 'number'));
  const stringCols = versionColumns.filter((c: any) => (c.detected_type === 'string' || c.datatype === 'string'));

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <BarChart3 className="w-5 h-5 text-slate-700" />
            <h1 className="text-lg font-bold text-slate-900">Statistics Lab & Method Justification</h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Rigorous bio-statistical analyses: Every computed test automatically yields a formal Method Justification Report (Section 39) with assumption verifications.
          </p>
        </div>

        <span className="text-xs font-mono px-2.5 py-1 rounded bg-slate-100 text-slate-700 font-semibold border border-slate-200">
          APA 7th Format Reporting
        </span>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Test Setup Panel */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-4 text-xs">
            <div className="font-mono font-semibold text-slate-700 uppercase border-b border-slate-100 pb-2">
              Configure Statistical Test
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Target Dataset</label>
              <select
                value={selectedDatasetId}
                onChange={e => handleDatasetChange(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white focus:outline-none"
              >
                {datasets.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Dataset Version</label>
              <select
                value={selectedVersionId}
                onChange={e => setSelectedVersionId(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white font-mono focus:outline-none"
              >
                {versions.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.version_tag} ({v.row_count ?? v.data?.length ?? 0} rows)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Analytical Method (Section 38)</label>
              <select
                value={analysisType}
                onChange={e => setAnalysisType(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white focus:outline-none"
              >
                <option value="DESCRIPTIVE">Descriptive Statistics (Mean, SD, IQR, Skew)</option>
                <option value="TWO_GROUP">Two-Group Comparison (Independent Samples t-test)</option>
                <option value="CORRELATION">Bivariate Correlation (Pearson / Spearman)</option>
                <option value="REGRESSION">Linear Regression Model</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Target Numeric Variable</label>
              <select
                value={targetCol}
                onChange={e => setTargetCol(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white font-mono focus:outline-none"
              >
                {numericCols.map((c: any) => (
                  <option key={c.name} value={c.name}>{c.name} ({c.unit || 'unitless'})</option>
                ))}
              </select>
            </div>

            {analysisType === 'TWO_GROUP' && (
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Grouping Factor (2 Levels)</label>
                <select
                  value={groupCol}
                  onChange={e => setGroupCol(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white font-mono focus:outline-none"
                >
                  <option value="">-- Auto-select or None --</option>
                  {stringCols.map((c: any) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}

            <button
              onClick={handleRunAnalysis}
              disabled={running || !selectedVersionId}
              className="w-full py-2.5 bg-slate-900 text-white rounded-lg font-bold flex items-center justify-center space-x-2 hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>{running ? 'Evaluating Hypotheses...' : 'Execute Statistical Analysis'}</span>
            </button>
          </div>

          {/* Past Analyses */}
          <div className="space-y-2">
            <div className="text-xs font-mono font-semibold text-slate-500 uppercase">
              Recent Analyses History ({analyses.length})
            </div>
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {analyses.map(a => (
                <div
                  key={a.id}
                  onClick={() => setCurrentResult(a)}
                  className={`p-2.5 rounded-lg border text-xs cursor-pointer ${
                    currentResult?.id === a.id
                      ? 'bg-white border-slate-900 shadow-xs'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="font-semibold text-slate-800">{a.title}</div>
                  <div className="flex justify-between text-[10px] font-mono text-slate-400 mt-0.5">
                    <span>{a.analysis_type}</span>
                    <span>{new Date(a.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Report Panel */}
        <div className="lg:col-span-8 space-y-4">
          {currentResult ? (
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-5">
              {/* Output Header */}
              <div className="border-b border-slate-100 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-[10px] font-mono uppercase bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-bold">
                    {currentResult.analysis_type} ANALYSIS
                  </span>
                  <h2 className="text-base font-bold text-slate-900 mt-1">
                    {currentResult.title}
                  </h2>
                </div>
                <span className="font-mono text-[10px] text-slate-400">
                  ID: {currentResult.id}
                </span>
              </div>

              {/* APA Formal Reporting String Box (Section 39) */}
              {typeof currentResult.method_justification === 'object' && currentResult.method_justification?.reporting_string && (
                <div className="p-3.5 bg-slate-900 text-white rounded-xl space-y-1.5">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-bold">
                    APA 7th Edition Statistical Citation:
                  </div>
                  <div className="font-serif italic text-sm text-slate-100 select-all">
                    "{currentResult.method_justification.reporting_string}"
                  </div>
                </div>
              )}

              {/* Computed Statistical Metrics */}
              <div className="space-y-2">
                <div className="text-xs font-mono font-semibold text-slate-600 uppercase">
                  Computed Parameter Estimates & Descriptives
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                  {Object.entries(currentResult.results).map(([k, v]) => (
                    <div key={k} className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                      <span className="text-slate-400 block text-[10px] uppercase truncate">{k}</span>
                      <span className="font-bold text-slate-900 text-sm">
                        {typeof v === 'number' ? v.toFixed(4) : String(v)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* METHOD JUSTIFICATION REPORT (Section 39) */}
              {currentResult.method_justification && (
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4 text-xs">
                  <div className="flex items-center space-x-2 font-mono font-bold text-slate-800 border-b border-slate-200 pb-2">
                    <Award className="w-4 h-4 text-blue-600" />
                    <span className="uppercase">Section 39 Method Justification Report</span>
                  </div>

                  {typeof currentResult.method_justification === 'string' ? (
                    <p className="text-slate-700 leading-relaxed font-mono text-[11px]">
                      {currentResult.method_justification}
                    </p>
                  ) : (
                    <>
                      {currentResult.method_justification.why_selected && (
                        <div className="space-y-1">
                          <strong className="text-slate-900">1. Why this test was selected:</strong>
                          <p className="text-slate-600 leading-relaxed">
                            {currentResult.method_justification.why_selected}
                          </p>
                        </div>
                      )}

                      {Array.isArray(currentResult.method_justification.assumptions_verified) && (
                        <div className="space-y-1">
                          <strong className="text-slate-900">2. Verification of Distributional Assumptions:</strong>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 font-mono">
                            {currentResult.method_justification.assumptions_verified.map((asmp: any, idx: number) => (
                              <div key={idx} className="p-2 bg-white rounded border border-slate-200 flex items-center justify-between">
                                <span className="text-slate-700">{asmp.assumption}</span>
                                <span className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${
                                  asmp.met ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                                }`}>
                                  {asmp.met ? 'MET' : 'VIOLATED'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {Array.isArray(currentResult.method_justification.alternatives_considered) && (
                        <div className="space-y-1">
                          <strong className="text-slate-900">3. Non-Parametric & Robust Alternatives Considered:</strong>
                          <p className="text-slate-600">
                            {currentResult.method_justification.alternatives_considered.join(', ')}
                          </p>
                        </div>
                      )}

                      {currentResult.method_justification.interpretation && (
                        <div className="space-y-1">
                          <strong className="text-slate-900">4. Biological Context & Interpretation:</strong>
                          <p className="text-slate-600 leading-relaxed italic bg-white p-2.5 rounded border border-slate-200">
                            {currentResult.method_justification.interpretation}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="p-12 text-center bg-white rounded-xl border border-slate-200 text-xs text-slate-500">
              Select a dataset and analytical method on the left to run tests and generate formal justification reports.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
