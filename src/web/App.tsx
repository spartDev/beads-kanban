import { useQuery } from '@tanstack/react-query';

async function fetchHealth(): Promise<{ status: string }> {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<{ status: string }>;
}

export function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth });

  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 px-4 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">beads-desktop</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Serveur : {health.isPending ? '…' : health.isError ? 'injoignable' : health.data.status}
        </p>
      </div>
    </main>
  );
}
