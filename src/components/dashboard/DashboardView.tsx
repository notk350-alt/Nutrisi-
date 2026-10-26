import React, { useRef, useState } from 'react';
import { User, UserRole } from '../../types';
import { TabId } from '../layout/Sidebar';
import { TreeOfLife3D } from './TreeOfLife3D';
import { ORGAN_EDUCATION_DATA, OrganEducationItem } from '../../data/organEducationData';
import { OrganEducationModal } from './OrganEducationModal';
import { 
  FolderKanban, 
  BookOpen, 
  Binary, 
  Calculator, 
  Database, 
  FlaskConical, 
  ShieldCheck, 
  ArrowRight,
  Activity,
  AlertTriangle,
  Sparkles,
  BarChart3,
  Code2,
  GitCommit,
  Layers,
  Heart,
  Wind,
  Utensils,
  Droplets,
  Stethoscope,
  ExternalLink,
  ChevronRight,
  GraduationCap
} from 'lucide-react';

interface DashboardViewProps {
  currentUser: User;
  onNavigate: (tab: TabId) => void;
  stats: {
    projectsCount: number;
    materialsCount: number;
    variablesCount: number;
    formulasCount: number;
    modelsCount: number;
    datasetsCount: number;
    experimentsCount: number;
    auditCount: number;
  };
}

const ROLE_LABELS_ID: Record<UserRole, string> = {
  RegisteredUser: 'Pengguna Terdaftar',
  Researcher: 'Peneliti',
  Lecturer: 'Dosen',
  Student: 'Mahasiswa',
  Admin: 'Administrator'
};

const ORGAN_ICONS: Record<string, any> = {
  heart: Heart,
  lungs: Wind,
  stomach: Utensils,
  liver: Activity,
  kidneys: Droplets,
  brain: Sparkles
};

interface QuickActionItem {
  title: string;
  desc: string;
  icon: any;
  tab: TabId;
  badge: string;
  accentColor: string;
}

const Interactive3DCard: React.FC<{
  item: QuickActionItem;
  onNavigate: (tab: TabId) => void;
}> = ({ item, onNavigate }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [rotateX, setRotateX] = useState(0);
  const [rotateY, setRotateY] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rX = ((y - centerY) / centerY) * -12;
    const rY = ((x - centerX) / centerX) * 14;

    setRotateX(rX);
    setRotateY(rY);
  };

  const handleMouseLeave = () => {
    setRotateX(0);
    setRotateY(0);
    setIsHovered(false);
  };

  const Icon = item.icon;

  return (
    <div
      ref={cardRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={() => onNavigate(item.tab)}
      style={{ perspective: '1000px' }}
      className="cursor-pointer group"
    >
      <div
        style={{
          transform: isHovered
            ? `rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(14px) scale(1.025)`
            : 'rotateX(0deg) rotateY(0deg) translateZ(0px) scale(1)',
          transformStyle: 'preserve-3d',
          transition: isHovered ? 'transform 0.08s ease-out' : 'transform 0.5s ease-out, box-shadow 0.3s ease-out',
        }}
        className="bg-slate-900/80 p-5 rounded-2xl border border-slate-800/90 hover:border-emerald-500/50 transition-colors shadow-lg hover:shadow-2xl relative overflow-hidden flex flex-col justify-between min-h-[195px] text-slate-100"
      >
        {/* Dynamic 3D shine */}
        {isHovered && (
          <div
            className="absolute inset-0 pointer-events-none opacity-20 rounded-2xl transition-opacity"
            style={{
              background: `radial-gradient(circle at ${50 + rotateY * 2.5}% ${50 - rotateX * 2.5}%, rgba(16, 185, 129, 0.35), transparent 70%)`
            }}
          />
        )}

        <div style={{ transform: 'translateZ(24px)', transformStyle: 'preserve-3d' }}>
          <div className="flex items-center justify-between mb-3">
            <div 
              style={{ transform: 'translateZ(18px)' }}
              className="w-10 h-10 rounded-xl bg-slate-950 text-white flex items-center justify-center border border-slate-800 shadow-md transition-transform group-hover:scale-110"
            >
              <Icon className="w-5 h-5 text-emerald-400" />
            </div>
            <span 
              style={{ transform: 'translateZ(14px)' }}
              className="text-[10px] font-mono uppercase bg-slate-800/90 px-2.5 py-1 rounded-full text-slate-300 font-bold border border-slate-700/60"
            >
              {item.badge}
            </span>
          </div>

          <h3 
            style={{ transform: 'translateZ(15px)' }}
            className="text-sm font-bold text-white group-hover:text-emerald-400 transition-colors"
          >
            {item.title}
          </h3>
          <p 
            style={{ transform: 'translateZ(10px)' }}
            className="text-xs text-slate-400 mt-1.5 line-clamp-2 leading-relaxed"
          >
            {item.desc}
          </p>
        </div>

        <div 
          style={{ transform: 'translateZ(20px)' }}
          className="flex items-center justify-between text-xs font-semibold text-slate-300 pt-3 mt-3 border-t border-slate-800/80 group-hover:text-emerald-400"
        >
          <span className="flex items-center space-x-1">
            <span>Buka Modul</span>
          </span>
          <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform text-emerald-400" />
        </div>
      </div>
    </div>
  );
};

