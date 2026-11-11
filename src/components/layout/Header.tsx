import React from 'react';
import { User, UserRole } from '../../types';
import { Shield, UserCheck, Activity, Search, Globe } from 'lucide-react';

interface HeaderProps {
  currentUser: User;
  allUsers: User[];
  onSwitchUser: (userId: string) => void;
  activeTab: string;
  onOpenSearch?: () => void;
}

const ROLE_LABELS_ID: Record<UserRole, string> = {
  RegisteredUser: 'Pengguna Terdaftar',
  Researcher: 'Peneliti',
  Lecturer: 'Dosen',
  Student: 'Mahasiswa',
  Admin: 'Administrator'
};

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  allUsers,
  onSwitchUser,
  onOpenSearch
}) => {
  return (
    <header className="h-14 border-b border-slate-200 bg-white px-3 sm:px-4 flex items-center justify-between sticky top-0 z-30 select-none">
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-sm tracking-wider shadow-xs">
            NB
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="font-semibold text-slate-900 tracking-tight text-sm">
                NutriBodySim
              </span>
              <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                Platform Ilmiah
              </span>
            </div>
            <p className="text-[11px] text-slate-500 hidden sm:block leading-none mt-0.5">
              Laboratorium Riset Komputasi Nutrisi & Fisiologi
            </p>
          </div>
        </div>

        <div className="hidden xl:flex items-center space-x-1 pl-4 border-l border-slate-200 text-xs text-slate-500">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
          <span className="font-medium text-slate-700">Mesin Aktif</span>
          <span className="text-slate-300 mx-1">|</span>
          <span className="text-[11px] font-mono text-slate-500">Evaluator AST & Jejak Audit</span>
        </div>
      </div>

      {/* Global Search Component in Header */}
      <div className="flex-1 max-w-xs sm:max-w-sm md:max-w-md mx-2 sm:mx-4">
        <button
          id="btn-header-global-search"
          type="button"
          onClick={onOpenSearch}
          className="w-full flex items-center justify-between px-3 py-1.5 bg-slate-50 hover:bg-slate-100/90 text-slate-500 hover:text-slate-800 border border-slate-200 hover:border-slate-300 rounded-xl text-xs transition-all shadow-xs group"
          title="Pencarian Global: Proyek, Rumus, Dataset, Modul PDF & Jurnal Ilmiah (Ctrl+K)"
        >
          <div className="flex items-center space-x-2 truncate">
            <Search className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 transition-colors shrink-0" />
            <span className="truncate">Cari proyek, rumus AST, modul PDF & jurnal...</span>
          </div>
          <kbd className="hidden sm:inline-flex items-center space-x-0.5 text-[10px] font-mono bg-white border border-slate-200 px-1.5 py-0.5 rounded text-slate-400 font-semibold shadow-2xs shrink-0">
            <span>⌘K / Ctrl+K</span>
          </kbd>
        </button>
      </div>

      <div className="flex items-center space-x-2 sm:space-x-3">
        {/* User Role Switcher in Indonesian */}
        <div className="flex items-center space-x-1.5 sm:space-x-2 bg-slate-50 border border-slate-200 rounded-lg px-2 sm:px-2.5 py-1">
          {allUsers.length > 0 && (
            <>
              <div className="flex items-center space-x-1 text-xs text-slate-600">
                <UserCheck className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <span className="font-medium hidden md:inline text-[11px]">Pengguna:</span>
              </div>
              <select
                id="user-role-selector"
                aria-label="Ganti peran pengguna aktif"
                value={currentUser.id}
                onChange={(e) => onSwitchUser(e.target.value)}
                className="bg-transparent text-xs font-semibold text-slate-800 focus:outline-none cursor-pointer border-none max-w-[120px] sm:max-w-[160px] truncate"
              >
                {allUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({ROLE_LABELS_ID[u.role] || u.role})
                  </option>
                ))}
              </select>
            </>
          )}
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold shrink-0 ${
              currentUser.role === 'Admin'
                ? 'bg-purple-100 text-purple-700'
                : currentUser.role === 'Researcher'
                ? 'bg-blue-100 text-blue-700'
                : currentUser.role === 'Lecturer'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
            }`}
          >
            {ROLE_LABELS_ID[currentUser.role] || currentUser.role}
          </span>
        </div>

        {/* Permissions preview tag in Indonesian */}
        <div className="hidden lg:flex items-center space-x-1 text-[11px] text-slate-500 bg-slate-100/70 border border-slate-200/80 px-2 py-1 rounded">
          <Shield className="w-3 h-3 text-slate-400" />
          <span>{currentUser.permissions.length} Hak Akses</span>
        </div>
      </div>
    </header>
  );
};

