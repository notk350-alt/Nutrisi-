import React, { useState, useEffect } from 'react';
import { User, Project, Material, ScientificFormula, ScientificVariable, Dataset } from './types';
import { api } from './api';
import { Header } from './components/layout/Header';
import { Sidebar, TabId } from './components/layout/Sidebar';
import { DashboardView } from './components/dashboard/DashboardView';
import { ProjectsView } from './components/projects/ProjectsView';
import { MaterialBankView } from './components/materials/MaterialBankView';
import { ScientificRegistryView } from './components/scientific/ScientificRegistryView';
import { CalculatorView } from './components/calculator/CalculatorView';
import { DataLabView } from './components/datalab/DataLabView';
import { StatisticsLabView } from './components/statistics/StatisticsLabView';
import { CodeLabView } from './components/codelab/CodeLabView';
import { NotebookView } from './components/notebook/NotebookView';
import { ExperimentSandboxView } from './components/experiments/ExperimentSandboxView';
import { ProvenanceAuditView } from './components/provenance/ProvenanceAuditView';
import { ScientificContributionGuideView } from './components/docs/ScientificContributionGuideView';
import { ResearchWorkspaceView } from './components/research/ResearchWorkspaceView';
import { GlobalSearchModal } from './components/search/GlobalSearchModal';

export function App() {
  const [currentUser, setCurrentUser] = useState<User>({
    id: 'usr_researcher',
    email: 'elena.rostova@nutribodysim.org',
    name: 'Dr. Elena Rostova',
    role: 'Researcher',
    permissions: ['VIEW', 'USE', 'CREATE', 'CLONE', 'VERIFY'],
    institution: 'Metabolic Health Research Institute',
    created_at: '2026-01-01T00:00:00Z',
    last_login_at: '2026-09-21T10:00:00Z'
  });
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [projects, setProjects] = useState<Project[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [formulas, setFormulas] = useState<ScientificFormula[]>([]);
  const [variables, setVariables] = useState<ScientificVariable[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [preselectedFormulaId, setPreselectedFormulaId] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // High level laboratory counts
  const [labStats, setLabStats] = useState({
    projectsCount: 0,
    materialsCount: 0,
    variablesCount: 0,
    formulasCount: 0,
    modelsCount: 0,
    datasetsCount: 0,
    experimentsCount: 0,
    auditCount: 0
  });

  const loadInitialData = async () => {
    try {
      // Initialize verified session
      const verifiedUser = await api.initSession();
      if (verifiedUser) {
        setCurrentUser(verifiedUser);
      }

      const [uRes, pRes, mRes, vRes, fRes, modRes, dRes, expRes, audRes] = await Promise.all([
        api.getAllUsers().catch(() => ({ users: [] })),
        api.getProjects().catch(() => ({ projects: [] })),
        api.getMaterials().catch(() => ({ materials: [], collections: [] })),
        api.getVariables().catch(() => ({ variables: [] })),
        api.getFormulas().catch(() => ({ formulas: [] })),
        api.getModels().catch(() => ({ models: [] })),
        api.getDatasets().catch(() => ({ datasets: [] })),
        api.getExperiments().catch(() => ({ experiments: [] })),
        api.getAuditLogs().catch(() => ({ logs: [] }))
      ]);

      if (uRes.users && uRes.users.length > 0) setAllUsers(uRes.users);
      setProjects(pRes.projects);
      setMaterials(mRes.materials);
      setFormulas(fRes.formulas);
      setVariables(vRes.variables);
      setDatasets(dRes.datasets);

      setLabStats({
        projectsCount: pRes.projects.length,
        materialsCount: mRes.materials.length,
        variablesCount: vRes.variables.length,
        formulasCount: fRes.formulas.length,
        modelsCount: modRes.models.length,
        datasetsCount: dRes.datasets.length,
        experimentsCount: expRes.experiments.length,
        auditCount: audRes.logs.length
      });
    } catch (err) {
      console.error('Failed to load initial application state', err);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  // Global keyboard shortcut for search (Ctrl+K or Cmd+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSwitchUser = async (userId: string) => {
    try {
      const res = await api.switchUser(userId);
      setCurrentUser(res.user);
      const pRes = await api.getProjects().catch(() => ({ projects: [] }));
      setProjects(pRes.projects);
    } catch (err) {
      console.error('Switch user failed', err);
    }
  };

  const handleExecuteFormulaInCalculator = (formulaId: string) => {
    setPreselectedFormulaId(formulaId);
    setActiveTab('calculator');
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-slate-900 antialiased selection:bg-slate-900 selection:text-white">
      {/* Top Application Bar with Search Trigger */}
      <Header
        currentUser={currentUser}
        allUsers={allUsers}
        onSwitchUser={handleSwitchUser}
        activeTab={activeTab}
        onOpenSearch={() => setIsSearchOpen(true)}
      />

      {/* Application Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Navigation Sidebar */}
        <Sidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
        />

        {/* Dynamic Workspace Canvas */}
        <main className={`flex-1 overflow-y-auto ${activeTab === 'dashboard' ? 'bg-slate-950 p-3 sm:p-6' : 'p-4 sm:p-6 lg:p-8'}`}>
          {activeTab === 'dashboard' && (
            <DashboardView
              currentUser={currentUser}
              onNavigate={setActiveTab}
              stats={labStats}
            />
          )}

          {activeTab === 'projects' && (
            <ProjectsView
              currentUser={currentUser}
              onOpenProjectWorkspace={() => setActiveTab('research')}
            />
          )}

          {activeTab === 'materials' && (
            <MaterialBankView
              projects={projects}
            />
          )}

          {activeTab === 'registry' && (
            <ScientificRegistryView
              currentUser={currentUser}
              onExecuteFormulaInCalculator={handleExecuteFormulaInCalculator}
            />
          )}

          {activeTab === 'calculator' && (
            <CalculatorView
              currentUser={currentUser}
              preselectedFormulaId={preselectedFormulaId}
            />
          )}

          {activeTab === 'datalab' && (
            <DataLabView
              currentUser={currentUser}
              projects={projects}
            />
          )}

          {activeTab === 'statistics' && (
            <StatisticsLabView
              currentUser={currentUser}
            />
          )}

          {activeTab === 'codelab' && (
            <CodeLabView
              currentUser={currentUser}
            />
          )}

          {activeTab === 'notebook' && (
            <NotebookView
              currentUser={currentUser}
              projects={projects}
            />
          )}

          {activeTab === 'research' && (
            <ResearchWorkspaceView />
          )}

          {activeTab === 'experiments' && (
            <ExperimentSandboxView
              currentUser={currentUser}
            />
          )}

          {activeTab === 'provenance' && (
            <ProvenanceAuditView
              currentUser={currentUser}
            />
          )}

          {activeTab === 'docs' && (
            <ScientificContributionGuideView />
          )}
        </main>
      </div>

      {/* Global Search Component Palette */}
      <GlobalSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onNavigate={setActiveTab}
        onSelectFormula={handleExecuteFormulaInCalculator}
        projects={projects}
        materials={materials}
        formulas={formulas}
        variables={variables}
        datasets={datasets}
      />
    </div>
  );
}

export default App;
