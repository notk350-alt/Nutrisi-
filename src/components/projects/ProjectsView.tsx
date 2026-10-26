import React, { useState, useEffect } from 'react';
import { Project, Team, User } from '../../types';
import { api } from '../../api';
import { 
  FolderKanban, 
  Users, 
  Plus, 
  Tag, 
  Calendar, 
  BookOpen, 
  Database, 
  FlaskConical, 
  FileText,
  Shield,
  CheckCircle2
} from 'lucide-react';

interface ProjectsViewProps {
  currentUser: User;
  onOpenProjectWorkspace?: (projectId: string) => void;
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({ currentUser, onOpenProjectWorkspace }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectDetail, setProjectDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // New project form state
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [newProjectType, setNewProjectType] = useState<'Personal' | 'Academic' | 'Research' | 'Experiment' | 'Assignment'>('Research');
  const [newProjectTags, setNewProjectTags] = useState('');
  const [isPublic, setIsPublic] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [projRes, teamRes] = await Promise.all([
        api.getProjects(),
        api.getTeams()
      ]);
      setProjects(projRes.projects);
      setTeams(teamRes.teams);
      if (projRes.projects.length > 0 && !selectedProjectId) {
        setSelectedProjectId(projRes.projects[0].id);
      }
    } catch (err) {
      console.error('Failed to load projects', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      api.getProjectDetail(selectedProjectId).then(detail => {
        setProjectDetail(detail);
      }).catch(err => console.error(err));
    }
  }, [selectedProjectId]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    try {
      const tagsArray = newProjectTags.split(',').map(t => t.trim()).filter(Boolean);
      const res = await api.createProject({
        name: newProjectName.trim(),
        description: newProjectDesc.trim(),
        type: newProjectType,
        is_public: isPublic,
        tags: tagsArray
      });
      setIsModalOpen(false);
      setNewProjectName('');
      setNewProjectDesc('');
      setNewProjectTags('');
      loadData();
      setSelectedProjectId(res.project.id);
    } catch (err: any) {
      alert(`Failed to create project: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <FolderKanban className="w-5 h-5 text-slate-700" />
            <h1 className="text-lg font-bold text-slate-900">Project & Team Workspaces</h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Every serious scientific calculation, dataset version, and notebook belongs to an auditable project context.
          </p>
        </div>

        <button
          id="btn-create-project"
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center space-x-1.5 bg-slate-900 text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>New Project</span>
        </button>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Project List */}
        <div className="space-y-3 lg:col-span-1">
          <div className="text-xs font-mono font-semibold text-slate-500 uppercase tracking-wider">
            Active Projects ({projects.length})
          </div>

          <div className="space-y-2">
            {projects.map((p) => {
              const isSelected = selectedProjectId === p.id;
              return (
                <div
                  key={p.id}
                  id={`project-card-${p.id}`}
                  onClick={() => setSelectedProjectId(p.id)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer text-left ${
                    isSelected
                      ? 'bg-white border-slate-900 shadow-xs ring-1 ring-slate-900'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                      {p.type}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {new Date(p.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 mt-1.5">
                    {p.name}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                    {p.description}
                  </p>

                  {p.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {p.tags.map(t => (
                        <span key={t} className="text-[10px] bg-slate-50 text-slate-600 px-1.5 py-0.2 rounded border border-slate-100">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Teams Summary */}
          <div className="pt-4 border-t border-slate-200 space-y-3">
            <div className="flex items-center space-x-1.5 text-xs font-mono font-semibold text-slate-500 uppercase">
              <Users className="w-3.5 h-3.5" />
              <span>Collaborative Teams ({teams.length})</span>
            </div>

            {teams.map(t => (
              <div key={t.id} className="p-3 bg-white rounded-lg border border-slate-200 text-xs space-y-1">
                <div className="font-semibold text-slate-900">{t.name}</div>
                <p className="text-slate-500 text-[11px]">{t.description}</p>
                <div className="flex items-center space-x-2 pt-1 text-[11px] text-slate-400 font-mono">
                  <span>{t.members?.length || 1} Members</span>
                  <span>•</span>
                  <span>Roles: Owner, Editor, Collaborator</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Selected Project Deep Dive */}
        <div className="lg:col-span-2 space-y-4">
          {projectDetail ? (
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-5">
              {/* Project Header */}
              <div className="border-b border-slate-100 pb-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-semibold">
                    {projectDetail.project.type} Workspace
                  </span>
                  <div className="flex items-center space-x-2">
                    {onOpenProjectWorkspace && (
                      <button
                        onClick={() => onOpenProjectWorkspace(projectDetail.project.id)}
                        className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-900 text-white hover:bg-slate-800 transition-colors inline-flex items-center space-x-1"
                      >
                        <FlaskConical className="w-3.5 h-3.5" />
                        <span>Open Research Workspace (F1)</span>
                      </button>
                    )}
                    <span className="text-xs text-slate-400 font-mono">
                      ID: {projectDetail.project.id}
                    </span>
                  </div>
                </div>
                <h2 className="text-base font-bold text-slate-900 mt-2">
                  {projectDetail.project.name}
                </h2>
                <p className="text-xs text-slate-600 mt-1">
                  {projectDetail.project.description}
                </p>
              </div>

              {/* Project Structure Checklist (Section 6) */}
              <div className="space-y-3">
                <div className="text-xs font-mono font-semibold text-slate-500 uppercase tracking-wider">
                  Associated Scientific Artifacts in Project
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="flex items-center space-x-1.5 text-xs text-slate-600 font-medium">
                      <BookOpen className="w-3.5 h-3.5 text-slate-500" />
                      <span>Materials</span>
                    </div>
                    <div className="text-lg font-bold text-slate-900 mt-1">
                      {projectDetail.materials?.length || 0}
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="flex items-center space-x-1.5 text-xs text-slate-600 font-medium">
                      <Database className="w-3.5 h-3.5 text-slate-500" />
                      <span>Datasets</span>
                    </div>
                    <div className="text-lg font-bold text-slate-900 mt-1">
                      {projectDetail.datasets?.length || 0}
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="flex items-center space-x-1.5 text-xs text-slate-600 font-medium">
                      <FileText className="w-3.5 h-3.5 text-slate-500" />
                      <span>Notebooks</span>
                    </div>
                    <div className="text-lg font-bold text-slate-900 mt-1">
                      {projectDetail.notebooks?.length || 0}
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="flex items-center space-x-1.5 text-xs text-slate-600 font-medium">
                      <FlaskConical className="w-3.5 h-3.5 text-slate-500" />
                      <span>Experiments</span>
                    </div>
                    <div className="text-lg font-bold text-slate-900 mt-1">
                      {projectDetail.experiments?.length || 0}
                    </div>
                  </div>
                </div>
              </div>

              {/* Members */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="text-xs font-mono font-semibold text-slate-500 uppercase">
                  Project Members & Permissions
                </div>
                <div className="space-y-1.5">
                  {projectDetail.members?.map((m: any) => (
                    <div key={m.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100 text-xs">
                      <div className="flex items-center space-x-2">
                        <div className="w-6 h-6 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-[10px]">
                          {m.user?.name?.[0] || 'U'}
                        </div>
                        <div>
                          <span className="font-semibold text-slate-800">{m.user?.name}</span>
                          <span className="text-[11px] text-slate-400 ml-1.5">({m.user?.role})</span>
                        </div>
                      </div>
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700 font-semibold">
                        Role: {m.role}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Linked Materials Preview */}
              {projectDetail.materials && projectDetail.materials.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="text-xs font-mono font-semibold text-slate-500 uppercase">
                    Linked Academic Materials
                  </div>
                  <div className="space-y-1">
                    {projectDetail.materials.map((mat: any) => (
                      <div key={mat.id} className="p-2.5 rounded-lg border border-slate-200 text-xs flex items-center justify-between bg-white">
                        <div className="space-y-0.5">
                          <div className="font-semibold text-slate-900">{mat.title}</div>
                          <div className="text-[11px] text-slate-500">{mat.author} • {mat.subject}</div>
                        </div>
                        <span className="text-[10px] font-mono uppercase bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                          {mat.type}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-8 text-center bg-white rounded-xl border border-slate-200 text-xs text-slate-500">
              Select a project from the left panel to inspect its workspace structure.
            </div>
          )}
        </div>
      </div>

      {/* Create Project Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Create New Project</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-semibold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Project Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Energy Balance Sensitivity Study"
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-1 focus:ring-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Project Type</label>
                <select
                  value={newProjectType}
                  onChange={e => setNewProjectType(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none bg-white"
                >
                  <option value="Research">Research</option>
                  <option value="Academic">Academic</option>
                  <option value="Personal">Personal</option>
                  <option value="Experiment">Experiment</option>
                  <option value="Assignment">Assignment</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Description</label>
                <textarea
                  rows={3}
                  placeholder="State the scientific problem, hypothesis, and modeling objective..."
                  value={newProjectDesc}
                  onChange={e => setNewProjectDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-1 focus:ring-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Tags (comma separated)</label>
                <input
                  type="text"
                  placeholder="metabolism, physiology, verification"
                  value={newProjectTags}
                  onChange={e => setNewProjectTags(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none"
                />
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="chk-public"
                  checked={isPublic}
                  onChange={e => setIsPublic(e.target.checked)}
                  className="rounded border-slate-300 text-slate-900"
                />
                <label htmlFor="chk-public" className="text-slate-600 cursor-pointer">
                  Public project (viewable by other laboratory members)
                </label>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-2 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800"
                >
                  Create Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
