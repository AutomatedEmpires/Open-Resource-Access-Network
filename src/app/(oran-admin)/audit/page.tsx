export default function AuditPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Audit Log</h1>
      <p className="text-gray-500 mb-6">Full system audit trail for all write operations.</p>
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
        <p>Audit log — ORAN admin access required.</p>
      </div>
    </main>
  );
}
