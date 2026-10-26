import React, { useState } from 'react';
import { OrganEducationItem, ORGAN_EDUCATION_DATA } from '../../data/organEducationData';
import { TabId } from '../layout/Sidebar';
import { 
  Heart, 
  Wind, 
  Utensils, 
  Activity, 
  Droplets, 
  Sparkles,
  BookOpen, 
  Calculator, 
  ExternalLink, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  ArrowRight,
  ChevronRight,
  HelpCircle,
  Stethoscope
} from 'lucide-react';

interface OrganEducationModalProps {
  organId: string | null;
  onClose: () => void;
  onNavigate: (tab: TabId) => void;
  onSelectOrgan?: (id: string) => void;
}

const ICON_MAP: Record<string, any> = {
  Heart,
  Wind,
  Utensils,
  Activity,
  Droplets,
  Sparkles
};

export const OrganEducationModal: React.FC<OrganEducationModalProps> = ({
  organId,
  onClose,
  onNavigate,
  onSelectOrgan
}) => {
  const [selectedTab, setSelectedTab] = useState<'mechanism' | 'nutrients' | 'formulas' | 'quiz'>('mechanism');
  const [quizAnswer, setQuizAnswer] = useState<number | null>(null);
  const [isAnswerSubmitted, setIsAnswerSubmitted] = useState(false);

  if (!organId) return null;

  const organ = ORGAN_EDUCATION_DATA.find(o => o.id === organId) || ORGAN_EDUCATION_DATA[0];
  const IconComponent = ICON_MAP[organ.iconName] || Activity;

  const handleSelectDifferentOrgan = (newId: string) => {
    setQuizAnswer(null);
    setIsAnswerSubmitted(false);
    if (onSelectOrgan) {
      onSelectOrgan(newId);
    }
  };

  const handleOptionClick = (idx: number) => {
    if (isAnswerSubmitted) return;
    setQuizAnswer(idx);
    setIsAnswerSubmitted(true);
  };

  const resetQuiz = () => {
    setQuizAnswer(null);
    setIsAnswerSubmitted(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="w-full max-w-4xl max-h-[92vh] bg-slate-950 border border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="p-4 sm:p-6 border-b border-slate-800/80 bg-gradient-to-r from-slate-900 via-slate-950 to-slate-900 flex items-center justify-between">
          <div className="flex items-center space-x-3.5">
            <div 
              className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg border"
              style={{ 
                backgroundColor: `${organ.hexColor}20`, 
                borderColor: `${organ.hexColor}40`,
                color: organ.hexColor 
              }}
            >
              <IconComponent className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span 
                  className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full font-bold border"
                  style={{ 
                    backgroundColor: `${organ.hexColor}15`, 
                    color: organ.hexColor,
                    borderColor: `${organ.hexColor}35`
                  }}
                >
                  {organ.category}
                </span>
                <span className="text-xs text-slate-400 font-mono italic">
                  {organ.latinName}
                </span>
              </div>
              <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight mt-0.5">
                {organ.name}
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors"
            title="Tutup (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Organ Selector Switcher */}
        <div className="px-4 sm:px-6 py-2.5 bg-slate-900/60 border-b border-slate-800 flex items-center space-x-2 overflow-x-auto scrollbar-none">
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider shrink-0 mr-1">
            Pilih Organ:
          </span>
          {ORGAN_EDUCATION_DATA.map((item) => {
            const isCurrent = item.id === organ.id;
            const ItemIcon = ICON_MAP[item.iconName] || Activity;
            return (
              <button
                key={item.id}
                onClick={() => handleSelectDifferentOrgan(item.id)}
                className={`inline-flex items-center space-x-1.5 px-3 py-1 rounded-xl text-xs font-medium whitespace-nowrap transition-all border ${
                  isCurrent
                    ? 'bg-slate-800 text-white border-slate-600 shadow-md font-semibold'
                    : 'bg-slate-950/60 text-slate-400 border-slate-800/60 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <ItemIcon 
                  className="w-3.5 h-3.5" 
                  style={{ color: isCurrent ? item.hexColor : undefined }} 
                />
                <span>{item.name.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>

        {/* Main Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* Summary Banner */}
          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800/90 text-sm leading-relaxed text-slate-200 flex items-start space-x-3">
            <Stethoscope className="w-5 h-5 shrink-0 text-emerald-400 mt-0.5" />
            <div>
              <span className="font-semibold text-white">Ikhtisar Fisiologis: </span>
              <span>{organ.summary}</span>
            </div>
          </div>

          {/* Navigation Sub-Tabs */}
          <div className="flex border-b border-slate-800 space-x-2">
            {[
              { id: 'mechanism', label: '1. Mekanisme Kerja Organ' },
              { id: 'nutrients', label: '2. Interaksi Nutrisi & Biokimia' },
              { id: 'formulas', label: '3. Persamaan AST & Referensi' },
              { id: 'quiz', label: '4. Kuis & Evaluasi Mandiri' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedTab(tab.id as any)}
                className={`pb-2.5 px-3 text-xs sm:text-sm font-semibold transition-colors border-b-2 relative ${
                  selectedTab === tab.id
                    ? 'border-emerald-500 text-emerald-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab 1: Mekanisme Kerja */}
          {selectedTab === 'mechanism' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">
                  Tahapan Mekanisme Kerja Fisiologis
                </h3>
                <span className="text-[11px] font-mono text-slate-400">
                  {organ.workingMechanism.length} Langkah Utama
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {organ.workingMechanism.map((mech) => (
                  <div 
                    key={mech.step}
                    className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700 transition-colors flex items-start space-x-3.5"
                  >
                    <div 
                      className="w-7 h-7 rounded-xl flex items-center justify-center font-mono font-bold text-xs shrink-0 shadow-sm"
                      style={{ 
                        backgroundColor: `${organ.hexColor}25`, 
                        color: organ.hexColor,
                        border: `1px solid ${organ.hexColor}40`
                      }}
                    >
                      {mech.step}
                    </div>
                    <div className="space-y-1 flex-1">
                      <h4 className="text-sm font-semibold text-white">
                        {mech.title}
                      </h4>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        {mech.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Clinical Impact Section */}
              <div className="mt-5 space-y-2.5">
                <h4 className="text-xs font-mono uppercase tracking-wider text-slate-400">
                  Dampak Klinis & Kasus Nutrisi Terkait
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {organ.clinicalImpact.map((item, idx) => (
                    <div 
                      key={idx}
                      className="p-3.5 rounded-xl bg-slate-900/40 border border-slate-800/60 text-xs space-y-1"
                    >
                      <div className="font-semibold text-amber-400 flex items-center space-x-1.5">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{item.condition}</span>
                      </div>
                      <p className="text-slate-300 leading-relaxed text-[11px]">
                        {item.nutritionRelevance}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Interaksi Nutrisi */}
          {selectedTab === 'nutrients' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">
                  Jalur Interaksi Makronutrien & Mikronutrien
                </h3>
                <span className="text-[11px] font-mono text-slate-400">
                  Homeostasis Biokimia
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3.5">
                {organ.nutrientInteractions.map((nut, idx) => (
                  <div 
                    key={idx}
                    className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-400 font-mono">
                        {nut.nutrient}
                      </span>
                      <span className="text-[10px] font-mono uppercase bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
                        {nut.role}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {nut.mechanism}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab 3: Persamaan Ilmiah & Referensi */}
          {selectedTab === 'formulas' && (
            <div className="space-y-5">
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-white">
                  Persamaan AST Terdaftar pada Platform
                </h3>
                <p className="text-xs text-slate-400">
                  Rumus deterministik yang digunakan oleh mesin NutriBodySim untuk memodelkan organ ini.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  {organ.relatedAstFormulas.map((form) => (
                    <div 
                      key={form.id}
                      className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-emerald-500/50 transition-all flex flex-col justify-between space-y-3"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/40">
                            ID: {form.id}
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-white">
                          {form.name}
                        </h4>
                        <div className="mt-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800/90 font-mono text-xs text-emerald-300 overflow-x-auto">
                          {form.equation}
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          onNavigate(form.tab);
                          onClose();
                        }}
                        className="w-full inline-flex items-center justify-center space-x-1.5 py-2 px-3 rounded-xl bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white text-xs font-semibold transition-colors"
                      >
                        <span>Buka di {form.tab === 'calculator' ? 'Kalkulator AST' : 'Registri Ilmiah'}</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Primary Textbook Citation */}
              <div className="p-4 rounded-2xl bg-slate-900/50 border border-slate-800 space-y-2">
                <div className="flex items-center space-x-2 text-xs font-bold text-slate-300">
                  <BookOpen className="w-4 h-4 text-emerald-400" />
                  <span>Sitasi Buku Teks Rujukan Utama</span>
                </div>
                <div className="text-xs text-white font-semibold">
                  {organ.textbookCitation.source}
                </div>
                <div className="text-xs text-slate-400 font-mono">
                  {organ.textbookCitation.chapter} • {organ.textbookCitation.pages}
                </div>
                <p className="text-xs text-slate-300 pt-1 border-t border-slate-800 leading-relaxed">
                  {organ.textbookCitation.summary}
                </p>
              </div>
            </div>
          )}

          {/* Tab 4: Kuis Mandiri */}
          {selectedTab === 'quiz' && (
            <div className="space-y-4">
              <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono uppercase bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-bold border border-emerald-500/30">
                    Evaluasi Pemahaman
                  </span>
                  <button
                    onClick={resetQuiz}
                    className="text-xs text-slate-400 hover:text-white"
                  >
                    Ulang Pertanyaan
                  </button>
                </div>

                <h3 className="text-sm sm:text-base font-bold text-white leading-relaxed">
                  {organ.quickCheck.question}
                </h3>

                <div className="space-y-2 pt-2">
                  {organ.quickCheck.options.map((option, idx) => {
                    const isSelected = quizAnswer === idx;
                    const isCorrect = idx === organ.quickCheck.correctIndex;
                    let btnStyle = 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700';

                    if (isAnswerSubmitted) {
                      if (isCorrect) {
                        btnStyle = 'bg-emerald-950/60 border-emerald-500 text-emerald-200 font-semibold';
                      } else if (isSelected && !isCorrect) {
                        btnStyle = 'bg-red-950/60 border-red-500 text-red-200';
                      } else {
                        btnStyle = 'bg-slate-950/40 border-slate-900 text-slate-500';
                      }
                    }

                    return (
                      <button
                        key={idx}
                        onClick={() => handleOptionClick(idx)}
                        disabled={isAnswerSubmitted}
                        className={`w-full text-left p-3.5 rounded-xl border text-xs sm:text-sm transition-all flex items-start space-x-3 ${btnStyle}`}
                      >
                        <span className="font-mono text-xs opacity-60 mt-0.5">
                          {String.fromCharCode(65 + idx)}.
                        </span>
                        <span className="flex-1 leading-snug">{option}</span>
                        {isAnswerSubmitted && isCorrect && (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Explanation feedback */}
                {isAnswerSubmitted && (
                  <div className={`p-4 rounded-xl text-xs leading-relaxed border animate-in fade-in duration-200 ${
                    quizAnswer === organ.quickCheck.correctIndex
                      ? 'bg-emerald-950/40 border-emerald-600/50 text-emerald-200'
                      : 'bg-amber-950/40 border-amber-600/50 text-amber-200'
                  }`}>
                    <div className="font-bold mb-1 flex items-center space-x-1.5">
                      {quizAnswer === organ.quickCheck.correctIndex ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span>Jawaban Tepat!</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-4 h-4 text-amber-400" />
                          <span>Penjelasan Ilmiah:</span>
                        </>
                      )}
                    </div>
                    <p>{organ.quickCheck.explanation}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-slate-800/80 bg-slate-950 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-slate-400 flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Materi berbasis kurikulum Fisiologi Kedokteran & Dietetika Klinis</span>
          </div>

          <div className="flex items-center space-x-2.5 w-full sm:w-auto">
            <button
              onClick={() => {
                onNavigate('calculator');
                onClose();
              }}
              className="flex-1 sm:flex-none inline-flex items-center justify-center space-x-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-900/30 transition-colors"
            >
              <Calculator className="w-3.5 h-3.5" />
              <span>Simulasikan di Kalkulator AST</span>
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
