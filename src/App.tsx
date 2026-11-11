import React, { useState, useEffect } from 'react';
import { User, Project, Material, ScientificFormula, ScientificVariable, Dataset } from './types';
import { api } from './api';
import { Header } from './components/layout/Header';
import { Sidebar, TabId } from './components/layout/Sidebar';
import { SignInView } from './components/auth/SignInView';

const DashboardView = React.lazy(() => import('./components/dashboard/DashboardView').then(module => ({ default: module.DashboardView })));
const ProjectsView = React.lazy(() => import('./components/projects/ProjectsView').then(module => ({ default: module.ProjectsView })));
const MaterialBankView = React.lazy(() => import('./components/materials/MaterialBankView').then(module => ({ default: module.MaterialBankView })));
const ScientificRegistryView = React.lazy(() => import('./components/scientific/ScientificRegistryView').then(module => ({ default: module.ScientificRegistryView })));
const CalculatorView = React.lazy(() => import('./components/calculator/CalculatorView').then(module => ({ default: module.CalculatorView })));
const DataLabView = React.lazy(() => import('./components/datalab/DataLabView').then(module => ({ default: module.DataLabView })));
const StatisticsLabView = React.lazy(() => import('./components/statistics/StatisticsLabView').then(module => ({ default: module.StatisticsLabView })));
const CodeLabView = React.lazy(() => import('./components/codelab/CodeLabView').then(module => ({ default: module.CodeLabView })));
const NotebookView = React.lazy(() => import('./components/notebook/NotebookView').then(module => ({ default: module.NotebookView })));
const ExperimentSandboxView = React.lazy(() => import('./components/experiments/ExperimentSandboxView').then(module => ({ default: module.ExperimentSandboxView })));
const ProvenanceAuditView = React.lazy(() => import('./components/provenance/ProvenanceAuditView').then(module => ({ default: module.ProvenanceAuditView })));
const ScientificContributionGuideView = React.lazy(() => import('./components/docs/ScientificContributionGuideView').then(module => ({ default: module.ScientificContributionGuideView })));
const ResearchWorkspaceView = React.lazy(() => import('./components/research/ResearchWorkspaceView').then(module => ({ default: module.ResearchWorkspaceView })));
const GlobalSearchModal = React.lazy(() => import('./components/search/GlobalSearchModal').then(module => ({ default: module.GlobalSearchModal })));

export function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signInBusy, setSignInBusy] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
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
      setCurrentUser(verifiedUser);
      if (!verifiedUser) return;

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
    } finally {
      setAuthReady(true);
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

  const handleGoogleSignIn = async () => {
    setSignInBusy(true);
    setSignInError(null);
    try {
      const user = await api.signInWithGoogle();
      setCurrentUser(user);
      await loadInitialData();
    } catch (error) {
      setSignInError(error instanceof Error ? error.message : 'Google sign-in failed.');
    } finally {
      setSignInBusy(false);
    }
  };

  const handleDemoSignIn = async () => {
    setSignInBusy(true);
    setSignInError(null);
    try {
      const result = await api.demoLogin('usr_researcher');
      setCurrentUser(result.user);
      await loadInitialData();
    } catch (error) {
      setSignInError(error instanceof Error ? error.message : 'Demo sign-in failed.');
    } finally {
      setSignInBusy(false);
    }
  };

  if (!authReady) {
    return <main className="min-h-screen bg-slate-950 text-slate-100 grid place-items-center">Memuat NutriBodySim...</main>;
  }

  if (!currentUser) {
    return (
      <SignInView
        busy={signInBusy}
        error={signInError}
        isDevelopment={import.meta.env.DEV}
        onGoogleSignIn={handleGoogleSignIn}
        onDemoSignIn={handleDemoSignIn}
      />
    );
  }

  const handleExecuteFormulaInCalculator = (formulaId: string) => {
    setPreselectedFormulaId(formulaId);
    setActiveTab('calculator');
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-slate-900 antialiased selection:bg-slate-900 selection:text-white">
      {/* Top Application Bar with Search Trigger */}
      <Header
        currentUser={currentUser}
        allUsers={import.meta.env.DEV ? allUsers : []}
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
          <React.Suspense fallback={<div className="p-6 text-sm text-slate-500">Memuat modul...</div>}>
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
          </React.Suspense>
        </main>
      </div>

      {/* Global Search Component Palette */}
      {isSearchOpen && (
        <React.Suspense fallback={null}>
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
        </React.Suspense>
      )}
    </div>
  );
}

export default App;
