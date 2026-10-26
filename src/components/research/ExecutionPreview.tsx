import React, { useState } from 'react';
import { 
  ExecutionPreview, 
  ExecutionAuthorization, 
  AuthorizedExecutionPacket,
  AuthorizedStatisticalExecutionResult 
} from '../../../scientific';
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  ShieldAlert, 
  Database, 
  Binary, 
  Cpu, 
  Copy, 
  Check, 
  Lock, 
  Layers, 
  FileText, 
  Hash, 
  Info,
  Calendar,
  X,
  ShieldCheck,
  UserCheck,
  Send,
  Zap,
  Play,
  BarChart3
} from 'lucide-react';

export interface ExecutionPreviewProps {
  preview: ExecutionPreview;
  onClose?: () => void;
  authorization?: ExecutionAuthorization | null;
  onAuthorize?: (authorizedBy: string) => void;
  dispatchPacket?: AuthorizedExecutionPacket | null;
  onDispatch?: () => void;
  executionResult?: AuthorizedStatisticalExecutionResult | null;
  onExecute?: () => void;
}

export const ExecutionPreviewView: React.FC<ExecutionPreviewProps> = ({ 
  preview, 
  onClose,
  authorization: initialAuthorization,
  onAuthorize,
  dispatchPacket,
  onDispatch,
  executionResult,
  onExecute
}) => {
  const [copiedHash, setCopiedHash] = useState(false);
  const [copiedChecksum, setCopiedChecksum] = useState(false);
  const [copiedAuthHash, setCopiedAuthHash] = useState(false);
  const [copiedDispatchHash, setCopiedDispatchHash] = useState(false);
  const [copiedExecHash, setCopiedExecHash] = useState(false);
  const [authorizedByInput, setAuthorizedByInput] = useState('Dr. Sarah Connor');
  const [currentAuth, setCurrentAuth] = useState<ExecutionAuthorization | null>(initialAuthorization || null);

  const isReady = preview.readiness_status === 'READY';

  const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAuthorizeClick = () => {
    if (!authorizedByInput.trim()) return;
    if (onAuthorize) {
      onAuthorize(authorizedByInput.trim());
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden space-y-0 text-slate-800">
      {/* Header */}
      <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-lg bg-slate-800 border border-slate-700">
            <Cpu className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="font-bold text-sm text-white tracking-wide">
                Execution Preview & Preflight Verification
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                Phase F2.2B
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              Deterministic read-only execution contract snapshot (Zero calculation)
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className={`px-3 py-1 rounded-full text-xs font-mono font-bold flex items-center space-x-1.5 border ${
            isReady 
              ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300' 
              : 'bg-rose-950/80 border-rose-500 text-rose-300'
          }`}>
            {isReady ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            <span>STATUS: {preview.readiness_status}</span>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Close Preview"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Scientific Validity Boundary Banner */}
      <div className="bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 flex items-start space-x-3 text-xs">
        <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <span className="font-mono font-bold text-amber-800 uppercase tracking-wider text-[11px]">
            SCIENTIFIC VALIDITY: {preview.scientific_validity}
          </span>
          <p className="text-amber-700 text-[11px] mt-0.5 leading-relaxed">
            This preview verifies deterministic structural, cryptographic, and schema eligibility only. It does NOT establish clinical, biological, or physiological validity, nor does it generate statistical results.
          </p>
        </div>
      </div>

      {/* Main Grid Content */}
      <div className="p-6 space-y-6">
        {/* Errors & Warnings if Blocked */}
        {preview.errors.length > 0 && (
          <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 space-y-2">
            <div className="flex items-center space-x-2 text-rose-800 font-semibold text-xs">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <span>Blocking Preflight Violations ({preview.errors.length})</span>
            </div>
            <ul className="space-y-1.5 text-xs text-rose-700 pl-6 list-disc">
              {preview.errors.map((err, idx) => (
                <li key={idx} className="font-mono text-[11px] leading-relaxed">
                  {err}
                </li>
              ))}
            </ul>
          </div>
        )}

        {preview.warnings.length > 0 && (
          <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 space-y-2">
            <div className="flex items-center space-x-2 text-amber-800 font-semibold text-xs">
              <Info className="w-4 h-4 text-amber-600" />
              <span>Preflight Advisory Warnings ({preview.warnings.length})</span>
            </div>
            <ul className="space-y-1 text-xs text-amber-700 pl-6 list-disc">
              {preview.warnings.map((warn, idx) => (
                <li key={idx} className="font-mono text-[11px]">
                  {warn}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 2x2 Grid of Contract Sections */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Section 1: Research Project & Analysis */}
          <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 space-y-3">
            <div className="flex items-center space-x-2 border-b border-slate-200 pb-2">
              <FileText className="w-4 h-4 text-slate-700" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                1. Project & Analysis Plan
              </h4>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Project ID:</span>
                <span className="font-mono font-semibold text-slate-900">{preview.project_id}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Project Version:</span>
                <span className="font-mono text-slate-800">{preview.project_version}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Analysis Plan ID:</span>
                <span className="font-mono font-bold text-indigo-700">{preview.analysis_id}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Analysis Plan Version:</span>
                <span className="font-mono text-slate-800">{preview.analysis_plan_version}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Analysis Type:</span>
                <span className="font-mono px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-semibold text-[11px]">
                  {preview.analysis_type}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Objective ID:</span>
                <span className="font-mono font-semibold text-slate-800">{preview.objective_id}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Hypothesis ID:</span>
                <span className="font-mono text-slate-700">{preview.hypothesis_id || 'None (Exploratory / Unhypothesized)'}</span>
              </div>
            </div>
          </div>

          {/* Section 2: Exact Dataset & Artifact Binding */}
          <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 space-y-3">
            <div className="flex items-center space-x-2 border-b border-slate-200 pb-2">
              <Database className="w-4 h-4 text-slate-700" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                2. Data Layer & Cryptographic Binding
              </h4>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Dataset Version:</span>
                <span className="font-mono font-semibold text-slate-900">{preview.dataset_version_id || 'Not Bound'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Data Artifact ID:</span>
                <span className="font-mono font-semibold text-slate-900">{preview.data_artifact_id || 'Not Bound'}</span>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Source Checksum:</span>
                  {preview.source_artifact_checksum && (
                    <button
                      onClick={() => copyToClipboard(preview.source_artifact_checksum, setCopiedChecksum)}
                      className="text-[10px] text-indigo-600 hover:text-indigo-800 flex items-center space-x-1"
                    >
                      {copiedChecksum ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedChecksum ? 'Copied' : 'Copy'}</span>
                    </button>
                  )}
                </div>
                <div className="p-1.5 rounded bg-slate-100 font-mono text-[10px] text-slate-700 break-all select-all">
                  {preview.source_artifact_checksum || 'No checksum available'}
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Variables & Parameters */}
          <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 space-y-3">
            <div className="flex items-center space-x-2 border-b border-slate-200 pb-2">
              <Binary className="w-4 h-4 text-slate-700" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                3. Variable Schema & Parameters
              </h4>
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <span className="text-slate-500 block mb-1">Input Variables ({preview.input_variable_ids.length}):</span>
                <div className="flex flex-wrap gap-1">
                  {preview.input_variable_ids.length > 0 ? (
                    preview.input_variable_ids.map((v) => (
                      <span key={v} className="font-mono text-[10px] px-2 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-900">
                        {v}
                      </span>
                    ))
                  ) : (
                    <span className="text-rose-500 font-mono text-[10px]">None specified (Violation)</span>
                  )}
                </div>
              </div>

              {preview.grouping_variable_ids && preview.grouping_variable_ids.length > 0 && (
                <div>
                  <span className="text-slate-500 block mb-1">Grouping Variables:</span>
                  <div className="flex flex-wrap gap-1">
                    {preview.grouping_variable_ids.map((v) => (
                      <span key={v} className="font-mono text-[10px] px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-900">
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {preview.pairing_variable_ids && preview.pairing_variable_ids.length > 0 && (
                <div>
                  <span className="text-slate-500 block mb-1">Pairing Variables:</span>
                  <div className="flex flex-wrap gap-1">
                    {preview.pairing_variable_ids.map((v) => (
                      <span key={v} className="font-mono text-[10px] px-2 py-0.5 rounded bg-purple-50 border border-purple-200 text-purple-900">
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 border-t border-slate-200/60 grid grid-cols-2 gap-2">
                <div>
                  <span className="text-slate-400 text-[10px] block">Significance Alpha (α):</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {preview.alpha !== undefined ? preview.alpha : 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] block">Confidence Level:</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {preview.confidence_level !== undefined ? `${(preview.confidence_level * 100).toFixed(0)}%` : 'N/A'}
                  </span>
                </div>
              </div>

              {preview.resolved_parameter_set_id && (
                <div className="pt-1">
                  <span className="text-slate-400 text-[10px] block">Resolved Parameter Set:</span>
                  <span className="font-mono text-slate-800 font-semibold">{preview.resolved_parameter_set_id}</span>
                </div>
              )}
            </div>
          </div>

          {/* Section 4: Authoritative Scientific Module */}
          <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 space-y-3">
            <div className="flex items-center space-x-2 border-b border-slate-200 pb-2">
              <Cpu className="w-4 h-4 text-slate-700" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                4. Authoritative Scientific Module
              </h4>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Module ID:</span>
                <span className="font-mono font-bold text-slate-900">{preview.resolved_module_id}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Module Version:</span>
                <span className="font-mono text-slate-800">{preview.resolved_module_version}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Execution Request ID:</span>
                <span className="font-mono text-[11px] text-slate-700">
                  {preview.execution_request_id || 'None (Blocked)'}
                </span>
              </div>

              <div className="mt-3 p-2.5 rounded bg-blue-50 border border-blue-200 text-blue-800 text-[11px] space-y-1">
                <div className="font-semibold flex items-center space-x-1">
                  <Lock className="w-3 h-3 text-blue-700" />
                  <span>Deterministic Module Identity Binding</span>
                </div>
                <p className="text-[10px] text-blue-700 leading-normal">
                  Module identity resolved without dynamic guessing. Downstream statistical invocation is strictly deferred to Phase F2.2C.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Declarative Configuration Preview */}
        <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Declarative Configuration Payload
            </span>
            <span className="text-[10px] font-mono text-slate-400">Pure declarative JSON</span>
          </div>
          <pre className="p-3 bg-slate-900 text-slate-100 font-mono text-[11px] rounded-lg overflow-x-auto max-h-36">
            {JSON.stringify(preview.configuration, null, 2)}
          </pre>
        </div>

        {/* Cryptographic Provenance Hash */}
        <div className="p-4 rounded-lg border border-slate-200 bg-slate-900 text-white space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Hash className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                Preview Provenance Digest (SHA-256)
              </span>
            </div>
            <button
              onClick={() => copyToClipboard(preview.provenance_hash, setCopiedHash)}
              className="text-[11px] font-mono text-emerald-400 hover:text-emerald-300 flex items-center space-x-1 bg-slate-800 px-2 py-1 rounded border border-slate-700"
            >
              {copiedHash ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              <span>{copiedHash ? 'Digest Copied' : 'Copy SHA-256'}</span>
            </button>
          </div>
          <p className="font-mono text-xs text-slate-300 break-all select-all">
            {preview.provenance_hash}
          </p>
          <div className="text-[10px] text-slate-400 font-mono flex items-center justify-between pt-1 border-t border-slate-800">
            <span>Snapshot Created: {preview.created_at}</span>
            <span>Deterministic Canonical JSON Hashing</span>
          </div>
        </div>

        {/* Phase F2.2C.1: Execution Authorization Gate Section */}
        {initialAuthorization ? (
          <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-300 space-y-3">
            <div className="flex items-center justify-between border-b border-emerald-200 pb-2">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-5 h-5 text-emerald-700" />
                <span className="font-bold text-xs uppercase tracking-wider text-emerald-900">
                  Execution Authorization Gate: AUTHORIZED
                </span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-200 text-emerald-900 font-bold">
                Phase F2.2C.1 Gate Cleared
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-600">Authorization ID:</span>
                <span className="font-mono font-bold text-emerald-950">{initialAuthorization.authorization_id}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600">Authorized By:</span>
                <span className="font-mono font-semibold text-slate-900">{initialAuthorization.authorized_by}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600">Authorized At:</span>
                <span className="font-mono text-slate-700">{initialAuthorization.authorized_at}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600">Status:</span>
                <span className="font-mono font-bold text-emerald-700">{initialAuthorization.status}</span>
              </div>
            </div>

            <div className="p-2 rounded bg-white border border-emerald-200 text-[11px] font-mono space-y-1">
              <div className="flex justify-between items-center text-slate-500">
                <span>Authorization Digest (SHA-256):</span>
                <button
                  onClick={() => copyToClipboard(initialAuthorization.authorization_hash, setCopiedAuthHash)}
                  className="text-emerald-700 hover:text-emerald-900 flex items-center space-x-1"
                >
                  {copiedAuthHash ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedAuthHash ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <div className="break-all text-slate-800 font-semibold select-all text-[10px]">
                {initialAuthorization.authorization_hash}
              </div>
            </div>

            <p className="text-[11px] text-emerald-800 italic">
              Authorization snapshot is deeply immutable. Downstream execution engine is strictly deferred to future phases.
            </p>

            {/* Phase F2.2C.2: Authorized Execution Adapter */}
            <div className="mt-3 p-3 rounded-lg bg-indigo-50/60 border border-indigo-200 space-y-2">
              <div className="flex items-center justify-between border-b border-indigo-200 pb-2">
                <div className="flex items-center space-x-2">
                  <Cpu className="w-4 h-4 text-indigo-700" />
                  <span className="font-bold text-xs uppercase tracking-wider text-indigo-900">
                    Authorized Execution Adapter (Phase F2.2C.2)
                  </span>
                </div>
                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                  dispatchPacket
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : 'bg-indigo-100 text-indigo-800 border border-indigo-300'
                }`}>
                  {dispatchPacket ? 'DISPATCH READY' : 'READY FOR ADAPTER DISPATCH'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-500 text-[11px]">Target Scientific Module:</span>
                  <div className="font-mono font-semibold text-indigo-950">
                    {preview.resolved_module_id} <span className="text-[10px] text-indigo-600 font-normal">v{preview.resolved_module_version}</span>
                  </div>
                </div>
                <div>
                  <span className="text-slate-500 text-[11px]">Pinned Artifact & Checksum:</span>
                  <div className="font-mono text-[11px] text-slate-700 truncate" title={preview.source_artifact_checksum}>
                    {preview.data_artifact_id} · <span className="text-slate-500">{preview.source_artifact_checksum.slice(0, 10)}…</span>
                  </div>
                </div>
              </div>

              {dispatchPacket ? (
                <div className="space-y-2 pt-1 border-t border-indigo-200">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-600 font-medium">Dispatch ID:</span>
                    <span className="font-mono text-indigo-900 font-bold">{dispatchPacket.dispatch_id}</span>
                  </div>
                  <div className="p-2 rounded bg-white border border-indigo-200 text-[11px] font-mono space-y-1">
                    <div className="flex justify-between items-center text-slate-500">
                      <span>Dispatch Provenance Hash (SHA-256):</span>
                      <button
                        onClick={() => copyToClipboard(dispatchPacket.dispatch_hash, setCopiedDispatchHash)}
                        className="text-indigo-700 hover:text-indigo-900 flex items-center space-x-1"
                      >
                        {copiedDispatchHash ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedDispatchHash ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    <div className="break-all text-slate-800 font-semibold select-all text-[10px]">
                      {dispatchPacket.dispatch_hash}
                    </div>
                  </div>
                  <p className="text-[10px] text-indigo-800 italic">
                    Adapter packet generated &amp; verified against all 13 boundary invariants. Scientific validity: NOT_ESTABLISHED (D9–D13 statistical calculations untouched).
                  </p>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-2 border-t border-indigo-200">
                  <p className="text-[11px] text-slate-600">
                    Click to generate immutable execution packet for the authoritative scientific engine.
                  </p>
                  {onDispatch && (
                    <button
                      type="button"
                      onClick={onDispatch}
                      className="px-4 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white font-semibold text-xs flex items-center justify-center space-x-1.5 transition-colors shadow-xs shrink-0"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Dispatch to Adapter</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Phase F2.2C.3: Actual Statistical Execution */}
            {dispatchPacket && (
              <div className="mt-3 p-3.5 rounded-lg bg-emerald-50/70 border border-emerald-300 space-y-3">
                <div className="flex items-center justify-between border-b border-emerald-200 pb-2">
                  <div className="flex items-center space-x-2">
                    <BarChart3 className="w-4 h-4 text-emerald-700" />
                    <span className="font-bold text-xs uppercase tracking-wider text-emerald-950">
                      Actual Statistical Execution (Phase F2.2C.3)
                    </span>
                  </div>
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                    executionResult
                      ? 'bg-emerald-600 text-white'
                      : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  }`}>
                    {executionResult ? 'COMPLETED' : 'READY TO EXECUTE'}
                  </span>
                </div>

                {executionResult ? (
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between text-xs gap-2">
                      <div>
                        <span className="text-slate-500 text-[11px]">Execution ID:</span>
                        <div className="font-mono font-bold text-emerald-950">{executionResult.execution_id}</div>
                      </div>
                      <div>
                        <span className="text-slate-500 text-[11px]">Engine Invoked:</span>
                        <div className="font-mono text-emerald-800 font-semibold">{executionResult.module_id} v{executionResult.module_version}</div>
                      </div>
                      <div>
                        <span className="text-slate-500 text-[11px]">Audit Trace:</span>
                        <div className="font-mono text-slate-700">{executionResult.trace.length} verified steps</div>
                      </div>
                    </div>

                    {/* Calculated Numerical Outputs */}
                    <div className="p-2.5 rounded bg-white border border-emerald-200 space-y-1.5">
                      <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                        <span>Calculated Statistical Outputs:</span>
                        <span className="text-[10px] font-normal text-slate-500">Deterministic Engine Output</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                        {Object.entries(executionResult.execution_result.outputs).map(([key, val]) => (
                          <div key={key} className="p-1.5 rounded bg-slate-50 border border-slate-200 text-xs font-mono">
                            <span className="text-[10px] text-slate-500 block truncate">{key}</span>
                            <span className="font-bold text-slate-900">
                              {typeof val.value === 'number'
                                ? val.value.toLocaleString(undefined, { maximumFractionDigits: 5 })
                                : String(val.value)}
                            </span>
                            {val.unit && <span className="text-[10px] text-slate-500 ml-1">{val.unit}</span>}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Execution Provenance Digest */}
                    <div className="p-2 rounded bg-white border border-emerald-200 text-[11px] font-mono space-y-1">
                      <div className="flex justify-between items-center text-slate-500">
                        <span>Execution Provenance Digest (SHA-256):</span>
                        <button
                          onClick={() => copyToClipboard(executionResult.provenance_hash, setCopiedExecHash)}
                          className="text-emerald-700 hover:text-emerald-900 flex items-center space-x-1"
                        >
                          {copiedExecHash ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedExecHash ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                      <div className="break-all text-slate-800 font-semibold select-all text-[10px]">
                        {executionResult.provenance_hash}
                      </div>
                    </div>

                    {/* Governance Notice */}
                    <div className="p-2 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-900 leading-relaxed font-mono">
                      <strong>STATUS: COMPLETED</strong> · <strong>SOFTWARE VALIDATION: PASS</strong> · <strong>SCIENTIFIC VALIDATION: NOT_ESTABLISHED</strong>
                      <p className="font-sans text-[11px] text-amber-800 pt-0.5">
                        Mathematical calculations executed successfully by authoritative scientific core. Scientific/clinical validity is explicitly not established.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
                    <p className="text-[11px] text-slate-700 leading-relaxed">
                      All 13 gate invariants are verified. Ready to invoke authoritative scientific engine <strong>{preview.resolved_module_id}</strong> on version-locked dataset artifact.
                    </p>
                    {onExecute && (
                      <button
                        type="button"
                        onClick={onExecute}
                        className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs flex items-center justify-center space-x-1.5 transition-colors shadow-xs shrink-0"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Execute Statistics</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center space-x-2">
                <UserCheck className="w-4 h-4 text-slate-700" />
                <span className="font-bold text-xs uppercase tracking-wider text-slate-700">
                  Execution Authorization Gate (Phase F2.2C.1)
                </span>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                Explicit User Action Required (Preview ≠ Authorization)
              </span>
            </div>

            <p className="text-[11px] text-slate-600 leading-relaxed">
              Previewing this analysis does <strong>NOT</strong> authorize execution automatically. Authorizing records an explicit, immutable governance permission for downstream execution. <em>No statistical calculations will occur.</em>
            </p>

            {isReady ? (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
                <div className="flex-1">
                  <input
                    type="text"
                    value={authorizedByInput}
                    onChange={(e) => setAuthorizedByInput(e.target.value)}
                    placeholder="Authorizing Researcher Name / ID"
                    className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-300 font-mono text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAuthorizeClick}
                  disabled={!authorizedByInput.trim()}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs flex items-center justify-center space-x-1.5 transition-colors shadow-xs"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Authorize Execution</span>
                </button>
              </div>
            ) : (
              <div className="p-2 rounded bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-mono">
                Authorization unavailable: Preflight validation is BLOCKED. Resolve errors to enable authorization gate.
              </div>
            )}
          </div>
        )}

        {/* Footer & Future Phase Controls */}
        <div className="pt-2 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {isReady ? (
              <span className="text-emerald-700 font-medium flex items-center space-x-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Preflight check complete. Eligible for downstream Phase F2.2C execution.</span>
              </span>
            ) : (
              <span className="text-rose-700 font-medium flex items-center space-x-1">
                <XCircle className="w-3.5 h-3.5 text-rose-600" />
                <span>Execution blocked. Resolve preflight errors before proceeding.</span>
              </span>
            )}
          </div>

          <div className="flex items-center space-x-3">
            {executionResult ? (
              <div className="px-3.5 py-1.5 rounded-lg bg-emerald-100 border border-emerald-300 text-emerald-800 font-bold text-xs flex items-center space-x-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Execution Completed</span>
              </div>
            ) : dispatchPacket ? (
              <button
                type="button"
                onClick={onExecute}
                className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs flex items-center space-x-1.5 transition-colors shadow-xs"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Execute Analysis (F2.2C.3)</span>
              </button>
            ) : (
              <button
                disabled
                title="Actual statistical execution strictly requires an Authorized Execution Dispatch."
                className="px-4 py-2 rounded-lg bg-slate-200 text-slate-400 cursor-not-allowed font-semibold text-xs flex items-center space-x-1.5 border border-slate-300"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Execute (Requires Dispatch)</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExecutionPreviewView;