export const DashboardView: React.FC<DashboardViewProps> = ({
  currentUser,
  onNavigate,
  stats,
}) => {
  const [selectedOrganForEducation, setSelectedOrganForEducation] = useState<string | null>(null);

  const quickActions: QuickActionItem[] = [
    {
      title: 'Kalkulator Fisiologi (AST)',
      desc: 'Jalankan rumus biokimia & metabolisme terdaftar dengan normalisasi unit dimensional dan jejak langkah audit.',
      icon: Calculator,
      tab: 'calculator',
      badge: 'Komputasi Ilmiah',
      accentColor: '#10b981'
    },
    {
      title: 'Bank Materi & Modul PDF',
      desc: 'Akses buku teks Guyton & Hall, Krause, monograf teknis, penanda halaman, dan anotasi teks ilmiah.',
      icon: BookOpen,
      tab: 'materials',
      badge: 'Perpustakaan Akademik',
      accentColor: '#f59e0b'
    },
    {
      title: 'Registri Ilmiah (AST)',
      desc: 'Jelajahi variabel dimensi, parameter fisiologis, rumus terdaftar, dan sitasi referensi primer.',
      icon: Binary,
      tab: 'registry',
      badge: 'Registri Fisiologi',
      accentColor: '#3b82f6'
    },
    {
      title: 'Laboratorium Data (RAW)',
      desc: 'Impor dataset klinis dengan proteksi imutabilitas, validasi tipe data ketat, dan versi audit.',
      icon: Database,
      tab: 'datalab',
      badge: 'Pipeline Data',
      accentColor: '#06b6d4'
    },
    {
      title: 'Kotak Pasir Eksperimen',
      desc: 'Klon model dasar menjadi cabang hipotesis eksperimental dan jalankan simulasi sensitivitas delta.',
      icon: FlaskConical,
      tab: 'experiments',
      badge: 'Uji Hipotesis',
      accentColor: '#ec4899'
    },
    {
      title: 'Proyek & Tim Riset',
      desc: 'Kelola kolaborasi penelitian terisolasi, hak akses anggota tim, dan artefak komputasi bersama.',
      icon: FolderKanban,
      tab: 'projects',
      badge: 'Ruang Kolaborasi',
      accentColor: '#8b5cf6'
    },
    {
      title: 'Lab Biostatistika',
      desc: 'Hitung korelasi Pearson, regresi linier, dan uji t-Student dengan narasi pelaporan standar APA Edisi ke-7.',
      icon: BarChart3,
      tab: 'statistics',
      badge: 'Inferensi Statistik',
      accentColor: '#10b981'
    },
    {
      title: 'Lab Kode & Jembatan',
      desc: 'Jembatan multi-bahasa (Python, R, Julia) untuk memanggil mesin deterministik AST tanpa celah eksekusi liar.',
      icon: Code2,
      tab: 'codelab',
      badge: 'Integrasi Bahasa',
      accentColor: '#06b6d4'
    },
    {
      title: 'Jejak Audit & Provenans',
      desc: 'Verifikasi integritas kriptografis SHA-256 untuk seluruh kalkulasi, transformasi dataset, dan riwayat.',
      icon: GitCommit,
      tab: 'provenance',
      badge: 'Tata Kelola Data',
      accentColor: '#f59e0b'
    }
  ];

  return (
    <div className="bg-slate-950 text-slate-100 rounded-3xl p-4 sm:p-7 border border-slate-900 shadow-2xl space-y-8 max-w-6xl mx-auto pb-12 selection:bg-emerald-500 selection:text-slate-950">
      
      {/* 1. SEAMLESS 3D VISUALIZATION: TREE OF LIFE + HOLOGRAPHIC ORGANS */}
      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <h2 className="text-sm font-bold text-white tracking-tight flex items-center space-x-2">
              <span>Pohon Kehidupan Fisiologi & Anatomi Holografik Organ (3D Interaktif)</span>
            </h2>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            Klik kanvas untuk ganti fokus: <strong className="text-emerald-400">Pohon</strong> ↔ <strong className="text-cyan-400">Organ Tubuh</strong>
          </span>
        </div>

        {/* The 3D Canvas smoothly blending into the slate-950 background */}
        <TreeOfLife3D 
          onNavigate={onNavigate} 
          onOpenOrganEducation={(organId) => setSelectedOrganForEducation(organId)}
        />
      </section>

      {/* 2. PUSAT PEMBELAJARAN CARA KERJA ORGAN TUBUH & FISIOLOGI (NEW EDUCATIONAL HUB) */}
      <section className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <div className="flex items-center space-x-2">
              <GraduationCap className="w-5 h-5 text-emerald-400" />
              <h2 className="text-base font-bold text-white tracking-tight">
                Pusat Pembelajaran Fisiologi: Cara Kerja & Metabolisme Organ Tubuh
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Pelajari mekanisme biologis, regulasi biokimia, interaksi nutrisi, dan persamaan AST yang menggerakkan setiap organ tubuh.
            </p>
          </div>
          <span className="text-xs font-mono bg-slate-900 px-3 py-1 rounded-xl text-emerald-400 border border-slate-800 shrink-0 self-start sm:self-auto">
            6 Sistem Fisiologis Terverifikasi
          </span>
        </div>

        {/* Organ Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ORGAN_EDUCATION_DATA.map((organ) => {
            const OrganIcon = ORGAN_ICONS[organ.id] || Activity;
            return (
              <div
                key={organ.id}
                onClick={() => setSelectedOrganForEducation(organ.id)}
                className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/90 hover:border-slate-700 hover:bg-slate-900 transition-all cursor-pointer group flex flex-col justify-between space-y-4 shadow-md hover:shadow-xl"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div 
                      className="w-10 h-10 rounded-xl flex items-center justify-center border shadow-xs transition-transform group-hover:scale-105"
                      style={{ 
                        backgroundColor: `${organ.hexColor}20`, 
                        borderColor: `${organ.hexColor}40`,
                        color: organ.hexColor 
                      }}
                    >
                      <OrganIcon className="w-5 h-5" />
                    </div>
                    <span 
                      className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full font-bold border"
                      style={{ 
                        backgroundColor: `${organ.hexColor}15`, 
                        borderColor: `${organ.hexColor}30`,
                        color: organ.hexColor 
                      }}
                    >
                      {organ.category.split(' ')[0]}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-sm font-bold text-white group-hover:text-emerald-300 transition-colors">
                      {organ.name}
                    </h3>
                    <p className="text-[11px] text-slate-400 font-mono italic mt-0.5">
                      {organ.latinName}
                    </p>
                    <p className="text-xs text-slate-300 leading-relaxed mt-2 line-clamp-2">
                      {organ.summary}
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs font-semibold text-slate-400 group-hover:text-emerald-400 transition-colors">
                  <span className="flex items-center space-x-1">
                    <span>Pelajari Mekanisme Kerja</span>
                  </span>
                  <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. LABORATORY PLATFORM METRICS & STATUS BANNER */}
      <div className="bg-slate-900/80 text-white rounded-2xl p-5 sm:p-6 border border-slate-800/90 shadow-lg relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-mono uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded font-semibold">
                Laboratorium NutriBodySim Aktif
              </span>
              <span className="text-xs text-slate-400 font-mono">Arsitektur AST Terpisah</span>
            </div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white">
              Laboratorium Riset Komputasi Nutrisi & Fisiologi
            </h1>
            <p className="text-xs text-slate-300 leading-relaxed">
              Arsitektur terpisah antara mesin kalkulasi dan konten ilmiah.
              Rumus ilmiah diregistrasikan sebagai simpul AST (Abstract Syntax Tree) dengan audit normalisasi unit,
              verifikasi provenans SHA-256, dan nol rumus ter-hardcode di antarmuka pengguna.
            </p>
          </div>

          <div className="flex sm:flex-col items-start sm:items-end justify-between sm:justify-center border-t sm:border-t-0 sm:border-l border-slate-800 pt-3 sm:pt-0 sm:pl-5 space-y-1 shrink-0">
            <div className="text-[11px] text-slate-400">Operator Aktif:</div>
            <div className="text-sm font-semibold text-white">{currentUser.name}</div>
            <div className="text-xs font-mono text-emerald-400 bg-emerald-950/40 px-2.5 py-0.5 rounded border border-emerald-800/40">
              Peran: {ROLE_LABELS_ID[currentUser.role] || currentUser.role}
            </div>
          </div>
        </div>
      </div>

      {/* Laboratory Stat Cards in Dark Mode */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="bg-slate-900/70 p-4 rounded-2xl border border-slate-800/80 shadow-md hover:border-slate-700 transition-colors">
          <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">Rumus Terdaftar (AST)</div>
          <div className="text-2xl font-bold text-white mt-1">{stats.formulasCount}</div>
          <div className="text-[11px] text-emerald-400 mt-0.5 font-medium">Evaluasi Deterministik</div>
        </div>
        <div className="bg-slate-900/70 p-4 rounded-2xl border border-slate-800/80 shadow-md hover:border-slate-700 transition-colors">
          <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">Variabel & Parameter</div>
          <div className="text-2xl font-bold text-white mt-1">{stats.variablesCount + stats.modelsCount}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Tipe Dimensi Terverifikasi</div>
        </div>
        <div className="bg-slate-900/70 p-4 rounded-2xl border border-slate-800/80 shadow-md hover:border-slate-700 transition-colors">
          <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">Modul PDF & Materi</div>
          <div className="text-2xl font-bold text-white mt-1">{stats.materialsCount}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Guyton, Krause & Jurnal</div>
        </div>
        <div className="bg-slate-900/70 p-4 rounded-2xl border border-slate-800/80 shadow-md hover:border-slate-700 transition-colors">
          <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">Dataset & Versi RAW</div>
          <div className="text-2xl font-bold text-white mt-1">{stats.datasetsCount}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Pipeline Imutabel Terproteksi</div>
        </div>
      </div>

      {/* 4. PILIHAN MODUL LABORATORIUM DALAM KARTU 3D PERSPEKTIF */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div>
            <h2 className="text-sm font-bold text-white tracking-tight flex items-center space-x-1.5">
              <span>Pilihan Modul Laboratorium (Kartu Perspektif 3D)</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Arahkan kursor pada kartu untuk merasakan interaksi kedalaman sudut 3D dinamis.
            </p>
          </div>
          <span className="text-xs text-slate-300 font-mono bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800">
            {quickActions.length} Modul Aktif
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {quickActions.map((qa) => (
            <Interactive3DCard
              key={qa.title}
              item={qa}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </section>

      {/* 5. RBAC PERMISSIONS IN DARK THEME */}
      <div className="bg-slate-900/70 p-5 rounded-2xl border border-slate-800/90 space-y-3.5 shadow-md">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-white">
              Kendali Akses Berbasis Peran (RBAC) & Otoritas Ilmiah
            </h2>
          </div>
          <span className="text-xs text-slate-400">
            Peran Saat Ini: <strong className="text-emerald-400">{ROLE_LABELS_ID[currentUser.role] || currentUser.role}</strong>
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          {[
            { perm: 'VIEW', granted: currentUser.permissions.includes('VIEW'), label: 'LIHAT', desc: 'Inspeksi registri & materi PDF' },
            { perm: 'USE', granted: currentUser.permissions.includes('USE'), label: 'GUNAKAN', desc: 'Jalankan kalkulasi & model AST' },
            { perm: 'CREATE', granted: currentUser.permissions.includes('CREATE'), label: 'BUAT', desc: 'Tambah proyek & catatan riset' },
            { perm: 'CLONE', granted: currentUser.permissions.includes('CLONE'), label: 'KLON', desc: 'Cabang model eksperimental' },
            { perm: 'VERIFY', granted: currentUser.permissions.includes('VERIFY'), label: 'VERIFIKASI', desc: 'Sertifikasi model ilmiah' }
          ].map((p) => (
            <div
              key={p.perm}
              className={`p-3 rounded-xl border ${
                p.granted 
                  ? 'bg-emerald-950/30 border-emerald-700/50 text-emerald-200' 
                  : 'bg-slate-950/60 border-slate-800 text-slate-500 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between font-mono font-bold text-xs">
                <span>{p.label}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${p.granted ? 'bg-emerald-800/60 text-emerald-200' : 'bg-slate-800 text-slate-500'}`}>
                  {p.granted ? 'Aktif' : 'Terkunci'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">{p.desc}</p>
            </div>
          ))}
        </div>

        {currentUser.role === 'Student' && (
          <div className="flex items-center space-x-2 text-xs text-amber-300 bg-amber-950/40 p-3 rounded-xl border border-amber-800/50">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>
              Mode Mahasiswa: Anda dapat melihat dan menggunakan model ilmiah serta mengklon cabang eksperimental. Verifikasi formal model sistem memerlukan otorisasi Dosen, Peneliti, atau Administrator.
            </span>
          </div>
        )}
      </div>

      {/* Comprehensive Organ Education Modal */}
      <OrganEducationModal
        organId={selectedOrganForEducation}
        onClose={() => setSelectedOrganForEducation(null)}
        onNavigate={onNavigate}
        onSelectOrgan={(id) => setSelectedOrganForEducation(id)}
      />
    </div>
  );
};
