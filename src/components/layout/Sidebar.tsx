import React from 'react';
import { 
  LayoutDashboard, 
  FolderKanban, 
  BookOpen, 
  Binary, 
  Calculator, 
  Database, 
  BarChart3, 
  Code2, 
  BookMarked, 
  FlaskConical, 
  GitCommit, 
  FileText,
  Users
} from 'lucide-react';

export type TabId = 
  | 'dashboard'
  | 'projects'
  | 'materials'
  | 'registry'
  | 'calculator'
  | 'datalab'
  | 'statistics'
  | 'codelab'
  | 'notebook'
  | 'research'
  | 'experiments'
  | 'provenance'
  | 'docs';

interface SidebarProps {
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onSelectTab }) => {
  const navItems = [
    { id: 'dashboard' as TabId, label: 'Beranda & Laboratorium', icon: LayoutDashboard, section: 'UTAMA' },
    { id: 'projects' as TabId, label: 'Proyek & Tim Riset', icon: FolderKanban, section: 'UTAMA' },
    { id: 'materials' as TabId, label: 'Bank Materi & Modul PDF', icon: BookOpen, section: 'AKADEMIK' },
    { id: 'registry' as TabId, label: 'Registri Ilmiah (AST)', icon: Binary, section: 'ILMIAH' },
    { id: 'calculator' as TabId, label: 'Kalkulator Fisiologi (AST)', icon: Calculator, section: 'ILMIAH' },
    { id: 'datalab' as TabId, label: 'Laboratorium Data (RAW)', icon: Database, section: 'ANALITIK' },
    { id: 'statistics' as TabId, label: 'Lab Biostatistika', icon: BarChart3, section: 'ANALITIK' },
    { id: 'codelab' as TabId, label: 'Lab Kode & Jembatan', icon: Code2, section: 'KOMPUTASI' },
    { id: 'research' as TabId, label: 'Ruang Kerja Riset (F1)', icon: FlaskConical, section: 'RISET' },
    { id: 'notebook' as TabId, label: 'Buku NutriNotebook', icon: BookMarked, section: 'RISET' },
    { id: 'experiments' as TabId, label: 'Kotak Pasir Eksperimen', icon: FlaskConical, section: 'RISET' },
    { id: 'provenance' as TabId, label: 'Jejak Audit & Provenans', icon: GitCommit, section: 'TATA KELOLA' },
    { id: 'docs' as TabId, label: 'Panduan Kontribusi', icon: FileText, section: 'TATA KELOLA' }
  ];

  // Group by section in Indonesian
  const sections = ['UTAMA', 'AKADEMIK', 'ILMIAH', 'ANALITIK', 'KOMPUTASI', 'RISET', 'TATA KELOLA'];

  return (
    <aside className="w-64 border-r border-slate-200 bg-slate-50/60 flex flex-col justify-between select-none h-[calc(100vh-3.5rem)] overflow-y-auto">
      <div className="p-3 space-y-4">
        {sections.map((sec) => {
          const items = navItems.filter(item => item.section === sec);
          if (items.length === 0) return null;
          return (
            <div key={sec} className="space-y-1">
              <div className="px-2 text-[10px] font-mono tracking-wider font-semibold text-slate-400 uppercase">
                {sec}
              </div>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      id={`nav-tab-${item.id}`}
                      onClick={() => onSelectTab(item.id)}
                      className={`w-full flex items-center space-x-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                        isActive
                          ? 'bg-slate-900 text-white font-semibold shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                      }`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-3 border-t border-slate-200 bg-white/70 text-[11px] text-slate-500 space-y-1">
        <div className="flex justify-between font-mono">
          <span>Status Mesin:</span>
          <span className="text-emerald-600 font-medium">Deterministik</span>
        </div>
        <div className="flex justify-between font-mono">
          <span>Verifikasi:</span>
          <span className="text-slate-600 font-medium">Mode Eksplisit</span>
        </div>
        <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-100">
          Kepatuhan Bagian 2: Nol rumus ter-hardcode di UI.
        </div>
      </div>
    </aside>
  );
};
