import { MapContainer } from '@/components/map/MapContainer';

export default function MapPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Service Map</h1>
      <MapContainer className="w-full h-[70vh]" />
    </main>
  );
}
