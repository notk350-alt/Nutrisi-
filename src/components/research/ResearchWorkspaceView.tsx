import React, { useState, useEffect } from 'react';
import { 
  ResearchProject, 
  ProjectStatus 
} from '../../../scientific';
import { 
  defaultResearchWorkspaceService, 
  ResearchWorkspaceService 
} from '../../services/researchWorkspaceService';
import { 
  FolderKanban, 
  Database, 
  Binary, 
  FlaskConical, 
  Plus, 
  ShieldCheck, 
  Lock, 
  FileCheck2, 
  GitCommit,
  CheckCircle2,
  Calculator
} from 'lucide-react';

const ProjectCreationForm = React.lazy(() => import('./ProjectCreationForm').then(module => ({ default: module.ProjectCreationForm })));
const DatasetBindingForm = React.lazy(() => import('./DatasetBindingForm').then(module => ({ default: module.DatasetBindingForm })));
const VariablePlanningForm = React.lazy(() => import('./VariablePlanningForm').then(module => ({ default: module.VariablePlanningForm })));
const AnalysisPlanForm = React.lazy(() => import('./AnalysisPlanForm').then(module => ({ default: module.AnalysisPlanForm })));

interface ResearchWorkspaceViewProps {
  service?: ResearchWorkspaceService;
  initialProjectId?: string;
  onOpenProvenance?: () => void;
}

type WorkspaceTab = 'CREATE_PROJECT' | 'BIND_DATASET' | 'PLAN_VARIABLES' | 'PLAN_ANALYSIS';

