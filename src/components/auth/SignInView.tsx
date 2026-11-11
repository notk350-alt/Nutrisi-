import { LogIn } from 'lucide-react';

interface SignInViewProps {
  busy: boolean;
  error: string | null;
  isDevelopment: boolean;
  onGoogleSignIn(): void;
  onDemoSignIn(): void;
}

export function SignInView({
  busy,
  error,
  isDevelopment,
  onGoogleSignIn,
  onDemoSignIn
}: SignInViewProps) {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6 py-12">
      <section className="w-full max-w-sm">
        <div className="mb-12 border-l-2 border-emerald-400 pl-4">
          <p className="text-sm font-semibold tracking-wide text-emerald-300">NutriBodySim</p>
          <h1 className="mt-3 text-3xl font-semibold">Masuk</h1>
        </div>

        <button
          type="button"
          onClick={onGoogleSignIn}
          disabled={busy}
          className="flex w-full items-center justify-between border border-slate-600 bg-slate-100 px-4 py-3 text-left font-medium text-slate-950 transition hover:bg-white disabled:cursor-wait disabled:opacity-60"
        >
          <span>Lanjutkan dengan Google</span>
          <LogIn size={18} aria-hidden="true" />
        </button>

        {isDevelopment && (
          <button
            type="button"
            onClick={onDemoSignIn}
            disabled={busy}
            className="mt-3 flex w-full items-center justify-between border border-slate-700 px-4 py-3 text-left text-slate-200 transition hover:bg-slate-900 disabled:cursor-wait disabled:opacity-60"
          >
            <span>Gunakan akun demo pengembangan</span>
            <LogIn size={18} aria-hidden="true" />
          </button>
        )}

        {error && (
          <p role="alert" className="mt-5 border-l-2 border-rose-400 pl-3 text-sm text-rose-200">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}