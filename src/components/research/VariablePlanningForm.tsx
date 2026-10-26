import React, { useState, useEffect } from 'react';
import { 
  ResearchProject, 
  Variable, 
  VariableRole 
} from '../../../scientific';
import { 
  ResearchWorkspaceService, 
  PlanVariableFormData 
} from '../../services/researchWorkspaceService';
import { 
  Binary, 
  CheckCircle2, 
  AlertCircle, 
  ShieldAlert, 
  Plus, 
  Lock, 
  Tag, 
  Info 
} from 'lucide-react';

interface VariablePlanningFormProps {
  project: ResearchProject;
  service: ResearchWorkspaceService;
  onProjectUpdated: (project: ResearchProject) => void;
}

const VARIABLE_ROLES: { role: VariableRole; label: string; desc: string }[] = [
  { role: 'OUTCOME', label: 'OUTCOME (Dependent / Target)', desc: 'Primary response or endpoint of interest.' },
  { role: 'EXPOSURE', label: 'EXPOSURE (Primary Independent)', desc: 'Intervention, diet, or focal risk factor.' },
  { role: 'PREDICTOR', label: 'PREDICTOR (Independent)', desc: 'Predictive feature in prognostic or regression models.' },
  { role: 'COVARIATE', label: 'COVARIATE (Confounder / Adjuster)', desc: 'Background variable controlled to mitigate confounding.' },
  { role: 'GROUPING', label: 'GROUPING (Between-Subject Factor)', desc: 'Categorical arm, treatment group, or classification.' },
  { role: 'PAIRING', label: 'PAIRING (Subject / Match Key)', desc: 'Subject ID or matching identifier for dependent samples.' },
  { role: 'TIME', label: 'TIME (Longitudinal Index)', desc: 'Timepoint, visit, or temporal measurement interval.' },
  { role: 'STRATIFICATION', label: 'STRATIFICATION (Subgroup)', desc: 'Variable defining subgroup analyses or strata.' },
  { role: 'OTHER', label: 'OTHER (Exploratory / Unassigned)', desc: 'Contextual or descriptive measurement.' }
];