export const ResearchWorkspaceView: React.FC<ResearchWorkspaceViewProps> = ({
  service = defaultResearchWorkspaceService,
  initialProjectId
}) => {
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialProjectId || null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('CREATE_PROJECT');

  const loadProjects = () => {
    const list = service.listProjects();
    setProjects(list);
    if (!selectedProjectId && list.length > 0) {
      setSelectedProjectId(list[0].project_id);
      setActiveTab('BIND_DATASET');
    }
  };

  useEffect(() => {
    loadProjects();
  }, [service]);

  const activeProject = selectedProjectId ? service.getProject(selectedProjectId) : undefined;

  const handleProjectCreated = (newProject: ResearchProject) => {
    loadProjects();
    setSelectedProjectId(newProject.project_id);
    setActiveTab('BIND_DATASET');
  };

  const handleProjectUpdated = (updatedProject: ResearchProject) => {
    loadProjects();
    setSelectedProjectId(updatedProject.project_id);
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Workspace Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <FlaskConical className="w-5 h-5 text-slate-900" />
            <h1 className="text-lg font-bold text-slate-900">Research Workspace (Phase F1)</h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Scientific Project Formulation, Deterministic Dataset Binding, and Variable Role Planning.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {projects.length > 0 && (
            <div className="flex items-center space-x-2">
              <span className="text-xs text-slate-500 font-medium">Project:</span>
              <select
                id="select-active-project"
                value={selectedProjectId || ''}
                onChange={(e) => {
                  setSelectedProjectId(e.target.value);
                  if (activeTab === 'CREATE_PROJECT') {
                    setActiveTab('BIND_DATASET');
                  }
                }}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
              >
                {projects.map((p) => (
                  <option key={p.project_id} value={p.project_id}>
                    {p.title} ({p.project_id} · {p.status})
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            id="btn-nav-create-project"
            onClick={() => setActiveTab('CREATE_PROJECT')}
            className={`inline-flex items-center space-x-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
              activeTab === 'CREATE_PROJECT'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <Plus className="w-4 h-4" />
            <span>New Research Project</span>
          </button>
        </div>
      </div>

      {/* Active Project Overview Card */}
      {activeProject && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-slate-900">{activeProject.title}</h2>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">
                  v{activeProject.project_version}
                </span>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-900 text-white font-semibold">
                  {activeProject.status}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1">{activeProject.description}</p>
            </div>

            <div className="text-right shrink-0">
              <div className="text-[11px] font-mono text-slate-500">
                Created By: <strong className="text-slate-800">{activeProject.created_by}</strong>
              </div>
              <div className="text-[11px] font-mono text-slate-400">
                {new Date(activeProject.created_at).toLocaleDateString()}
              </div>
            </div>
          </div>

          {/* Scientific Metadata & Invariants Row */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs text-slate-600">
            <div>
              <span className="text-[10px] font-mono uppercase text-slate-400 block">Study Design Type</span>
              <span className="font-semibold text-slate-800">{activeProject.study_design.design_type}</span>
              <span className="text-[11px] text-slate-500 block truncate">{activeProject.study_design.description}</span>
            </div>

            <div>
              <span className="text-[10px] font-mono uppercase text-slate-400 block">Questions & Objectives</span>
              <span className="font-semibold text-slate-800">
                {activeProject.research_questions.length} Question(s) · {activeProject.objectives.length} Objective(s)
              </span>
              <span className="text-[11px] text-slate-500 block">
                {activeProject.hypotheses.length} Explicit Hypothesis(es)
              </span>
            </div>

            <div>
              <span className="text-[10px] font-mono uppercase text-slate-400 block">Dataset & Planning</span>
              <span className="font-semibold text-slate-800">
                {activeProject.dataset_binding ? 'Bound to ' + activeProject.dataset_binding.dataset_version_id : 'No Dataset Bound'}
              </span>
              <span className="text-[11px] text-slate-500 block">
                {activeProject.variable_plan.length} Variable(s) · {activeProject.analysis_plan.length} Analysis Plan(s)
              </span>
            </div>

            <div>
              <span className="text-[10px] font-mono uppercase text-slate-400 block">Scientific Validity Status</span>
              <span className="font-mono font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded text-[11px] inline-block">
                {activeProject.scientific_validity}
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5 truncate font-mono">
                Hash: {activeProject.provenance_hash.slice(0, 16)}...
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Form Stepper / Navigation Tabs */}
      <div className="flex items-center space-x-1 p-1 bg-slate-200/70 rounded-xl">
        <button
          id="tab-btn-create"
          onClick={() => setActiveTab('CREATE_PROJECT')}
          className={`flex-1 flex items-center justify-center space-x-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'CREATE_PROJECT'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FlaskConical className="w-4 h-4" />
          <span>Form 1: Project Creation</span>
        </button>

        <button
          id="tab-btn-bind"
          onClick={() => {
            if (activeProject) setActiveTab('BIND_DATASET');
          }}
          disabled={!activeProject}
          className={`flex-1 flex items-center justify-center space-x-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            activeTab === 'BIND_DATASET'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Form 2: Dataset Binding</span>
        </button>

        <button
          id="tab-btn-vars"
          onClick={() => {
            if (activeProject) setActiveTab('PLAN_VARIABLES');
          }}
          disabled={!activeProject}
          className={`flex-1 flex items-center justify-center space-x-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            activeTab === 'PLAN_VARIABLES'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Binary className="w-4 h-4" />
          <span>Form 3: Variable Plan</span>
        </button>

        <button
          id="tab-btn-analysis"
          onClick={() => {
            if (activeProject) setActiveTab('PLAN_ANALYSIS');
          }}
          disabled={!activeProject}
          className={`flex-1 flex items-center justify-center space-x-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            activeTab === 'PLAN_ANALYSIS'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Calculator className="w-4 h-4" />
          <span>Form 4: Analysis Plan</span>
        </button>
      </div>

      {/* Form Viewport */}
      <div>
        <React.Suspense fallback={<div className="py-8 text-sm text-slate-500">Loading research form...</div>}>
          {activeTab === 'CREATE_PROJECT' && (
            <ProjectCreationForm
              service={service}
              onProjectCreated={handleProjectCreated}
            />
          )}

          {activeTab === 'BIND_DATASET' && activeProject && (
            <DatasetBindingForm
              project={activeProject}
              service={service}
              onProjectUpdated={handleProjectUpdated}
            />
          )}

          {activeTab === 'PLAN_VARIABLES' && activeProject && (
            <VariablePlanningForm
              project={activeProject}
              service={service}
              onProjectUpdated={handleProjectUpdated}
            />
          )}

          {activeTab === 'PLAN_ANALYSIS' && activeProject && (
            <AnalysisPlanForm
              project={activeProject}
              service={service}
              onProjectUpdated={handleProjectUpdated}
            />
          )}
        </React.Suspense>
      </div>
    </div>
  );
};
