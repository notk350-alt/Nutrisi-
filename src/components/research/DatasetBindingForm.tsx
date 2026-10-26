import React, { useState, useEffect } from 'react';
import { 
  ResearchProject, 
  DatasetVersion, 
  DataArtifact 
} from '../../../scientific';
import { 
  ResearchWorkspaceService, 
  BindDatasetFormData 
} from '../../services/researchWorkspaceService';
import { 
  Database, 
  CheckCircle2, 
  AlertCircle, 
  ShieldCheck, 
  Link2, 
  Lock, 
  GitFork, 
  FileText 
} from 'lucide-react';

interface DatasetBindingFormProps {
  project: ResearchProject;
  service: ResearchWorkspaceService;
  onProjectUpdated: (project: ResearchProject) => void;
}

export const DatasetBindingForm: React.FC<DatasetBindingFormProps> = ({
  project,
  service,
  onProjectUpdated
}) => {
  const [versions, setVersions] = useState<DatasetVersion[]>([]);
  const [artifacts, setArtifacts] = useState<DataArtifact[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>('');
  const [bindingNotes, setBindingNotes] = useState<string>('');

  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isImmutable = project.status === 'FINALIZED' || project.status === 'ARCHIVED';

  // Load versions on mount
  useEffect(() => {
    const vList = service.listDatasetVersions();
    setVersions(vList);

    // If project already has a binding, select it
    if (project.dataset_binding) {
      setSelectedVersionId(project.dataset_binding.dataset_version_id);
      setSelectedArtifactId(project.dataset_binding.data_artifact_id);
      if (project.dataset_binding.binding_notes) {
        setBindingNotes(project.dataset_binding.binding_notes);
      }
    } else if (vList.length > 0 && !selectedVersionId) {
      setSelectedVersionId(vList[0].version_id);
    }
  }, [project, service]);

  // Load artifacts when selectedVersionId changes
  useEffect(() => {
    if (selectedVersionId) {
      const artList = service.listArtifacts(selectedVersionId);
      setArtifacts(artList);
      if (artList.length > 0) {
        if (!artList.some((a) => a.artifact_id === selectedArtifactId)) {
          setSelectedArtifactId(artList[0].artifact_id);
        }
      } else {
        setSelectedArtifactId('');
      }
    } else {
      setArtifacts([]);
      setSelectedArtifactId('');
    }
  }, [selectedVersionId, service]);

  // Selected artifact details for real-time inspection
  const activeArtifact = artifacts.find((a) => a.artifact_id === selectedArtifactId);
  const activeVersion = versions.find((v) => v.version_id === selectedVersionId);

  const handleBind = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (isImmutable) {
      setError(`Cannot bind dataset: Project '${project.project_id}' is ${project.status} and permanently immutable.`);
      return;
    }

    if (!selectedVersionId) {
      setError('Please select a dataset version.');
      return;
    }
    if (!selectedArtifactId) {
      setError('Please select a data artifact.');
      return;
    }

    try {
      setIsSubmitting(true);
      const data: BindDatasetFormData = {
        project_id: project.project_id,
        dataset_version_id: selectedVersionId,
        data_artifact_id: selectedArtifactId,
        binding_notes: bindingNotes.trim() || undefined
      };

      const updated = service.bindDataset(data);
      onProjectUpdated(updated);
      setSuccessMsg(`Dataset version '${selectedVersionId}' and artifact '${selectedArtifactId}' bound successfully.`);
    } catch (err: any) {
      setError(err.message || 'Dataset binding failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="border-b border-slate-200 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Database className="w-5 h-5 text-slate-800" />
            <h2 className="text-base font-bold text-slate-900">Form 2: Dataset & Artifact Binding</h2>
          </div>
          <div className="text-xs font-mono text-slate-500">
            Project: <span className="font-semibold text-slate-800">{project.project_id}</span> ({project.status})
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Cryptographically pin a sealed dataset version and specific data artifact with checksum verification.
        </p>
      </div>

      {/* Immutability Banner */}
      {isImmutable && (
        <div className="p-4 rounded-lg bg-slate-100 border border-slate-300 text-slate-700 text-xs flex items-center space-x-2.5">
          <Lock className="w-4 h-4 text-slate-600 shrink-0" />
          <div>
            <span className="font-semibold">Project Immutability Lock:</span> Project is in{' '}
            <span className="font-mono font-bold">{project.status}</span> state. No dataset bindings or modifications can be made.
          </div>
        </div>
      )}

      {/* Messages */}
      {error && (
        <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start space-x-2.5">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Binding Rejection</div>
            <div className="mt-0.5">{error}</div>
          </div>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center space-x-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <div>{successMsg}</div>
        </div>
      )}

      {/* Current Binding Summary if already bound */}
      {project.dataset_binding && (
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono font-semibold text-slate-700 uppercase tracking-wider text-[11px]">
              Active Dataset Binding
            </span>
            <span className="text-[11px] text-emerald-700 font-medium flex items-center space-x-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Cryptographically Verified</span>
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-slate-600">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-mono">Dataset Version</span>
              <span className="font-mono font-semibold text-slate-800">{project.dataset_binding.dataset_version_id}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-mono">Data Artifact</span>
              <span className="font-mono font-semibold text-slate-800">{project.dataset_binding.data_artifact_id}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-mono">Bound At</span>
              <span className="font-mono text-slate-700">
                {new Date(project.dataset_binding.bound_at).toLocaleString()}
              </span>
            </div>
            <div className="sm:col-span-3">
              <span className="text-slate-400 block text-[10px] uppercase font-mono">Source Artifact Checksum</span>
              <span className="font-mono text-slate-800 break-all text-[11px]">
                {project.dataset_binding.source_artifact_checksum}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Form Controls */}
      <form onSubmit={handleBind} className="space-y-6 text-xs">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Dataset Version Selector */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Select Dataset Version <span className="text-rose-600">*</span>
            </label>
            <select
              id="select-dataset-version"
              disabled={isImmutable}
              value={selectedVersionId}
              onChange={(e) => setSelectedVersionId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:bg-slate-100 disabled:cursor-not-allowed"
            >
              <option value="">-- Choose Dataset Version --</option>
              {versions.map((v) => (
                <option key={v.version_id} value={v.version_id}>
                  {v.version_id} (tag: {v.version_tag || 'none'}, {v.record_count ?? 0} records, status: {v.status})
                </option>
              ))}
            </select>
          </div>

          {/* Data Artifact Selector */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Select Data Artifact <span className="text-rose-600">*</span>
            </label>
            <select
              id="select-data-artifact"
              disabled={isImmutable || !selectedVersionId}
              value={selectedArtifactId}
              onChange={(e) => setSelectedArtifactId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:bg-slate-100 disabled:cursor-not-allowed"
            >
              <option value="">-- Choose Data Artifact --</option>
              {artifacts.map((a) => (
                <option key={a.artifact_id} value={a.artifact_id}>
                  {a.artifact_id} [State: {a.state}] ({a.record_count ?? 0} rows)
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Real-time Display Panel for Selected Artifact */}
        {activeArtifact && (
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <span className="font-mono text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Selected Artifact Verification Panel
              </span>
              <span className="text-[11px] text-slate-500 font-mono">
                State: <span className="font-semibold text-slate-800">{activeArtifact.state}</span>
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <span className="text-[10px] uppercase font-mono text-slate-400 block">Dataset Version</span>
                <span className="font-mono font-medium text-slate-800">{activeArtifact.dataset_version_id}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-mono text-slate-400 block">Record Count</span>
                <span className="font-mono font-medium text-slate-800">{activeArtifact.record_count ?? 'N/A'}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-mono text-slate-400 block">Variable Count</span>
                <span className="font-mono font-medium text-slate-800">{activeArtifact.column_count ?? 'N/A'}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-mono text-slate-400 block">Lineage Status</span>
                <span className="font-mono font-medium text-slate-800">
                  {activeArtifact.parent_artifact_id
                    ? `Child of ${activeArtifact.parent_artifact_id}`
                    : 'Lineage Root (RAW Ingest)'}
                </span>
              </div>
              <div className="col-span-2 sm:col-span-4">
                <span className="text-[10px] uppercase font-mono text-slate-400 block">Artifact SHA-256 Checksum</span>
                <span className="font-mono text-slate-800 text-[11px] break-all select-all">
                  {activeArtifact.checksum}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Optional Binding Notes */}
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Binding Notes & Rationale</label>
          <input
            id="input-binding-notes"
            type="text"
            disabled={isImmutable}
            placeholder="e.g. Analysis-ready cohort ingest verified after outlier removal and schema validation."
            value={bindingNotes}
            onChange={(e) => setBindingNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:bg-slate-100"
          />
        </div>

        {/* Governance Notice */}
        <div className="text-[11px] text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-200">
          <strong>Dataset Binding Governance:</strong> NutriBodySim strictly rejects missing datasets, missing
          artifacts, cross-version artifact mismatches, and checksum corruptions. It never silently switches to another
          dataset.
        </div>

        {/* Submit */}
        <div className="pt-4 border-t border-slate-200 flex justify-end">
          <button
            id="btn-submit-bind-dataset"
            type="submit"
            disabled={isSubmitting || isImmutable || !selectedArtifactId}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-slate-900 text-white font-semibold rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <Link2 className="w-4 h-4" />
            <span>{isSubmitting ? 'Verifying & Binding...' : 'Bind Dataset & Verify Artifact Integrity'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