export const VariablePlanningForm: React.FC<VariablePlanningFormProps> = ({
  project,
  service,
  onProjectUpdated
}) => {
  const [registryVariables, setRegistryVariables] = useState<Variable[]>([]);
  const [selectedVariableId, setSelectedVariableId] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<VariableRole>('EXPOSURE');
  const [rationale, setRationale] = useState<string>('');
  const [expectedUnit, setExpectedUnit] = useState<string>('');
  const [transformation, setTransformation] = useState<string>('');

  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isImmutable = project.status === 'FINALIZED' || project.status === 'ARCHIVED';

  useEffect(() => {
    const vars = service.listVariables();
    setRegistryVariables(vars);
    if (vars.length > 0 && !selectedVariableId) {
      setSelectedVariableId(vars[0].variable_id);
      setExpectedUnit(vars[0].unit || '');
    }
  }, [service]);

  // When variable changes, update prefilled unit
  const handleVariableChange = (varId: string) => {
    setSelectedVariableId(varId);
    const found = registryVariables.find((v) => v.variable_id === varId);
    if (found && found.unit) {
      setExpectedUnit(found.unit);
    }
  };

  const handlePlanVariable = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (isImmutable) {
      setError(`Cannot plan variables: Project '${project.project_id}' is ${project.status} and permanently immutable.`);
      return;
    }

    if (!selectedVariableId) {
      setError('Please select a variable from the Variable Registry.');
      return;
    }

    try {
      setIsSubmitting(true);
      const data: PlanVariableFormData = {
        project_id: project.project_id,
        variable_id: selectedVariableId,
        role: selectedRole,
        rationale: rationale.trim() || undefined,
        expected_unit: expectedUnit.trim() || undefined,
        transformation: transformation.trim() || undefined
      };

      const updated = service.planVariable(data);
      onProjectUpdated(updated);
      setSuccessMsg(`Variable '${selectedVariableId}' planned with role '${selectedRole}'.`);
      setRationale('');
      setTransformation('');
    } catch (err: any) {
      setError(err.message || 'Variable planning failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedVarDetails = registryVariables.find((v) => v.variable_id === selectedVariableId);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="border-b border-slate-200 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Binary className="w-5 h-5 text-slate-800" />
            <h2 className="text-base font-bold text-slate-900">Form 3: Variable Role Planning</h2>
          </div>
          <div className="text-xs font-mono text-slate-500">
            Project: <span className="font-semibold text-slate-800">{project.project_id}</span> ({project.status})
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Assign research roles to semantic variables from the Variable Registry. Variable roles are descriptive metadata only.
        </p>
      </div>

      {/* Governance & Anti-Causality Disclaimer */}
      <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-lg text-amber-900 text-[11px] flex items-start space-x-2.5">
        <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <strong>Scientific Architecture Rule:</strong> Variable roles are metadata only. Assigning a variable as{' '}
          <span className="font-mono font-semibold">EXPOSURE</span> or{' '}
          <span className="font-mono font-semibold">OUTCOME</span> does NOT infer causal relationships. The underlying
          Variable Registry remains completely unaltered.
        </div>
      </div>

      {/* Immutability Banner */}
      {isImmutable && (
        <div className="p-4 rounded-lg bg-slate-100 border border-slate-300 text-slate-700 text-xs flex items-center space-x-2.5">
          <Lock className="w-4 h-4 text-slate-600 shrink-0" />
          <div>
            <span className="font-semibold">Project Immutability Lock:</span> Project is in{' '}
            <span className="font-mono font-bold">{project.status}</span> state. Variable plans are locked.
          </div>
        </div>
      )}

      {/* Messages */}
      {error && (
        <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start space-x-2.5">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Planning Error</div>
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

      {/* Form Controls */}
      <form onSubmit={handlePlanVariable} className="space-y-4 text-xs">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Variable Selection from Registry */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Select Variable from Registry <span className="text-rose-600">*</span>
            </label>
            <select
              id="select-variable-registry"
              disabled={isImmutable}
              value={selectedVariableId}
              onChange={(e) => handleVariableChange(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:bg-slate-100"
            >
              <option value="">-- Choose Registered Variable --</option>
              {registryVariables.map((v) => (
                <option key={v.variable_id} value={v.variable_id}>
                  {v.name} ({v.variable_id}) [{v.category}]
                </option>
              ))}
            </select>
            {selectedVarDetails && (
              <div className="mt-1.5 text-[11px] text-slate-500 space-x-2">
                <span>Unit: <strong className="font-mono text-slate-700">{selectedVarDetails.unit || 'unitless'}</strong></span>
                <span aria-hidden="true">·</span>
                <span>Type: <strong className="font-mono text-slate-700">{selectedVarDetails.datatype}</strong></span>
                <span aria-hidden="true">·</span>
                <span>Semantic: <strong className="font-mono text-slate-700">{selectedVarDetails.semantic_type}</strong></span>
              </div>
            )}
          </div>

          {/* Role Selection */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Assign Research Role <span className="text-rose-600">*</span>
            </label>
            <select
              id="select-variable-role"
              disabled={isImmutable}
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as VariableRole)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:bg-slate-100"
            >
              {VARIABLE_ROLES.map((r) => (
                <option key={r.role} value={r.role}>
                  {r.label}
                </option>
              ))}
            </select>
            <div className="mt-1.5 text-[11px] text-slate-500">
              {VARIABLE_ROLES.find((r) => r.role === selectedRole)?.desc}
            </div>
          </div>

          {/* Expected Unit */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Expected Physical Unit</label>
            <input
              id="input-expected-unit"
              type="text"
              disabled={isImmutable}
              placeholder="e.g. mg/dL, kg, g/day"
              value={expectedUnit}
              onChange={(e) => setExpectedUnit(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:bg-slate-100"
            />
          </div>

          {/* Transformation */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Planned Transformation (Optional)</label>
            <input
              id="input-transformation"
              type="text"
              disabled={isImmutable}
              placeholder="e.g. log10, z_score, mean_center"
              value={transformation}
              onChange={(e) => setTransformation(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:bg-slate-100"
            />
          </div>

          {/* Rationale */}
          <div className="md:col-span-2">
            <label className="block font-semibold text-slate-700 mb-1">Planning Rationale</label>
            <input
              id="input-variable-rationale"
              type="text"
              disabled={isImmutable}
              placeholder="e.g. Primary exposure for testing the fiber-glycemia hypothesis."
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:bg-slate-100"
            />
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            id="btn-submit-plan-variable"
            type="submit"
            disabled={isSubmitting || isImmutable || !selectedVariableId}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-slate-900 text-white font-semibold rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            <span>{isSubmitting ? 'Planning Variable...' : 'Assign Role to Variable Plan'}</span>
          </button>
        </div>
      </form>

      {/* Currently Planned Variables Table */}
      <div className="space-y-3 pt-6 border-t border-slate-200">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-mono uppercase tracking-wider font-semibold text-slate-700">
            Current Variable Plan ({project.variable_plan.length})
          </h3>
          <span className="text-[11px] text-slate-500">Immutable Plan History</span>
        </div>

        {project.variable_plan.length === 0 ? (
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 text-center text-xs">
            No variables planned yet. Assign variables from the registry above to configure exposure, outcome, and covariates.
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 font-mono text-[11px] text-slate-600">
                <tr>
                  <th className="py-2.5 px-3">Variable ID</th>
                  <th className="py-2.5 px-3">Assigned Role</th>
                  <th className="py-2.5 px-3">Expected Unit</th>
                  <th className="py-2.5 px-3">Transformation</th>
                  <th className="py-2.5 px-3">Rationale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {project.variable_plan.map((v) => (
                  <tr key={v.variable_id} className="hover:bg-slate-50/50">
                    <td className="py-2 px-3 font-mono font-medium text-slate-900">{v.variable_id}</td>
                    <td className="py-2 px-3 font-mono font-semibold text-slate-900">
                      {v.role}
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-600">{v.expected_unit || '—'}</td>
                    <td className="py-2 px-3 font-mono text-slate-600">{v.transformation || 'none'}</td>
                    <td className="py-2 px-3 text-slate-600">{v.rationale || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
