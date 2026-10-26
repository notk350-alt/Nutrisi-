import React, { useState, useEffect } from 'react';
import { api } from '../../api';
import { User, ScientificFormula } from '../../types';
import { 
  Code2, 
  Play, 
  Terminal, 
  FileCode, 
  Copy, 
  Check, 
  RotateCcw, 
  Sparkles,
  ArrowRight,
  Database
} from 'lucide-react';

interface CodeLabViewProps {
  currentUser: User;
}

export const CodeLabView: React.FC<CodeLabViewProps> = ({ currentUser }) => {
  const [language, setLanguage] = useState<'python' | 'r' | 'sql' | 'javascript'>('python');
  const [code, setCode] = useState<string>('');
  const [executionOutput, setExecutionOutput] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // GUI-to-Code Bridge Generator (Section 43)
  const [bridgeFormulaId, setBridgeFormulaId] = useState('FORMULA_BMI_KEYES');
  const [generatedBridge, setGeneratedBridge] = useState<{ python: string; r: string } | null>(null);
  const [generatingBridge, setGeneratingBridge] = useState(false);
  const [formulas, setFormulas] = useState<ScientificFormula[]>([]);

  const sampleTemplates: Record<string, string> = {
    python: `# NutriBodySim Python Scientific Compute Script
import numpy as np
import pandas as pd

# Load dataset and calculate Energy Expenditure (Mifflin-St Jeor)
weight_kg = 75.0
stature_cm = 178.0
age_years = 28
sex = "Male"

# Mifflin-St Jeor Equation (Validated AST representation)
# BMR = (10 * weight) + (6.25 * height) - (5 * age) + 5
bmr = (10.0 * weight_kg) + (6.25 * stature_cm) - (5.0 * age_years) + (5 if sex == "Male" else -161)

print(f"[NutriBodySim Engine] Evaluated BMR: {bmr:.2f} kcal/day")
print(f"Normative Energy Turnover: {bmr * 1.35:.2f} kcal/day (Light activity factor)")
`,
    r: `# NutriBodySim Reproducible R Script
library(stats)

# Bioenergetics Model Evaluation
cohort_weights <- c(68.5, 74.2, 82.0, 61.3, 70.0, 77.4)
cohort_statures <- c(172, 178, 182, 165, 170, 175)

# Calculate BMI in R
bmis <- cohort_weights / ((cohort_statures / 100)^2)

cat("[NutriBodySim R-Bridge] Evaluated Cohort BMI Values:\\n")
print(bmis)
cat("Mean BMI:", mean(bmis), "SD:", sd(bmis), "\\n")
`,
    sql: `-- Query Cohort Data from NutriBodySim SQL Schema
SELECT 
    subject_id,
    weight_kg,
    stature_cm,
    ROUND(weight_kg / POWER(stature_cm / 100.0, 2), 2) AS calculated_bmi,
    CASE 
        WHEN (weight_kg / POWER(stature_cm / 100.0, 2)) < 18.5 THEN 'Underweight'
        WHEN (weight_kg / POWER(stature_cm / 100.0, 2)) < 25.0 THEN 'Normative'
        ELSE 'Overweight'
    END AS clinical_category
FROM cohort_measurements
ORDER BY weight_kg DESC;
`,
    javascript: `// NutriBodySim Structured Mathematical Calculation (Safe Math Mode)
// Evaluates verified mathematical formulas deterministically with zero dynamic code execution
// Example: Body Mass Index (BMI = weight_kg / (stature_m ^ 2))
weight_kg / (stature_m ^ 2)
`
  };

  useEffect(() => {
    setCode(sampleTemplates.python);
    api.getFormulas().then(res => {
      setFormulas(res.formulas);
    }).catch(err => console.error(err));
  }, []);

  const handleLanguageChange = (lang: any) => {
    setLanguage(lang);
    setCode(sampleTemplates[lang] || '');
    setExecutionOutput(null);
  };

  const handleExecuteCode = async () => {
    setRunning(true);
    try {
      const res = await api.executeCode({
        language,
        code
      });
      const result = res.result || {};
      setExecutionOutput({
        status: result.status || (result.error ? 'error' : 'success'),
        stdout: result.stdout || result.output || '',
        stderr: result.stderr || result.error || '',
        execution_time_ms: result.execution_time_ms ?? 0
      });
    } catch (err: any) {
      setExecutionOutput({
        status: 'error',
        stdout: '',
        stderr: err?.message || 'Execution error occurred',
        execution_time_ms: 0
      });
    } finally {
      setRunning(false);
    }
  };

  const handleGenerateBridgeCode = async () => {
    setGeneratingBridge(true);
    try {
      const res = await api.generateCodeFromGUI({
        operation: 'CALCULATE_FORMULA',
        target_formula_id: bridgeFormulaId
      });
      setGeneratedBridge(res);
    } catch (err: any) {
      alert(`Bridge code error: ${err.message}`);
    } finally {
      setGeneratingBridge(false);
    }
  };

  const handleCopyCode = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <Code2 className="w-5 h-5 text-slate-700" />
            <h1 className="text-lg font-bold text-slate-900">Code Lab & GUI-to-Code Translation Bridge</h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Every analytical action performed in the UI translates into transparent Python, R, and SQL scripts for independent scientific replication (Section 43).
          </p>
        </div>

        <button
          onClick={() => handleCopyCode(code)}
          className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 bg-white text-xs font-semibold hover:bg-slate-50"
        >
          {copiedCode ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
          <span>{copiedCode ? 'Copied' : 'Copy Script'}</span>
        </button>
      </div>

      {/* GUI-to-Code Translation Section (Section 43) */}
      <div className="bg-slate-900 text-white p-4 rounded-xl space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-xs uppercase tracking-wider text-emerald-400 font-mono">
              GUI-to-Code Translation Bridge (Section 43)
            </span>
          </div>
          <span className="text-[10px] font-mono text-slate-400">
            Export UI Operations to Python / R Standalone Scripts
          </span>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="flex-1 w-full">
            <label className="text-[11px] font-mono text-slate-400 block mb-1">
              Select UI Target Formula to Bridge:
            </label>
            <select
              value={bridgeFormulaId}
              onChange={e => setBridgeFormulaId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-lg text-xs font-mono text-white focus:outline-none"
            >
              {formulas.map(f => (
                <option key={f.formula_id} value={f.formula_id}>
                  {f.name} ({f.formula_id})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleGenerateBridgeCode}
            disabled={generatingBridge}
            className="w-full sm:w-auto mt-4 sm:mt-0 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition-colors flex items-center justify-center space-x-1.5"
          >
            <span>{generatingBridge ? 'Generating...' : 'Translate to Python & R'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Generated Bridge Display */}
        {generatedBridge && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div className="p-3 bg-slate-800 rounded-lg border border-slate-700 space-y-2">
              <div className="flex justify-between items-center text-[11px] font-mono">
                <span className="text-emerald-400 font-bold">Standalone Python Script</span>
                <button
                  onClick={() => {
                    setCode(generatedBridge.python);
                    setLanguage('python');
                  }}
                  className="text-xs text-blue-400 hover:underline"
                >
                  Load in Editor
                </button>
              </div>
              <pre className="text-[11px] font-mono text-slate-300 overflow-x-auto p-2 bg-slate-950 rounded max-h-40">
                {generatedBridge.python}
              </pre>
            </div>

            <div className="p-3 bg-slate-800 rounded-lg border border-slate-700 space-y-2">
              <div className="flex justify-between items-center text-[11px] font-mono">
                <span className="text-blue-400 font-bold">Standalone R Script</span>
                <button
                  onClick={() => {
                    setCode(generatedBridge.r);
                    setLanguage('r');
                  }}
                  className="text-xs text-blue-400 hover:underline"
                >
                  Load in Editor
                </button>
              </div>
              <pre className="text-[11px] font-mono text-slate-300 overflow-x-auto p-2 bg-slate-950 rounded max-h-40">
                {generatedBridge.r}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Multi-Language Code Editor Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Editor Window */}
        <div className="lg:col-span-7 space-y-3">
          <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden shadow-xs">
            {/* Tab Bar */}
            <div className="bg-slate-950 px-4 py-2 flex items-center justify-between border-b border-slate-800">
              <div className="flex space-x-2">
                {[
                  { id: 'python', label: 'Python (NumPy / SciPy)' },
                  { id: 'r', label: 'R (Tidyverse / Stats)' },
                  { id: 'sql', label: 'SQL (Cohort DB)' },
                  { id: 'javascript', label: 'JS (AST Engine)' }
                ].map(l => (
                  <button
                    key={l.id}
                    onClick={() => handleLanguageChange(l.id)}
                    className={`px-3 py-1 rounded text-xs font-mono font-medium transition-colors cursor-pointer ${
                      language === l.id
                        ? 'bg-slate-800 text-white font-bold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>

              <button
                onClick={handleExecuteCode}
                disabled={running}
                className="inline-flex items-center space-x-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded cursor-pointer transition-colors disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5 fill-white" />
                <span>{running ? 'Running...' : 'Run Script'}</span>
              </button>
            </div>

            {/* Code Textarea */}
            <textarea
              rows={16}
              value={code}
              onChange={e => setCode(e.target.value)}
              className="w-full bg-slate-900 text-slate-100 font-mono text-xs p-4 focus:outline-none resize-none leading-relaxed"
              spellCheck={false}
            />
          </div>
        </div>

        {/* Terminal Stdout / Stderr Panel */}
        <div className="lg:col-span-5 space-y-3">
          <div className="bg-slate-950 rounded-xl border border-slate-800 h-full flex flex-col min-h-[350px]">
            <div className="bg-slate-900 px-3 py-2 flex items-center justify-between border-b border-slate-800 text-xs font-mono text-slate-400">
              <div className="flex items-center space-x-2">
                <Terminal className="w-3.5 h-3.5 text-slate-400" />
                <span>Sandboxed Execution Console</span>
              </div>
              {executionOutput && (
                <span className="text-emerald-400 text-[10px]">
                  {executionOutput.execution_time_ms} ms
                </span>
              )}
            </div>

            <div className="p-4 font-mono text-xs text-slate-300 flex-1 overflow-y-auto whitespace-pre-wrap">
              {executionOutput ? (
                <div className="space-y-2">
                  <div className="text-slate-500 text-[10px]">
                    --- Execution Terminated with Status: {String(executionOutput.status || (executionOutput.stderr ? 'error' : 'success')).toUpperCase()} ---
                  </div>
                  {(executionOutput.stdout || executionOutput.output) && (
                    <div className="text-emerald-300 font-mono">
                      {executionOutput.stdout || executionOutput.output}
                    </div>
                  )}
                  {(executionOutput.stderr || executionOutput.error) && (
                    <div className="text-red-400 font-mono">
                      {executionOutput.stderr || executionOutput.error}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-slate-600 text-center pt-20">
                  Click <strong>"Run Script"</strong> to execute code in the container runtime environment.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
