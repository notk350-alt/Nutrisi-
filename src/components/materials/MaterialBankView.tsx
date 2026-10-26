import React, { useState, useEffect } from 'react';
import { Material, MaterialCollection, Project } from '../../types';
import { api } from '../../api';
import { DocumentReader } from './DocumentReader';
import { 
  BookOpen, 
  Search, 
  Upload, 
  Folder, 
  FileText, 
  Tag, 
  ExternalLink, 
  Layers, 
  Calendar,
  CheckCircle2
} from 'lucide-react';

interface MaterialBankViewProps {
  projects: Project[];
}

export const MaterialBankView: React.FC<MaterialBankViewProps> = ({ projects }) => {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [collections, setCollections] = useState<MaterialCollection[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Upload modal state
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadAuthor, setUploadAuthor] = useState('');
  const [uploadSubject, setUploadSubject] = useState('Nutrition & Physiology');
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadTextContent, setUploadTextContent] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [uploadProjectId, setUploadProjectId] = useState('');

  const loadMaterials = async () => {
    try {
      setLoading(true);
      const res = await api.getMaterials({
        search: searchQuery || undefined,
        subject: selectedSubject || undefined
      });
      setMaterials(res.materials);
      setCollections(res.collections);
    } catch (err) {
      console.error('Failed to load materials', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMaterials();
  }, [selectedSubject]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadMaterials();
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadTitle.trim()) return;

    try {
      await api.uploadMaterial({
        title: uploadTitle.trim(),
        author: uploadAuthor.trim(),
        subject: uploadSubject,
        description: uploadDesc.trim(),
        content: uploadTextContent.trim() || undefined,
        tags: uploadTags.split(',').map(t => t.trim()).filter(Boolean),
        project_id: uploadProjectId || undefined
      });
      setIsUploadOpen(false);
      setUploadTitle('');
      setUploadAuthor('');
      setUploadDesc('');
      setUploadTextContent('');
      setUploadTags('');
      loadMaterials();
    } catch (err: any) {
      alert(`Upload error: ${err.message}`);
    }
  };

  // If a document is currently open in reader mode, show DocumentReader
  if (selectedMaterialId) {
    return (
      <DocumentReader
        materialId={selectedMaterialId}
        onBack={() => setSelectedMaterialId(null)}
        projects={projects}
      />
    );
  }

  const subjects = [
    'All Subjects',
    'Nutrition & Physiology',
    'Physiology & Bioenergetics',
    'Nutritional Assessment',
    'Anatomy',
    'Biochemistry',
    'Statistics',
    'Research Methods'
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <BookOpen className="w-5 h-5 text-slate-700" />
            <h1 className="text-lg font-bold text-slate-900">Academic Material Bank</h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Store, search, bookmark, and annotate academic textbooks, peer-reviewed monographs, and clinical guidelines.
          </p>
        </div>

        <button
          id="btn-upload-material"
          onClick={() => setIsUploadOpen(true)}
          className="inline-flex items-center space-x-1.5 bg-slate-900 text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors"
        >
          <Upload className="w-4 h-4" />
          <span>Upload Academic Material</span>
        </button>
      </div>

      {/* Collections Bar (Section 9) */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-2">
        <div className="flex items-center space-x-1.5 text-xs font-mono font-semibold text-slate-500 uppercase">
          <Folder className="w-3.5 h-3.5" />
          <span>Material Collections</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {collections.map(col => (
            <div
              key={col.id}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs flex items-center space-x-2 hover:bg-slate-100 cursor-pointer"
            >
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: col.color || '#3b82f6' }}></div>
              <span className="font-semibold text-slate-800">{col.name}</span>
              <span className="text-[10px] font-mono text-slate-400 bg-white px-1.5 rounded border border-slate-200">
                {col.material_ids.length}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <form onSubmit={handleSearchSubmit} className="flex-1 flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search across title, author, abstract, or tags..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-semibold text-slate-700"
          >
            Search
          </button>
        </form>

        <select
          value={selectedSubject}
          onChange={e => setSelectedSubject(e.target.value === 'All Subjects' ? '' : e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white focus:outline-none"
        >
          {subjects.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Materials Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {materials.map((m) => (
          <div
            key={m.id}
            id={`material-card-${m.id}`}
            className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col justify-between hover:border-slate-400 transition-all hover:shadow-xs group text-left"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-bold border border-slate-200">
                  {m.type}
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  {m.year || 2025}
                </span>
              </div>

              <h3 className="text-sm font-bold text-slate-900 mt-2 group-hover:text-blue-600 transition-colors line-clamp-2">
                {m.title}
              </h3>
              <div className="text-[11px] text-slate-600 font-medium mt-1">
                {m.author}
              </div>
              <p className="text-xs text-slate-500 mt-1.5 line-clamp-3 leading-relaxed">
                {m.description}
              </p>

              {m.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {m.tags.map(t => (
                    <span key={t} className="text-[10px] bg-slate-50 text-slate-600 px-1.5 py-0.2 rounded border border-slate-100">
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[10px] font-mono text-slate-400 truncate max-w-[130px]">
                SHA: {(m.file_hash || '').slice(0, 10)}...
              </span>
              <button
                id={`btn-open-reader-${m.id}`}
                onClick={() => setSelectedMaterialId(m.id)}
                className="inline-flex items-center space-x-1 text-xs font-semibold text-slate-900 group-hover:text-blue-600"
              >
                <span>Open Reader</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {materials.length === 0 && (
        <div className="p-12 text-center bg-white rounded-xl border border-slate-200 text-xs text-slate-500">
          No materials found matching query. Click "Upload Academic Material" to add your first monograph.
        </div>
      )}

      {/* Upload Modal */}
      {isUploadOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg border border-slate-200 w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Upload Academic Material</h3>
              <button onClick={() => setIsUploadOpen(false)} className="text-slate-400 hover:text-slate-600 text-sm font-semibold">
                ✕
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Clinical Anthropometry and Energy Turnover Handbook"
                  value={uploadTitle}
                  onChange={e => setUploadTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Author(s)</label>
                  <input
                    type="text"
                    placeholder="e.g. Vance, E. et al."
                    value={uploadAuthor}
                    onChange={e => setUploadAuthor(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Subject</label>
                  <select
                    value={uploadSubject}
                    onChange={e => setUploadSubject(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none bg-white"
                  >
                    {subjects.filter(s => s !== 'All Subjects').map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Description / Abstract</label>
                <textarea
                  rows={2}
                  placeholder="Brief summary of monograph contents..."
                  value={uploadDesc}
                  onChange={e => setUploadDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Text Content (Direct Ingestion)</label>
                <textarea
                  rows={4}
                  placeholder="Paste academic chapter text, formulas context, or manuscript sections..."
                  value={uploadTextContent}
                  onChange={e => setUploadTextContent(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tags (comma separated)</label>
                  <input
                    type="text"
                    placeholder="allometry, rmr, validation"
                    value={uploadTags}
                    onChange={e => setUploadTags(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Link to Project (Optional)</label>
                  <select
                    value={uploadProjectId}
                    onChange={e => setUploadProjectId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:outline-none bg-white"
                  >
                    <option value="">-- No Project Link --</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsUploadOpen(false)}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-2 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800"
                >
                  Ingest Material
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
