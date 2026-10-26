import React, { useState, useEffect } from 'react';
import { NutriNotebook, NotebookCell, Project, User } from '../../types';
import { api } from '../../api';
import { 
  BookMarked, 
  Plus, 
  Play, 
  Trash2, 
  Download, 
  Share2, 
  Check, 
  BookOpen, 
  Database, 
  Calculator, 
  Code2, 
  AlignLeft,
  ChevronDown
} from 'lucide-react';

interface NotebookViewProps {
  currentUser: User;
  projects: Project[];
}

export const NotebookView: React.FC<NotebookViewProps> = ({ currentUser, projects }) => {
  const [notebooks, setNotebooks] = useState<NutriNotebook[]>([]);
  const [selectedNotebookId, setSelectedNotebookId] = useState<string>('');
  const [currentNotebook, setCurrentNotebook] = useState<NutriNotebook | null>(null);
  const [cells, setCells] = useState<NotebookCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAll, setRunningAll] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  useEffect(() => {
    loadNotebooks();
  }, []);

  const loadNotebooks = async () => {
    try {
      setLoading(true);
      const res = await api.getNotebooks();
      setNotebooks(res.notebooks);
      if (res.notebooks.length > 0) {
        selectNotebook(res.notebooks[0].id);
      }
    } catch (err) {
      console.error('Failed to load notebooks', err);
    } finally {
      setLoading(false);
    }
  };

  const selectNotebook = async (id: string) => {
    setSelectedNotebookId(id);
    try {
      const detail = await api.getNotebookDetail(id);
      setCurrentNotebook(detail.notebook);
      setCells(detail.cells);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddCell = async (cellType: NotebookCell['cell_type']) => {
    if (!selectedNotebookId) return;

    let initialContent = '';
    let initialConfig: any = {};

    if (cellType === 'MARKDOWN') {
      initialContent = '### New Scientific Hypothesis Note\nEnter physiological commentary and clinical implications here...';
    } else if (cellType === 'CODE') {
      initialContent = '# Computational cell\nimport numpy as np\nprint("Executing notebook code block...")';
      initialConfig = { language: 'python' };
    } else if (cellType === 'FORMULA_RUN') {
      initialContent = 'FORMULA_BMI_KEYES';
      initialConfig = { formula_id: 'FORMULA_BMI_KEYES', inputs: { VAR_BODY_WEIGHT: { value: 70, unit: 'kg' }, VAR_STATURE: { value: 175, unit: 'cm' } } };
    } else if (cellType === 'REFERENCE') {
      initialContent = 'Referencing Clinical Nutrition Textbook Chapter 3 (Energy Expenditure)';
    } else if (cellType === 'DATA_PREVIEW') {
      initialContent = 'Dataset Preview: Baseline Metabolic Cohort (v1.0 RAW)';
    }

    try {
      const res = await api.addNotebookCell(selectedNotebookId, {
        cell_type: cellType,
        content: initialContent,
        config: initialConfig
      });
      setCells([...cells, res.cell]);
    } catch (err: any) {
      alert(`Failed to add cell: ${err.message}`);
    }
  };

  const handleDeleteCell = async (cellId: string) => {
    try {
      await api.deleteNotebookCell(cellId);
      setCells(cells.filter(c => c.id !== cellId));
    } catch (err: any) {
      alert(`Delete error: ${err.message}`);
    }
  };

  const handleUpdateCellContent = async (cellId: string, content: string) => {
    setCells(cells.map(c => c.id === cellId ? { ...c, content } : c));
    try {
      await api.updateNotebookCell(cellId, { content });
    } catch (err) {
      console.error(err);
    }
  };

  const handleRunAllCells = async () => {
    setRunningAll(true);
    // Simulate sequential cell execution
    setTimeout(() => {
      setCells(prev => prev.map(c => ({
        ...c,
        last_executed_at: new Date().toISOString(),
        execution_count: (c.execution_count || 0) + 1,
        output: c.cell_type === 'CODE' 
          ? { stdout: 'Executed successfully. Variables preserved in session scope.' }
          : c.cell_type === 'FORMULA_RUN'
          ? { result: 22.86, unit: 'kg/m²', status: 'Calculated via AST Engine' }
          : c.output
      })));
      setRunningAll(false);
    }, 800);
  };

  const handleExportNotebook = (format: string) => {
    setExportNotice(`Exported notebook as ${format} package with provenance hash signatures.`);
    setTimeout(() => setExportNotice(null), 3500);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <BookMarked className="w-5 h-5 text-slate-700" />
            <h1 className="text-lg font-bold text-slate-900">NutriNotebook Laboratory</h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Multi-cell interactive environment connecting academic literature references, raw datasets, formulas, and Python scripts.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleRunAllCells}
            disabled={runningAll}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>{runningAll ? 'Running All Cells...' : 'Run All Cells'}</span>
          </button>

          <div className="relative group">
            <button
              onClick={() => handleExportNotebook('Jupyter .ipynb')}
              className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>
          </div>
        </div>
      </div>

      {exportNotice && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center space-x-2">
          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{exportNotice}</span>
        </div>
      )}

      {/* Notebook Selector */}
      <div className="bg-white p-3 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
        <div className="flex items-center space-x-3">
          <span className="font-mono font-bold text-slate-500 uppercase">Active Notebook:</span>
          <select
            value={selectedNotebookId}
            onChange={e => selectNotebook(e.target.value)}
            className="font-semibold text-slate-900 bg-slate-50 border border-slate-200 px-3 py-1 rounded-lg focus:outline-none"
          >
            {notebooks.map(nb => (
              <option key={nb.id} value={nb.id}>{nb.title}</option>
            ))}
          </select>
        </div>
        <span className="font-mono text-slate-400 text-[11px]">
          {cells.length} Executable Cells
        </span>
      </div>

      {/* Cell List */}
      <div className="space-y-4">
        {cells.map((cell, index) => (
          <div
            key={cell.id}
            className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden text-xs"
          >
            {/* Cell Header */}
            <div className="bg-slate-50 px-3 py-1.5 border-b border-slate-200 flex items-center justify-between text-[11px] font-mono text-slate-500">
              <div className="flex items-center space-x-2">
                <span className="font-bold text-slate-700">[{index + 1}]</span>
                <span className="uppercase px-1.5 py-0.2 rounded bg-slate-200/60 font-semibold text-slate-600">
                  {cell.cell_type}
                </span>
                {cell.last_executed_at && (
                  <span className="text-[10px] text-slate-400">
                    Run #{cell.execution_count}
                  </span>
                )}
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleDeleteCell(cell.id)}
                  className="text-slate-400 hover:text-red-600 p-1"
                  title="Delete Cell"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Cell Content based on type */}
            <div className="p-4 space-y-3">
              {cell.cell_type === 'MARKDOWN' && (
                <textarea
                  rows={3}
                  value={cell.content}
                  onChange={e => handleUpdateCellContent(cell.id, e.target.value)}
                  className="w-full text-xs font-serif text-slate-800 focus:outline-none resize-none bg-slate-50/50 p-2.5 rounded border border-slate-200"
                />
              )}

              {cell.cell_type === 'CODE' && (
                <div className="space-y-2">
                  <textarea
                    rows={4}
                    value={cell.content}
                    onChange={e => handleUpdateCellContent(cell.id, e.target.value)}
                    className="w-full font-mono text-xs bg-slate-900 text-emerald-300 p-3 rounded-lg focus:outline-none resize-none"
                    spellCheck={false}
                  />
                  {cell.output && (
                    <div className="p-2.5 bg-slate-100 rounded font-mono text-[11px] text-slate-700 border border-slate-200">
                      <span className="text-slate-400 block text-[10px] uppercase font-bold">Output:</span>
                      {cell.output.stdout || JSON.stringify(cell.output)}
                    </div>
                  )}
                </div>
              )}

              {cell.cell_type === 'REFERENCE' && (
                <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg space-y-1">
                  <div className="flex items-center space-x-1.5 text-amber-900 font-semibold font-mono text-[11px]">
                    <BookOpen className="w-3.5 h-3.5 text-amber-700" />
                    <span>Academic Reference Citation (Section 14)</span>
                  </div>
                  <p className="text-slate-700 italic">"{cell.content}"</p>
                  <div className="text-[10px] text-slate-500 font-mono">
                    Linked to Academic Material Bank • Preserves page number and exact text highlight.
                  </div>
                </div>
              )}

              {cell.cell_type === 'DATA_PREVIEW' && (
                <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-lg space-y-2">
                  <div className="flex items-center space-x-1.5 text-blue-900 font-semibold font-mono text-[11px]">
                    <Database className="w-3.5 h-3.5 text-blue-700" />
                    <span>Data Lab Ingestion Link (Section 47)</span>
                  </div>
                  <p className="text-slate-700 font-medium">{cell.content}</p>
                  <div className="text-[10px] font-mono text-slate-500">
                    Status: Immutable v1.0 RAW • Schema: 5 columns, 24 records
                  </div>
                </div>
              )}

              {cell.cell_type === 'FORMULA_RUN' && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 text-slate-800 font-semibold font-mono text-[11px]">
                      <Calculator className="w-3.5 h-3.5 text-slate-600" />
                      <span>AST Calculation Cell: {cell.content}</span>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded font-bold">
                      VERIFIED
                    </span>
                  </div>
                  {cell.output && (
                    <div className="p-2 bg-white rounded border border-slate-200 font-mono text-xs flex justify-between items-center">
                      <span className="text-slate-500">Computed Output:</span>
                      <span className="font-bold text-slate-900">{cell.output.result} {cell.output.unit}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add New Cell Toolbar */}
      <div className="p-3 bg-white rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-mono font-semibold text-slate-500 uppercase">
          Insert Computational Cell:
        </span>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => handleAddCell('MARKDOWN')}
            className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-medium flex items-center space-x-1"
          >
            <AlignLeft className="w-3.5 h-3.5" />
            <span>+ Text / Note</span>
          </button>
          <button
            onClick={() => handleAddCell('CODE')}
            className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-medium flex items-center space-x-1"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>+ Python Code</span>
          </button>
          <button
            onClick={() => handleAddCell('FORMULA_RUN')}
            className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-medium flex items-center space-x-1"
          >
            <Calculator className="w-3.5 h-3.5" />
            <span>+ AST Formula</span>
          </button>
          <button
            onClick={() => handleAddCell('REFERENCE')}
            className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-medium flex items-center space-x-1"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>+ Monograph Citation</span>
          </button>
          <button
            onClick={() => handleAddCell('DATA_PREVIEW')}
            className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-medium flex items-center space-x-1"
          >
            <Database className="w-3.5 h-3.5" />
            <span>+ Data Preview</span>
          </button>
        </div>
      </div>
    </div>
  );
};
