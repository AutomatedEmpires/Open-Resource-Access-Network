export default function ProfilePage() {
  return (
    <main className="container mx-auto max-w-lg px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">My Profile</h1>
      <p className="text-gray-500 mb-6">
        Manage your preferences. Location data is approximate only.
        Profile saving requires explicit consent.
      </p>
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
        <p>Sign in to manage your profile and preferences.</p>
      </div>
    </main>
  );
}
