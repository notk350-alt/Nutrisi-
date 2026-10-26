/**
 * NutriBodySim — Client API Client
 */

import { 
  User, 
  Project, 
  Team, 
  Material, 
  MaterialCollection, 
  Bookmark, 
  Highlight, 
  Note, 
  ScientificUnit, 
  ScientificVariable, 
  ScientificParameter, 
  ScientificFormula, 
  ScientificModel, 
  ScientificReference, 
  CalculationTrace, 
  Dataset, 
  DatasetVersion, 
  StatisticsAnalysis, 
  NutriNotebook, 
  NotebookCell, 
  Experiment, 
  AuditLog, 
  ProvenanceRecord,
  InterpretationRule 
} from './types';

class ApiClient {
  private sessionToken: string | null = null;
  private currentUser: User | null = null;
  private sessionPromise: Promise<string | null> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        this.sessionToken = sessionStorage.getItem('nutribodysim_session_token');
      } catch {
        this.sessionToken = null;
      }
    }
  }

  public getSessionToken(): string | null {
    return this.sessionToken;
  }

  public setSession(token: string, user: User) {
    this.sessionToken = token;
    this.currentUser = user;
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem('nutribodysim_session_token', token);
      } catch {}
    }
  }

  public clearSession() {
    this.sessionToken = null;
    this.currentUser = null;
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem('nutribodysim_session_token');
      } catch {}
    }
  }

  public setUserId(id: string) {
    // Deprecated backward-compatibility bridge: routes to switchUser
    this.switchUser(id).catch(() => {});
  }

  public getUserId(): string {
    return this.currentUser?.id || 'usr_researcher';
  }

  public async acquireSessionToken(preferredUserId?: string): Promise<string | null> {
    if (this.sessionPromise) {
      return this.sessionPromise;
    }
    this.sessionPromise = (async () => {
      try {
        const userId = preferredUserId || this.currentUser?.id || 'usr_researcher';
        const res = await fetch('/api/auth/demo-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId })
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.token && data.user) {
            this.setSession(data.token, data.user);
            return data.token;
          }
        }
      } catch (err) {
        console.warn('Session acquisition attempt failed:', err);
      } finally {
        this.sessionPromise = null;
      }
      return null;
    })();
    return this.sessionPromise;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}, isRetry = false): Promise<T> {
    const isAuthEndpoint = endpoint.startsWith('/api/auth/') || endpoint === '/api/health';
    // If no session token is present on a protected route, eagerly acquire one before issuing request
    if (!this.sessionToken && !isAuthEndpoint) {
      await this.acquireSessionToken();
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.sessionToken ? { 'Authorization': `Bearer ${this.sessionToken}` } : {}),
      ...(options.headers as Record<string, string> || {})
    };

    const res = await fetch(endpoint, { ...options, headers });
    if (!res.ok) {
      if (res.status === 401) {
        this.clearSession();
        // Automatic session renewal retry for protected endpoints on session expiry / server restart
        if (!isRetry && !isAuthEndpoint) {
          const newToken = await this.acquireSessionToken();
          if (newToken) {
            return this.request<T>(endpoint, options, true);
          }
        }
      }
      const errBody = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(errBody.error || `HTTP Error ${res.status}`);
    }
    return res.json();
  }

  // Auth & Users
  async initSession(): Promise<User | null> {
    if (this.sessionToken) {
      try {
        const { user } = await this.getCurrentUser();
        this.currentUser = user;
        return user;
      } catch {
        this.clearSession();
      }
    }

    // Default demo initialization
    try {
      const token = await this.acquireSessionToken('usr_researcher');
      if (token && this.currentUser) {
        return this.currentUser;
      }
      const res = await this.demoLogin('usr_researcher');
      return res.user;
    } catch (err) {
      console.warn('Initial demo session acquisition failed:', err);
      return null;
    }
  }

  async demoLogin(userId: string): Promise<{ token: string; user: User; expires_at: number }> {
    const res = await this.request<{ token: string; user: User; expires_at: number }>('/api/auth/demo-login', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId })
    });
    this.setSession(res.token, res.user);
    return res;
  }

  async getCurrentUser(): Promise<{ user: User }> {
    return this.request('/api/auth/me');
  }

  async getAllUsers(): Promise<{ users: User[] }> {
    return this.request('/api/users');
  }

  async switchUser(user_id: string): Promise<{ token: string; user: User; expires_at: number }> {
    const res = await this.request<{ token: string; user: User; expires_at: number }>('/api/auth/switch-user', {
      method: 'POST',
      body: JSON.stringify({ user_id })
    });
    this.setSession(res.token, res.user);
    return res;
  }

  async logout(): Promise<{ success: boolean }> {
    try {
      await this.request<{ success: boolean }>('/api/auth/logout', { method: 'POST' });
    } finally {
      this.clearSession();
    }
    return { success: true };
  }

  // Projects & Teams
  async getProjects(): Promise<{ projects: Project[] }> {
    return this.request('/api/projects');
  }

  async getProjectDetail(id: string): Promise<any> {
    return this.request(`/api/projects/${id}`);
  }

  async createProject(data: Partial<Project>): Promise<{ project: Project }> {
    return this.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async getTeams(): Promise<{ teams: Team[] }> {
    return this.request('/api/teams');
  }

  async createTeam(data: { name: string; description: string }): Promise<{ team: Team }> {
    return this.request('/api/teams', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // Materials & Documents
  async getMaterials(query?: { subject?: string; tag?: string; search?: string; project_id?: string }): Promise<{ materials: Material[]; collections: MaterialCollection[] }> {
    const params = new URLSearchParams(query as any || {});
    return this.request(`/api/materials?${params.toString()}`);
  }

  async uploadMaterial(data: { title: string; author?: string; subject?: string; description?: string; content?: string; tags?: string[]; project_id?: string }): Promise<{ material: Material }> {
    return this.request('/api/materials/upload', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async linkMaterialToProject(materialId: string, projectId: string): Promise<{ material: Material }> {
    return this.request(`/api/materials/${materialId}/link-project`, {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId })
    });
  }

  async getDocumentContent(id: string): Promise<{ material: Material; total_pages: number; pages: string[]; file_hash: string }> {
    return this.request(`/api/documents/${id}/content`);
  }

  async getReadingProgress(id: string): Promise<{ progress: any }> {
    return this.request(`/api/documents/${id}/progress`);
  }

  async saveReadingProgress(id: string, data: { last_page: number; total_pages: number; scroll_position?: number }): Promise<any> {
    return this.request(`/api/documents/${id}/progress`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async getBookmarks(materialId: string): Promise<{ bookmarks: Bookmark[] }> {
    return this.request(`/api/materials/${materialId}/bookmarks`);
  }

  async createBookmark(materialId: string, page: number, title: string): Promise<{ bookmark: Bookmark }> {
    return this.request(`/api/materials/${materialId}/bookmarks`, {
      method: 'POST',
      body: JSON.stringify({ page, title })
    });
  }

  async getHighlights(materialId: string): Promise<{ highlights: Highlight[] }> {
    return this.request(`/api/materials/${materialId}/highlights`);
  }

  async createHighlight(materialId: string, page: number, text: string, color: string): Promise<{ highlight: Highlight }> {
    return this.request(`/api/materials/${materialId}/highlights`, {
      method: 'POST',
      body: JSON.stringify({ page, selected_text: text, color })
    });
  }

  async getNotes(query?: { material_id?: string; project_id?: string }): Promise<{ notes: Note[] }> {
    const params = new URLSearchParams(query as any || {});
    return this.request(`/api/notes?${params.toString()}`);
  }

  async createNote(data: Partial<Note>): Promise<{ note: Note }> {
    return this.request('/api/notes', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // Scientific Registry
  async getUnits(): Promise<{ units: ScientificUnit[] }> {
    return this.request('/api/units');
  }

  async getVariables(): Promise<{ variables: ScientificVariable[] }> {
    return this.request('/api/variables');
  }

  async createVariable(data: Partial<ScientificVariable>): Promise<{ variable: ScientificVariable }> {
    return this.request('/api/variables', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async getParameters(): Promise<{ parameters: ScientificParameter[] }> {
    return this.request('/api/parameters');
  }

  async createParameter(data: Partial<ScientificParameter>): Promise<{ parameter: ScientificParameter }> {
    return this.request('/api/parameters', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async getFormulas(): Promise<{ formulas: ScientificFormula[] }> {
    return this.request('/api/formulas');
  }

  async getInterpretations(target?: string): Promise<{ interpretation_rules: InterpretationRule[] }> {
    const q = target ? `?target=${encodeURIComponent(target)}` : '';
    return this.request(`/api/interpretations${q}`);
  }

  async getInterpretation(id: string): Promise<{ interpretation_rule: InterpretationRule }> {
    return this.request(`/api/interpretations/${id}`);
  }

  async createFormula(data: any): Promise<{ formula: ScientificFormula }> {
    return this.request('/api/formulas', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async getModels(): Promise<{ models: ScientificModel[] }> {
    return this.request('/api/models');
  }

  async cloneModel(modelId: string, data: { new_name?: string; changed_notes?: string }): Promise<{ model: ScientificModel }> {
    return this.request(`/api/models/${modelId}/clone`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async getReferences(): Promise<{ references: ScientificReference[] }> {
    return this.request('/api/references');
  }

  async createReference(data: Partial<ScientificReference>): Promise<{ reference: ScientificReference }> {
    return this.request('/api/references', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // Calculation Engine
  async executeCalculation(data: { formula_id: string; inputs: Record<string, any>; parameter_overrides?: Record<string, any> }): Promise<{ trace: CalculationTrace }> {
    return this.request('/api/calculations/execute', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // Data Lab
  async getDatasets(project_id?: string): Promise<{ datasets: Dataset[] }> {
    const q = project_id ? `?project_id=${project_id}` : '';
    return this.request(`/api/datasets${q}`);
  }

  async getDatasetVersions(datasetId: string): Promise<{ versions: DatasetVersion[] }> {
    return this.request(`/api/datasets/${datasetId}/versions`);
  }

  async importDataset(data: { project_id?: string; name: string; description?: string; raw_data?: any[]; csv_text?: string }): Promise<{ dataset: Dataset; version: DatasetVersion }> {
    return this.request('/api/datasets/import', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async transformDataset(datasetId: string, data: { source_version_id: string; transformation_type: string; config: any }): Promise<{ version: DatasetVersion }> {
    return this.request(`/api/datasets/${datasetId}/transform`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // Statistics
  async runStatistics(data: { project_id?: string; dataset_version_id: string; analysis_type: string; target_columns: string[]; grouping_column?: string; title?: string }): Promise<{ analysis: StatisticsAnalysis }> {
    return this.request('/api/statistics/run', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async getStatistics(dataset_version_id?: string): Promise<{ analyses: StatisticsAnalysis[] }> {
    const q = dataset_version_id ? `?dataset_version_id=${dataset_version_id}` : '';
    return this.request(`/api/statistics${q}`);
  }

  // Code Lab
  async executeCode(data: { language: string; code: string; project_id?: string }): Promise<{ result: any }> {
    return this.request('/api/code/execute', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async generateCodeFromGUI(data: { operation: string; target_formula_id?: string; dataset_version_id?: string }): Promise<{ python: string; r: string }> {
    return this.request('/api/code/generate-from-gui', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // Notebooks
  async getNotebooks(project_id?: string): Promise<{ notebooks: NutriNotebook[] }> {
    const q = project_id ? `?project_id=${project_id}` : '';
    return this.request(`/api/notebooks${q}`);
  }

  async getNotebookDetail(id: string): Promise<{ notebook: NutriNotebook; cells: NotebookCell[] }> {
    return this.request(`/api/notebooks/${id}`);
  }

  async addNotebookCell(notebookId: string, data: Partial<NotebookCell>): Promise<{ cell: NotebookCell }> {
    return this.request(`/api/notebooks/${notebookId}/cells`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async updateNotebookCell(cellId: string, data: Partial<NotebookCell>): Promise<{ cell: NotebookCell }> {
    return this.request(`/api/notebooks/cells/${cellId}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  async deleteNotebookCell(cellId: string): Promise<{ success: boolean }> {
    return this.request(`/api/notebooks/cells/${cellId}`, {
      method: 'DELETE'
    });
  }

  // Experiments
  async getExperiments(project_id?: string): Promise<{ experiments: Experiment[] }> {
    const q = project_id ? `?project_id=${project_id}` : '';
    return this.request(`/api/experiments${q}`);
  }

  async createExperiment(data: any): Promise<{ experiment: Experiment }> {
    return this.request('/api/experiments', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // Provenance & Audit
  async getProvenance(project_id?: string): Promise<{ records: ProvenanceRecord[] }> {
    const q = project_id ? `?project_id=${project_id}` : '';
    return this.request(`/api/provenance${q}`);
  }

  async reRunProvenance(provenance_id: string): Promise<any> {
    return this.request('/api/provenance/re-run', {
      method: 'POST',
      body: JSON.stringify({ provenance_id })
    });
  }

  async getAuditLogs(): Promise<{ logs: AuditLog[] }> {
    return this.request('/api/audit');
  }
}

export const api = new ApiClient();
