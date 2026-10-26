import React, { useState, useEffect } from 'react';
import { Dataset, DatasetVersion, Project, User } from '../../types';
import { api } from '../../api';
import { 
  Database, 
  Upload, 
  ShieldCheck, 
  GitBranch, 
  AlertTriangle, 
  CheckCircle2, 
  Layers, 
  Filter, 
  Plus, 
  FileSpreadsheet,
  ArrowRight,
  GitCommit
} from 'lucide-react';

interface DataLabViewProps {
  currentUser: User;
  projects: Project[];
}

export const DataLabView: React.FC<DataLabViewProps> = ({ currentUser, projects }) => {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [versions, setVersions] = useState<DatasetVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Import modal
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importName, setImportName] = useState('');
  const [importDesc, setImportDesc] = useState('');
  const [importCsvText, setImportCsvText] = useState('');
  const [importProjectId, setImportProjectId] = useState('');

  // Transformation modal
  const [isTransformOpen, setIsTransformOpen] = useState(false);
  const [transformType, setTransformType] = useState('DERIVE_COLUMN');
  const [transformTargetFormula, setTransformTargetFormula] = useState('FORMULA_BMI_KEYES');

  const loadDatasets = async () => {
    try {
      setLoading(true);
      const res = await api.getDatasets();
      setDatasets(res.datasets);
      if (res.datasets.length > 0 && !selectedDatasetId) {
        setSelectedDatasetId(res.datasets[0].id);
      }
    } catch (err) {
      console.error('Failed to load datasets', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDatasets();
  }, []);

  useEffect(() => {
    if (selectedDatasetId) {
      api.getDatasetVersions(selectedDatasetId).then(res => {
        setVersions(res.versions);
        if (res.versions.length > 0) {
          setSelectedVersionId(res.versions[res.versions.length - 1].id);
        }
      }).catch(err => console.error(err));
    }
  }, [selectedDatasetId]);

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importName.trim()) return;

    try {
      const res = await api.importDataset({
        name: importName.trim(),
        description: importDesc.trim() || undefined,
        csv_text: importCsvText.trim() || undefined,
        project_id: importProjectId || undefined
      });
      setIsImportOpen(false);
      setImportName('');
      setImportDesc('');
      setImportCsvText('');
      await loadDatasets();
      setSelectedDatasetId(res.dataset.id);
    } catch (err: any) {
      alert(`Dataset import failed: ${err.message}`);
    }
  };

  const handleApplyTransformation = async () => {
    if (!selectedDatasetId || !selectedVersionId) return;

    try {
      const res = await api.transformDataset(selectedDatasetId, {
        source_version_id: selectedVersionId,
        transformation_type: transformType,
        config: {
          formula_id: transformTargetFormula,
          weight_col: 'weight_kg',
          stature_col: 'stature_cm',
          output_col: 'computed_bmi'
        }
      });
      setIsTransformOpen(false);
      // Reload versions
      const vers = await api.getDatasetVersions(selectedDatasetId);
      setVersions(vers.versions);
      setSelectedVersionId(res.version.id);
    } catch (err: any) {
      alert(`Transformation failed: ${err.message}`);
    }
  };

  const selectedDataset = datasets.find(d => d.id === selectedDatasetId);
  const selectedVersion = versions.find(v => v.id === selectedVersionId);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <Database className="w-5 h-5 text-slate-700" />
            <h1 className="text-lg font-bold text-slate-900">Data Lab & Immutable Ingestion Pipeline</h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Strict immutability (Section 33): Raw datasets (v1.0 RAW) are permanently locked. 
            All transformations generate auditable child versions with full data lineage.
          </p>
        </div>

        <button
          onClick={() => setIsImportOpen(true)}
          className="inline-flex items-center space-x-1.5 bg-slate-900 text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors"
        >
          <Upload className="w-4 h-4" />
          <span>Import Cohort Dataset</span>
        </button>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left List of Datasets */}
        <div className="lg:col-span-4 space-y-3">
          <div className="text-xs font-mono font-semibold text-slate-500 uppercase tracking-wider">
            Available Datasets ({datasets.length})
          </div>

          <div className="space-y-2">
            {datasets.map(ds => {
              const isSelected = selectedDatasetId === ds.id;
              return (
                <div
                  key={ds.id}
                  onClick={() => setSelectedDatasetId(ds.id)}
                  className={`p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                    isSelected 
                      ? 'bg-white border-slate-900 shadow-xs ring-1 ring-slate-900' 
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-slate-900">{ds.name}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                      {ds.source_format}
                    </span>
                  </div>
                  <p className="text-slate-500 mt-1 line-clamp-2 text-[11px]">{ds.description}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Dataset Deep Dive */}
        <div className="lg:col-span-8 space-y-4">
          {selectedDataset && selectedVersion ? (
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-5">
              {/* Dataset Meta Banner */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <h2 className="text-base font-bold text-slate-900">{selectedDataset.name}</h2>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                      {selectedVersion.version_tag}
                    </span>
                    {selectedVersion.is_raw && (
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">
                        RAW PROTECTED
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{selectedDataset.description}</p>
                </div>

                <button
                  onClick={() => setIsTransformOpen(true)}
                  className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Apply Transformation</span>
                </button>
              </div>

              {/* Version History / Lineage (Section 36) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono font-semibold text-slate-600 uppercase">
                    Version Lineage & Immutability Chain (Section 33)
                  </span>
                  <span className="text-slate-400 font-mono text-[10px]">
                    Hash Fingerprint Verifiable
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {versions.map(v => {
                    const isSelected = selectedVersionId === v.id;
                    return (
                      <button
                        key={v.id}
                        onClick={() => setSelectedVersionId(v.id)}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-semibold flex items-center space-x-1.5 transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        <GitCommit className="w-3.5 h-3.5" />
                        <span>{v.version_tag}</span>
                        <span className="text-[10px] opacity-70">({v.row_count} rows)</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Validation & Quality Report (Section 34) */}
              {selectedVersion.validation_report && (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 font-mono font-bold text-slate-800">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      <span>Validation Quality Report</span>
                    </div>
                    <div className="flex space-x-2 font-mono text-[11px]">
                      <span className="text-emerald-700 font-semibold">
                        Errors: {selectedVersion.validation_report.error_count ?? 0}
                      </span>
                      <span className="text-amber-700 font-semibold">
                        Warnings: {selectedVersion.validation_report.warning_count ?? selectedVersion.validation_report.warnings?.length ?? 0}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                    <div className="p-2 bg-white rounded border border-slate-200">
                      <span className="text-slate-400 block text-[10px]">Total Rows:</span>
                      <span className="font-bold text-slate-900">{selectedVersion.row_count ?? selectedVersion.data?.length ?? 0}</span>
                    </div>
                    <div className="p-2 bg-white rounded border border-slate-200">
                      <span className="text-slate-400 block text-[10px]">Columns:</span>
                      <span className="font-bold text-slate-900">{selectedVersion.column_count ?? selectedVersion.columns?.length ?? 0}</span>
                    </div>
                    <div className="p-2 bg-white rounded border border-slate-200">
                      <span className="text-slate-400 block text-[10px]">Missing Values:</span>
                      <span className="font-bold text-emerald-600">{selectedVersion.validation_report.missing_values_count ?? 0}</span>
                    </div>
                    <div className="p-2 bg-white rounded border border-slate-200">
                      <span className="text-slate-400 block text-[10px]">Outliers / Range:</span>
                      <span className="font-bold text-slate-700">{selectedVersion.validation_report.outlier_count ?? selectedVersion.validation_report.outliers_detected?.length ?? 0}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Data Table Preview (Section 32) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono font-semibold text-slate-600 uppercase">
                    Data Records Preview (First 20 Rows)
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    Provenance SHA: {(selectedVersion.provenance_hash || 'SHA256_UNCOMMITTED').slice(0, 16)}...
                  </span>
                </div>

                <div className="border border-slate-200 rounded-lg overflow-x-auto max-h-72">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 font-mono text-[10px] text-slate-500 uppercase sticky top-0">
                        {(selectedVersion.columns || selectedVersion.schema?.columns || []).map((col: any) => (
                          <th key={col.name} className="p-2.5 whitespace-nowrap">
                            <div>{col.name}</div>
                            <div className="text-slate-400 lowercase font-normal">[{col.detected_type || col.datatype}{col.unit ? ` • ${col.unit}` : ''}]</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                      {selectedVersion.data.map((row: any, idx: number) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          {(selectedVersion.columns || selectedVersion.schema?.columns || []).map((col: any) => (
                            <td key={col.name} className="p-2.5 whitespace-nowrap text-slate-800">
                              {typeof row[col.name] === 'number'
                                ? row[col.name].toFixed(2)
                                : String(row[col.name] ?? '-')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center bg-white rounded-xl border border-slate-200 text-xs text-slate-500">
              Select or import a dataset to inspect quality audits and immutable version lineages.
            </div>
          )}
        </div>
      </div>

      {/* IMPORT MODAL */}
      {isImportOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 w-full max-w-lg p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Import Cohort Dataset</h3>
              <button onClick={() => setIsImportOpen(false)} className="text-slate-400 hover:text-slate-600 text-sm font-semibold">✕</button>
            </div>

            <form onSubmit={handleImportSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Dataset Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Metabolic Rate Validation Cohort"
                  value={importName}
                  onChange={e => setImportName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  placeholder="Cohort characteristics, measurement protocol, demographic details..."
                  value={importDesc}
                  onChange={e => setImportDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">CSV Data Content (Header + Rows)</label>
                <textarea
                  rows={6}
                  placeholder="subject_id,age_years,weight_kg,stature_cm,sex&#10;SUBJ_01,24,68.5,172,Male&#10;SUBJ_02,29,54.0,163,Female"
                  value={importCsvText}
                  onChange={e => setImportCsvText(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs focus:outline-none"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsImportOpen(false)}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-2 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800"
                >
                  Lock into v1.0 RAW Pipeline
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TRANSFORMATION MODAL */}
      {isTransformOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Apply Scientific Transformation</h3>
              <button onClick={() => setIsTransformOpen(false)} className="text-slate-400 hover:text-slate-600 text-sm font-semibold">✕</button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Transformation Type</label>
                <select
                  value={transformType}
                  onChange={e => setTransformType(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white focus:outline-none"
                >
                  <option value="DERIVE_COLUMN">Derive Column via Registered AST Formula</option>
                  <option value="UNIT_CONVERT">Normalize Column Units</option>
                  <option value="FILTER_OUTLIERS">Filter Statistical Outliers</option>
                </select>
              </div>

              {transformType === 'DERIVE_COLUMN' && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Registered Formula</label>
                  <select
                    value={transformTargetFormula}
                    onChange={e => setTransformTargetFormula(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white focus:outline-none"
                  >
                    <option value="FORMULA_BMI_KEYES">Body Mass Index (FORMULA_BMI_KEYES)</option>
                  </select>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Evaluates formula row-by-row mapping input columns (weight_kg, stature_cm) and appends a verified output column.
                  </p>
                </div>
              )}

              <div className="p-2.5 rounded bg-blue-50 border border-blue-100 text-[11px] text-blue-900">
                In compliance with Section 33, this operation leaves source version unchanged and commits a new version tag (e.g. v1.1).
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsTransformOpen(false)}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApplyTransformation}
                  className="px-3 py-2 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800"
                >
                  Commit New Version
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
