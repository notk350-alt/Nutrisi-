import React, { useState, useEffect } from 'react';
import { Material, Bookmark, Highlight, Note, Project } from '../../types';
import { api } from '../../api';
import { 
  ArrowLeft, 
  ChevronLeft, 
  ChevronRight, 
  ZoomIn, 
  ZoomOut, 
  Bookmark as BookmarkIcon, 
  Highlighter, 
  StickyNote, 
  Search, 
  BookMarked,
  Link,
  Share2,
  Check
} from 'lucide-react';

interface DocumentReaderProps {
  materialId: string;
  onBack: () => void;
  projects: Project[];
}

export const DocumentReader: React.FC<DocumentReaderProps> = ({
  materialId,
  onBack,
  projects,
}) => {
  const [material, setMaterial] = useState<Material | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [searchQuery, setSearchQuery] = useState('');
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  // Side panels: 'notes' | 'bookmarks' | 'highlights' | 'link' | null
  const [activePanel, setActivePanel] = useState<'notes' | 'bookmarks' | 'highlights' | 'link' | null>('notes');

  // New note form
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [selectedText, setSelectedText] = useState('');
  const [bookmarkTitle, setBookmarkTitle] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [linkSuccess, setLinkSuccess] = useState(false);

  useEffect(() => {
    loadDocument();
  }, [materialId]);

  const loadDocument = async () => {
    try {
      setLoading(true);
      const [docRes, progRes, bmRes, hlRes, notesRes] = await Promise.all([
        api.getDocumentContent(materialId),
        api.getReadingProgress(materialId),
        api.getBookmarks(materialId),
        api.getHighlights(materialId),
        api.getNotes({ material_id: materialId })
      ]);

      setMaterial(docRes.material);
      setPages(docRes.pages);
      setTotalPages(docRes.total_pages);
      setBookmarks(bmRes.bookmarks);
      setHighlights(hlRes.highlights);
      setNotes(notesRes.notes);

      if (progRes.progress && progRes.progress.last_page) {
        setCurrentPage(Math.min(progRes.progress.last_page, docRes.total_pages));
      }
    } catch (err) {
      console.error('Failed to load document reader', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = async (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    setCurrentPage(newPage);
    try {
      await api.saveReadingProgress(materialId, {
        last_page: newPage,
        total_pages: totalPages
      });
    } catch (err) {
      console.error('Failed to save reading progress', err);
    }
  };

  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      setSelectedText(selection.toString().trim());
    }
  };

  const handleAddHighlight = async (color: string) => {
    if (!selectedText) return;
    try {
      const res = await api.createHighlight(materialId, currentPage, selectedText, color);
      setHighlights([...highlights, res.highlight]);
      setSelectedText('');
    } catch (err: any) {
      alert(`Highlight error: ${err.message}`);
    }
  };

  const handleAddBookmark = async () => {
    const title = bookmarkTitle.trim() || `Bookmark Page ${currentPage}`;
    try {
      const res = await api.createBookmark(materialId, currentPage, title);
      setBookmarks([...bookmarks, res.bookmark]);
      setBookmarkTitle('');
    } catch (err: any) {
      alert(`Bookmark error: ${err.message}`);
    }
  };

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteContent.trim()) return;

    try {
      const res = await api.createNote({
        title: noteTitle.trim() || `Note (Page ${currentPage})`,
        content: noteContent.trim(),
        material_id: materialId,
        page: currentPage,
        selected_text: selectedText || undefined
      });
      setNotes([res.note, ...notes]);
      setNoteTitle('');
      setNoteContent('');
      setSelectedText('');
    } catch (err: any) {
      alert(`Note error: ${err.message}`);
    }
  };

  const handleLinkToProject = async () => {
    if (!selectedProjectId) return;
    try {
      await api.linkMaterialToProject(materialId, selectedProjectId);
      setLinkSuccess(true);
      setTimeout(() => setLinkSuccess(false), 2500);
    } catch (err: any) {
      alert(`Link error: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-xs text-slate-500 font-mono">
        Loading document reader environment and reading progress...
      </div>
    );
  }

  if (!material) {
    return (
      <div className="p-8 text-center text-xs text-slate-500">
        Document not found. <button onClick={onBack} className="text-blue-600 underline">Return to Material Bank</button>
      </div>
    );
  }

  const currentContent = pages[currentPage - 1] || '';
  const progressPct = Math.round((currentPage / totalPages) * 100);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-slate-100 -m-4 sm:-m-6">
      {/* Reader Control Header */}
      <div className="h-14 bg-white border-b border-slate-200 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors flex items-center space-x-1 text-xs"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Bank</span>
          </button>
          <div className="h-4 w-px bg-slate-200"></div>
          <div>
            <h2 className="text-xs font-bold text-slate-900 max-w-xs sm:max-w-md truncate">
              {material.title}
            </h2>
            <div className="text-[10px] text-slate-500 flex items-center space-x-2 font-mono">
              <span>{material.author}</span>
              <span>•</span>
              <span className="uppercase">{material.type}</span>
              <span>•</span>
              <span>{progressPct}% Read</span>
            </div>
          </div>
        </div>

        {/* Page navigation & Zoom */}
        <div className="flex items-center space-x-2 text-xs">
          <div className="flex items-center space-x-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
            <button
              id="btn-prev-page"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1}
              className="p-1 rounded hover:bg-slate-200 disabled:opacity-30 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono font-medium text-slate-700 px-1">
              Page {currentPage} / {totalPages}
            </span>
            <button
              id="btn-next-page"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="p-1 rounded hover:bg-slate-200 disabled:opacity-30 cursor-pointer"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="hidden sm:flex items-center space-x-1 bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-1">
            <button
              onClick={() => setZoomLevel(Math.max(75, zoomLevel - 15))}
              className="p-1 hover:bg-slate-200 rounded"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono text-slate-600 px-1">{zoomLevel}%</span>
            <button
              onClick={() => setZoomLevel(Math.min(150, zoomLevel + 15))}
              className="p-1 hover:bg-slate-200 rounded"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Side Panel Toggles */}
          <div className="flex items-center space-x-1 border-l border-slate-200 pl-2">
            <button
              onClick={() => setActivePanel(activePanel === 'notes' ? null : 'notes')}
              className={`p-1.5 rounded-lg text-xs font-medium flex items-center space-x-1 ${
                activePanel === 'notes' ? 'bg-slate-900 text-white' : 'hover:bg-slate-100 text-slate-600'
              }`}
              title="Academic Notes"
            >
              <StickyNote className="w-3.5 h-3.5" />
              <span className="hidden md:inline text-[11px]">Notes ({notes.length})</span>
            </button>
            <button
              onClick={() => setActivePanel(activePanel === 'highlights' ? null : 'highlights')}
              className={`p-1.5 rounded-lg text-xs font-medium flex items-center space-x-1 ${
                activePanel === 'highlights' ? 'bg-slate-900 text-white' : 'hover:bg-slate-100 text-slate-600'
              }`}
              title="Highlights"
            >
              <Highlighter className="w-3.5 h-3.5" />
              <span className="hidden md:inline text-[11px]">Highlights ({highlights.length})</span>
            </button>
            <button
              onClick={() => setActivePanel(activePanel === 'bookmarks' ? null : 'bookmarks')}
              className={`p-1.5 rounded-lg text-xs font-medium flex items-center space-x-1 ${
                activePanel === 'bookmarks' ? 'bg-slate-900 text-white' : 'hover:bg-slate-100 text-slate-600'
              }`}
              title="Bookmarks"
            >
              <BookmarkIcon className="w-3.5 h-3.5" />
              <span className="hidden md:inline text-[11px]">Marks ({bookmarks.length})</span>
            </button>
            <button
              onClick={() => setActivePanel(activePanel === 'link' ? null : 'link')}
              className={`p-1.5 rounded-lg text-xs font-medium flex items-center space-x-1 ${
                activePanel === 'link' ? 'bg-slate-900 text-white' : 'hover:bg-slate-100 text-slate-600'
              }`}
              title="Link to Project"
            >
              <Link className="w-3.5 h-3.5" />
              <span className="hidden md:inline text-[11px]">Link</span>
            </button>
          </div>
        </div>
      </div>

      {/* Reader Body & Sidepanel Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Document Reading Canvas */}
        <div 
          className="flex-1 overflow-y-auto p-4 sm:p-8 flex justify-center"
          onMouseUp={handleTextSelection}
        >
          <div 
            className="w-full max-w-3xl bg-white rounded-xl shadow-xs border border-slate-200 p-8 sm:p-12 space-y-6 text-slate-800 leading-relaxed min-h-[600px] select-text"
            style={{ fontSize: `${(zoomLevel / 100) * 14}px` }}
          >
            <div className="border-b border-slate-100 pb-3 flex justify-between items-center text-xs text-slate-400 font-mono">
              <span>SECTION SPECIFICATION • PAGE {currentPage} OF {totalPages}</span>
              <span>NUTRIBODYSIM V1 ACADEMIC TEXTBOOK READER</span>
            </div>

            {/* Render formatted text content */}
            <div className="whitespace-pre-wrap font-serif leading-7 text-slate-800">
              {currentContent}
            </div>

            {/* Selection Toolbar Trigger if text is selected */}
            {selectedText && (
              <div className="sticky bottom-4 mx-auto max-w-md bg-slate-900 text-white p-2.5 rounded-xl shadow-lg flex items-center justify-between text-xs space-x-3 border border-slate-700 animate-in fade-in">
                <span className="truncate max-w-[180px] font-mono text-[11px] text-slate-300">
                  "{selectedText}"
                </span>
                <div className="flex items-center space-x-1.5">
                  <button
                    onClick={() => handleAddHighlight('yellow')}
                    className="px-2 py-1 bg-amber-400 text-amber-950 font-bold rounded hover:bg-amber-300 text-[10px]"
                  >
                    Yellow
                  </button>
                  <button
                    onClick={() => handleAddHighlight('green')}
                    className="px-2 py-1 bg-emerald-400 text-emerald-950 font-bold rounded hover:bg-emerald-300 text-[10px]"
                  >
                    Green
                  </button>
                  <button
                    onClick={() => {
                      setActivePanel('notes');
                      setNoteContent(`Citation from page ${currentPage}: "${selectedText}"\n\n`);
                    }}
                    className="px-2 py-1 bg-slate-700 text-white rounded hover:bg-slate-600 text-[10px]"
                  >
                    + Note
                  </button>
                </div>
              </div>
            )}

            <div className="border-t border-slate-100 pt-4 flex justify-between items-center text-xs text-slate-400 font-mono">
              <span>Cryptographic Hash: {(material.file_hash || '').slice(0, 16)}...</span>
              <span>Progress automatically saved</span>
            </div>
          </div>
        </div>

        {/* Side Panel */}
        {activePanel && (
          <aside className="w-80 bg-white border-l border-slate-200 flex flex-col shrink-0 h-full overflow-hidden select-none">
            {/* Panel Header */}
            <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <span className="text-xs font-bold text-slate-900 uppercase font-mono tracking-wider">
                {activePanel === 'notes' && 'Academic Notes & Annotations'}
                {activePanel === 'highlights' && 'Text Highlights'}
                {activePanel === 'bookmarks' && 'Page Bookmarks'}
                {activePanel === 'link' && 'Link Material to Project'}
              </span>
              <button
                onClick={() => setActivePanel(null)}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                ✕
              </button>
            </div>

            {/* Panel Contents */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {/* NOTES PANEL */}
              {activePanel === 'notes' && (
                <div className="space-y-4">
                  <form onSubmit={handleCreateNote} className="space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                    <div className="font-semibold text-slate-800">Add Note for Page {currentPage}</div>
                    <input
                      type="text"
                      placeholder="Note Title (optional)"
                      value={noteTitle}
                      onChange={e => setNoteTitle(e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-slate-300 text-xs bg-white focus:outline-none"
                    />
                    <textarea
                      rows={3}
                      required
                      placeholder="Type scientific annotation or formula context..."
                      value={noteContent}
                      onChange={e => setNoteContent(e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-slate-300 text-xs bg-white focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="w-full bg-slate-900 text-white font-semibold py-1.5 rounded hover:bg-slate-800 transition-colors"
                    >
                      Save Traceable Note
                    </button>
                  </form>

                  <div className="space-y-2">
                    <div className="text-[11px] font-mono font-semibold text-slate-400 uppercase">
                      Existing Notes ({notes.length})
                    </div>
                    {notes.map(n => (
                      <div key={n.id} className="p-2.5 rounded-lg border border-slate-200 text-xs space-y-1 bg-white">
                        <div className="flex items-center justify-between font-semibold text-slate-900">
                          <span>{n.title}</span>
                          {n.page && <span className="font-mono text-[10px] text-slate-400">P. {n.page}</span>}
                        </div>
                        <p className="text-slate-600 whitespace-pre-wrap">{n.content}</p>
                        {n.selected_text && (
                          <div className="text-[11px] text-slate-400 italic border-l-2 border-slate-200 pl-2 mt-1">
                            "{n.selected_text}"
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* HIGHLIGHTS PANEL */}
              {activePanel === 'highlights' && (
                <div className="space-y-3">
                  <div className="text-xs text-slate-500">
                    Select text inside the document reading canvas to highlight in yellow or green.
                  </div>
                  <div className="space-y-2">
                    {highlights.map(hl => (
                      <div key={hl.id} className="p-2.5 rounded-lg border border-slate-200 text-xs space-y-1 bg-white">
                        <div className="flex justify-between items-center text-[10px] font-mono">
                          <span className={`px-1.5 py-0.2 rounded font-bold uppercase ${
                            hl.color === 'yellow' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            {hl.color}
                          </span>
                          <span className="text-slate-400">Page {hl.page}</span>
                        </div>
                        <p className="text-slate-800 italic">"{hl.selected_text}"</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* BOOKMARKS PANEL */}
              {activePanel === 'bookmarks' && (
                <div className="space-y-4">
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-2">
                    <div className="font-semibold text-slate-800">Bookmark Current Page ({currentPage})</div>
                    <input
                      type="text"
                      placeholder="Bookmark title (e.g. Chapter 2 Equation)"
                      value={bookmarkTitle}
                      onChange={e => setBookmarkTitle(e.target.value)}
                      className="w-full px-2 py-1.5 rounded border border-slate-300 text-xs bg-white focus:outline-none"
                    />
                    <button
                      onClick={handleAddBookmark}
                      className="w-full bg-slate-900 text-white font-semibold py-1.5 rounded hover:bg-slate-800"
                    >
                      + Save Bookmark
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {bookmarks.map(bm => (
                      <div
                        key={bm.id}
                        onClick={() => handlePageChange(bm.page)}
                        className="p-2.5 rounded-lg border border-slate-200 hover:border-slate-400 text-xs cursor-pointer flex items-center justify-between bg-white"
                      >
                        <span className="font-semibold text-slate-800">{bm.title}</span>
                        <span className="font-mono text-[10px] text-slate-500">Page {bm.page}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* LINK TO PROJECT PANEL */}
              {activePanel === 'link' && (
                <div className="space-y-3 text-xs">
                  <div className="text-slate-600 leading-relaxed">
                    Link this academic textbook or monograph to a project workspace as an official scientific reference (Section 13).
                  </div>

                  <div className="space-y-2">
                    <label className="font-semibold text-slate-700 block">Select Target Project</label>
                    <select
                      value={selectedProjectId}
                      onChange={e => setSelectedProjectId(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white focus:outline-none"
                    >
                      <option value="">-- Choose Project --</option>
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
                      ))}
                    </select>

                    <button
                      onClick={handleLinkToProject}
                      disabled={!selectedProjectId}
                      className="w-full bg-slate-900 text-white font-semibold py-2 rounded-lg hover:bg-slate-800 disabled:opacity-40"
                    >
                      Link Reference to Project
                    </button>

                    {linkSuccess && (
                      <div className="p-2 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] flex items-center space-x-1">
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Successfully linked material to project context!</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};
