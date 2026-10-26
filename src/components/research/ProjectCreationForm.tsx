import React, { useState } from 'react';
import { 
  StudyDesignType, 
  ResearchQuestionPriority, 
  ObjectiveType, 
  HypothesisDirection, 
  ResearchProject 
} from '../../../scientific';
import { 
  ResearchWorkspaceService, 
  CreateProjectFormData 
} from '../../services/researchWorkspaceService';
import { 
  FlaskConical, 
  AlertCircle, 
  CheckCircle2, 
  HelpCircle, 
  ShieldAlert, 
  Plus 
} from 'lucide-react';

interface ProjectCreationFormProps {
  service: ResearchWorkspaceService;
  onProjectCreated: (project: ResearchProject) => void;
  defaultAuthor?: string;
}

export const ProjectCreationForm: React.FC<ProjectCreationFormProps> = ({
  service,
  onProjectCreated,
  defaultAuthor = 'Dr. Elena Rostova'
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [createdBy, setCreatedBy] = useState(defaultAuthor);

  // Study Design
  const [designType, setDesignType] = useState<StudyDesignType>('COHORT');
  const [designDesc, setDesignDesc] = useState('');
  const [blinding, setBlinding] = useState<'NONE' | 'SINGLE' | 'DOUBLE' | 'TRIPLE'>('NONE');
  const [randomization, setRandomization] = useState(false);
  const [temporalDirection, setTemporalDirection] = useState<'PROSPECTIVE' | 'RETROSPECTIVE' | 'CROSS_SECTIONAL'>('PROSPECTIVE');
  const [population, setPopulation] = useState('');
  const [setting, setSetting] = useState('');

  // Explicit Research Question
  const [questionText, setQuestionText] = useState('');
  const [questionPriority, setQuestionPriority] = useState<ResearchQuestionPriority>('PRIMARY');

  // Explicit Objective
  const [objectiveType, setObjectiveType] = useState<ObjectiveType>('PRIMARY_OBJECTIVE');
  const [objectiveDesc, setObjectiveDesc] = useState('');
  const [targetVariables, setTargetVariables] = useState('');

  // Explicit Hypothesis
  const [nullHypothesis, setNullHypothesis] = useState('');
  const [altHypothesis, setAltHypothesis] = useState('');
  const [direction, setDirection] = useState<HypothesisDirection>('TWO_SIDED');
  const [plannedAlpha, setPlannedAlpha] = useState(0.05);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Explicit user-supplied checks
    if (!title.trim()) {
      setError('Project title is required.');
      return;
    }
    if (!description.trim()) {
      setError('Project description is required.');
      return;
    }
    if (!designDesc.trim()) {
      setError('Study design description is required.');
      return;
    }
    if (!questionText.trim()) {
      setError('Explicit research question is required. Automatic generation is strictly forbidden.');
      return;
    }
    if (!objectiveDesc.trim()) {
      setError('Explicit research objective description is required.');
      return;
    }
    if (!nullHypothesis.trim()) {
      setError('Explicit null hypothesis (H₀) is required.');
      return;
    }
    if (!altHypothesis.trim()) {
      setError('Explicit alternative hypothesis (H₁) is required.');
      return;
    }

    try {
      setIsSubmitting(true);
      const formData: CreateProjectFormData = {
        title: title.trim(),
        description: description.trim(),
        created_by: createdBy.trim(),
        study_design: {
          design_type: designType,
          description: designDesc.trim(),
          blinding,
          randomization,
          temporal_direction: temporalDirection,
          population: population.trim() || undefined,
          setting: setting.trim() || undefined
        },
        research_question: {
          question_text: questionText.trim(),
          priority: questionPriority
        },
        objective: {
          type: objectiveType,
          description: objectiveDesc.trim(),
          target_variables: targetVariables
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
        },
        hypothesis: {
          null_hypothesis: nullHypothesis.trim(),
          alternative_hypothesis: altHypothesis.trim(),
          direction,
          planned_alpha: plannedAlpha
        }
      };

      const created = service.createProject(formData);
      onProjectCreated(created);
    } catch (err: any) {
      setError(err.message || 'Failed to create research project.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs max-w-4xl mx-auto">
      <div className="border-b border-slate-200 pb-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <FlaskConical className="w-5 h-5 text-slate-800" />
            <h2 className="text-base font-bold text-slate-900">Form 1: Research Project Creation</h2>
          </div>
          <div className="text-xs text-slate-500 font-mono">
            Status: <span className="font-semibold text-slate-700">DRAFT Initiation</span>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Formulate an auditable scientific research project container with explicit, user-supplied questions and hypotheses.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start space-x-2.5">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Validation Error</div>
            <div className="mt-0.5">{error}</div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6 text-xs">
        {/* Section 1: Project Metadata */}
        <div className="space-y-3">
          <h3 className="text-xs font-mono uppercase tracking-wider font-semibold text-slate-700">
            1. Project Metadata
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">
                Project Title <span className="text-rose-600">*</span>
              </label>
              <input
                id="input-project-title"
                type="text"
                placeholder="e.g. Dietary Fiber Biomarker Cohort & Glycemic Fluctuation"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                required
              />
            </div>

            <div className="md:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">
                Project Description <span className="text-rose-600">*</span>
              </label>
              <textarea
                id="input-project-desc"
                rows={2}
                placeholder="Describe the scientific domain, observational context, and scope of inquiry..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                required
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Principal Investigator / Author <span className="text-rose-600">*</span>
              </label>
              <input
                id="input-project-author"
                type="text"
                value={createdBy}
                onChange={(e) => setCreatedBy(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                required
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Initial Lifecycle Status
              </label>
              <input
                type="text"
                disabled
                value="DRAFT (Deterministic AST & Provenance Bound)"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-500 font-mono"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Study Design (Metadata only) */}
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono uppercase tracking-wider font-semibold text-slate-700">
              2. Study Design Specifications
            </h3>
            <span className="text-[11px] text-amber-700 font-medium">Metadata Only · Never Proves Causality</span>
          </div>

          <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg text-amber-900 text-[11px] flex items-start space-x-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <strong>Scientific Protocol Boundary:</strong> Study design designations are descriptive structural metadata.
              Observational, cohort, or cross-sectional classifications do not confer causal attribution.
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Design Type <span className="text-rose-600">*</span>
              </label>
              <select
                id="select-study-design-type"
                value={designType}
                onChange={(e) => setDesignType(e.target.value as StudyDesignType)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                <option value="COHORT">COHORT (Prospective / Retrospective)</option>
                <option value="CROSS_SECTIONAL">CROSS_SECTIONAL</option>
                <option value="CASE_CONTROL">CASE_CONTROL</option>
                <option value="OBSERVATIONAL">OBSERVATIONAL (General)</option>
                <option value="RANDOMIZED_CONTROLLED">RANDOMIZED_CONTROLLED</option>
                <option value="EXPERIMENTAL">EXPERIMENTAL</option>
                <option value="QUASI_EXPERIMENTAL">QUASI_EXPERIMENTAL</option>
                <option value="REPEATED_MEASURES">REPEATED_MEASURES</option>
                <option value="OTHER">OTHER</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Temporal Direction</label>
              <select
                value={temporalDirection}
                onChange={(e) => setTemporalDirection(e.target.value as any)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 bg-white focus:outline-none"
              >
                <option value="PROSPECTIVE">PROSPECTIVE</option>
                <option value="RETROSPECTIVE">RETROSPECTIVE</option>
                <option value="CROSS_SECTIONAL">CROSS_SECTIONAL</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Blinding Protocol</label>
              <select
                value={blinding}
                onChange={(e) => setBlinding(e.target.value as any)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 bg-white focus:outline-none"
              >
                <option value="NONE">NONE (Open Label / Observational)</option>
                <option value="SINGLE">SINGLE</option>
                <option value="DOUBLE">DOUBLE</option>
                <option value="TRIPLE">TRIPLE</option>
              </select>
            </div>

            <div className="md:col-span-3">
              <label className="block font-semibold text-slate-700 mb-1">
                Study Design Description <span className="text-rose-600">*</span>
              </label>
              <textarea
                id="input-design-desc"
                rows={2}
                placeholder="State inclusion criteria, observational timeframe, and participant recruitment protocol..."
                value={designDesc}
                onChange={(e) => setDesignDesc(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                required
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Target Population</label>
              <input
                type="text"
                placeholder="e.g. Adults aged 25-60 with prediabetes"
                value={population}
                onChange={(e) => setPopulation(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Clinical / Field Setting</label>
              <input
                type="text"
                placeholder="e.g. Outpatient Metabolic Clinic, Academic Medical Center"
                value={setting}
                onChange={(e) => setSetting(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 focus:outline-none"
              />
            </div>

            <div className="flex items-center space-x-2 pt-6">
              <input
                type="checkbox"
                id="chk-randomization"
                checked={randomization}
                onChange={(e) => setRandomization(e.target.checked)}
                className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <label htmlFor="chk-randomization" className="font-semibold text-slate-700 cursor-pointer">
                Randomized Allocation
              </label>
            </div>
          </div>
        </div>

        {/* Section 3: Explicit Research Question */}
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono uppercase tracking-wider font-semibold text-slate-700">
              3. Explicit Research Question
            </h3>
            <span className="text-[11px] text-slate-500">Researcher Supplied · Zero AI Generation</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-3">
              <label className="block font-semibold text-slate-700 mb-1">
                Research Question Statement <span className="text-rose-600">*</span>
              </label>
              <textarea
                id="input-research-question"
                rows={2}
                placeholder="e.g. Does daily soluble fiber intake correlate with a reduction in fasting plasma glucose over a 12-week observational period?"
                value={questionText}
                onChange={(e) => setQuestionText(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                required
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Question Priority</label>
              <select
                id="select-question-priority"
                value={questionPriority}
                onChange={(e) => setQuestionPriority(e.target.value as ResearchQuestionPriority)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 bg-white focus:outline-none"
              >
                <option value="PRIMARY">PRIMARY</option>
                <option value="SECONDARY">SECONDARY</option>
                <option value="EXPLORATORY">EXPLORATORY</option>
              </select>
            </div>
          </div>
        </div>

        {/* Section 4: Explicit Objective */}
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <h3 className="text-xs font-mono uppercase tracking-wider font-semibold text-slate-700">
            4. Explicit Research Objective
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Objective Type</label>
              <select
                id="select-objective-type"
                value={objectiveType}
                onChange={(e) => setObjectiveType(e.target.value as ObjectiveType)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 bg-white focus:outline-none"
              >
                <option value="PRIMARY_OBJECTIVE">PRIMARY_OBJECTIVE</option>
                <option value="SECONDARY_OBJECTIVE">SECONDARY_OBJECTIVE</option>
                <option value="EXPLORATORY_OBJECTIVE">EXPLORATORY_OBJECTIVE</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">
                Objective Description <span className="text-rose-600">*</span>
              </label>
              <input
                id="input-objective-desc"
                type="text"
                placeholder="e.g. Evaluate the association between soluble fiber intake and fasting blood glucose"
                value={objectiveDesc}
                onChange={(e) => setObjectiveDesc(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                required
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Target Variables</label>
              <input
                id="input-target-variables"
                type="text"
                placeholder="VAR_SOLUBLE_FIBER, VAR_FASTING_GLUCOSE"
                value={targetVariables}
                onChange={(e) => setTargetVariables(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Section 5: Explicit Hypotheses */}
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-mono uppercase tracking-wider font-semibold text-slate-700">
              5. Explicit Hypotheses (Null & Alternative)
            </h3>
            <span className="text-[11px] text-slate-500">Hypotheses Must Be Explicitly User Supplied</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Null Hypothesis (H₀) <span className="text-rose-600">*</span>
              </label>
              <textarea
                id="input-null-hypothesis"
                rows={2}
                placeholder="e.g. There is no correlation between dietary soluble fiber intake and fasting plasma glucose (r = 0)."
                value={nullHypothesis}
                onChange={(e) => setNullHypothesis(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                required
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Alternative Hypothesis (H₁) <span className="text-rose-600">*</span>
              </label>
              <textarea
                id="input-alt-hypothesis"
                rows={2}
                placeholder="e.g. There is an inverse correlation between dietary soluble fiber intake and fasting plasma glucose (r < 0)."
                value={altHypothesis}
                onChange={(e) => setAltHypothesis(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                required
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Hypothesis Direction</label>
              <select
                id="select-hypothesis-direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value as HypothesisDirection)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 bg-white focus:outline-none"
              >
                <option value="TWO_SIDED">TWO_SIDED (Non-directional: ≠ 0)</option>
                <option value="LESS">LESS (Directional: &lt; 0)</option>
                <option value="GREATER">GREATER (Directional: &gt; 0)</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Planned Significance Level (α)</label>
              <input
                id="input-planned-alpha"
                type="number"
                step="0.01"
                min="0.001"
                max="0.2"
                value={plannedAlpha}
                onChange={(e) => setPlannedAlpha(parseFloat(e.target.value) || 0.05)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Footer & Submit */}
        <div className="pt-6 border-t border-slate-200 flex items-center justify-between">
          <div className="text-[11px] text-slate-500 font-mono">
            Scientific Validity Boundary: <span className="font-semibold text-slate-700">NOT_ESTABLISHED</span>
          </div>

          <button
            id="btn-submit-create-project"
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-slate-900 text-white font-semibold rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            <span>{isSubmitting ? 'Registering Project...' : 'Initialize Research Project'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
