import React from 'react';
import { FileText, CheckCircle2, AlertTriangle, ShieldCheck, ArrowRight, Code2 } from 'lucide-react';

export const ScientificContributionGuideView: React.FC = () => {
  const steps = [
    {
      step: '1. Define Variables',
      desc: 'Declare biological variables with exact SI units, measurement types (mass, length, energy), and biologically plausible numeric ranges.',
      snippet: `{
  "variable_id": "VAR_LEAN_MASS",
  "name": "Lean Body Mass",
  "unit": "kg",
  "measurement_type": "mass",
  "allowed_range": { "min": 20, "max": 200 }
}`
    },
    {
      step: '2. Define Parameters',
      desc: 'Register empirical coefficients, thermal factors, or physiological exponents with defaults and validation boundaries.',
      snippet: `{
  "parameter_id": "PARAM_TEF_FACTOR",
  "name": "Dietary Thermogenesis Coefficient",
  "value": 0.10,
  "unit": "ratio",
  "valid_range": { "min": 0.05, "max": 0.25 }
}`
    },
    {
      step: '3. Construct Formula AST',
      desc: 'Formulas are represented as parsed AST expression trees, not embedded JavaScript/TypeScript template strings.',
      snippet: `{
  "type": "binary_op",
  "operator": "*",
  "left": { "type": "variable", "name": "VAR_LEAN_MASS" },
  "right": { "type": "constant", "value": 21.6 }
}`
    },
    {
      step: '4. Register Academic Citations',
      desc: 'Every formula requires a primary scientific reference with authors, journal, year, and persistent DOI.',
      snippet: `{
  "citation_key": "Cunningham1991",
  "title": "Body composition as a determinant of energy expenditure",
  "authors": ["Cunningham, J.J."],
  "journal": "Am J Clin Nutr",
  "year": 1991,
  "doi": "10.1093/ajcn/54.6.963"
}`
    },
    {
      step: '5. Scientific Peer Review Workflow',
      desc: 'Follow the lifecycle: DRAFT → UNDER_REVIEW → VALIDATED → VERIFIED. Experimental alterations remain strictly in cloned branches.',
      snippet: `// Lifecycle:
// 1. Contributor submits as DRAFT
// 2. Peer Reviewer moves to UNDER_REVIEW
// 3. Automated AST testing certifies VALIDATED
// 4. Board of Researchers seals as VERIFIED`
    }
  ];

  const architecturalChecklist = [
    { rule: 'Are formulas hardcoded in UI components?', status: 'VIOLATION (Forbidden)', pass: false },
    { rule: 'Are units hardcoded without normalizer conversion?', status: 'VIOLATION (Forbidden)', pass: false },
    { rule: 'Are parameters hardcoded without registry overrides?', status: 'VIOLATION (Forbidden)', pass: false },
    { rule: 'Is calculation logic outside calculationEngine.ts?', status: 'VIOLATION (Forbidden)', pass: false },
    { rule: 'Does calculation produce full step-by-step trace?', status: 'MANDATORY (Enforced)', pass: true },
    { rule: 'Does operation generate SHA-256 provenance hash?', status: 'MANDATORY (Enforced)', pass: true },
    { rule: 'Is raw dataset permanently locked (v1.0 RAW)?', status: 'MANDATORY (Enforced)', pass: true },
    { rule: 'Does experiment clone rather than mutate baseline?', status: 'MANDATORY (Enforced)', pass: true }
  ];

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="border-b border-slate-200 pb-4">
        <div className="flex items-center space-x-2">
          <FileText className="w-5 h-5 text-slate-700" />
          <h1 className="text-lg font-bold text-slate-900">
            Scientific Contribution & Architecture Guide
          </h1>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          Standard operating procedure for researchers, biostatisticians, and developers adding new physiological modules (Sections 60 & 61).
        </p>
      </div>

      {/* Strict Separation Mandate */}
      <div className="p-4 bg-slate-900 text-white rounded-xl space-y-2 text-xs">
        <div className="flex items-center space-x-2 text-emerald-400 font-mono font-bold uppercase tracking-wider">
          <ShieldCheck className="w-4 h-4" />
          <span>Core Architectural Mandate (Section 2 & 61)</span>
        </div>
        <p className="text-slate-300 leading-relaxed">
          The NutriBodySim platform strictly decouples the <strong>Computational Engine</strong> from <strong>Scientific Content</strong>. 
          React components never contain mathematical formulas, biological coefficients, or unit conversions.
          All calculations are dispatched to the AST Evaluation Engine and verified through cryptographic provenance traces.
        </p>
      </div>

      {/* Checklist Table (Section 61) */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden text-xs">
        <div className="p-3 bg-slate-50 border-b border-slate-200 font-mono font-semibold text-slate-700 uppercase">
          Section 61 Compliance & Validation Checklist
        </div>
        <div className="divide-y divide-slate-100">
          {architecturalChecklist.map((item, idx) => (
            <div key={idx} className="p-3 flex items-center justify-between">
              <span className="text-slate-800 font-medium">{item.rule}</span>
              <span className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] ${
                item.pass ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
              }`}>
                {item.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Step by Step Workflow (Section 60) */}
      <div className="space-y-4">
        <div className="text-xs font-mono font-semibold text-slate-500 uppercase tracking-wider">
          Contribution Steps for Scientific Authors (Section 60)
        </div>

        <div className="space-y-4">
          {steps.map((st, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 space-y-2 text-xs">
              <div className="font-bold text-slate-900 text-sm">{st.step}</div>
              <p className="text-slate-600 leading-relaxed">{st.desc}</p>
              <div className="bg-slate-950 text-emerald-400 font-mono text-[11px] p-3 rounded-lg overflow-x-auto">
                <pre>{st.snippet}</pre>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
