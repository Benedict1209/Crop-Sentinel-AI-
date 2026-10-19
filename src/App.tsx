import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { bootstrap, useStore } from './lib/store';
import { Dashboard } from './pages/Dashboard';
import { OfficerDashboard } from './pages/OfficerDashboard';
import { Scanner } from './pages/Scanner';
import { Traps } from './pages/Traps';
import { RiskForecast } from './pages/RiskForecast';
import { HotspotMapPage } from './pages/HotspotMap';
import { Advisories } from './pages/Advisories';
import { Farms } from './pages/Farms';
import { FarmDetail } from './pages/FarmDetail';
import { PlotDetail } from './pages/PlotDetail';
import { Reports } from './pages/Reports';
import { ReportDetail } from './pages/ReportDetail';
import { ExpertReview } from './pages/ExpertReview';
import { FeedbackDataset } from './pages/FeedbackDataset';
import { Settings } from './pages/Settings';

export default function App() {
  const seeded = useStore((s) => s.seeded);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bootstrap().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) {
    return (
      <div style={{ padding: 40, fontFamily: 'Inter, system-ui, sans-serif' }}>
        <h1>CropSentinel AI could not start</h1>
        <p>{error}</p>
      </div>
    );
  }

  if (!seeded) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 640, fontSize: 18 }}>CropSentinel AI</div>
          <div style={{ color: '#6b746d', fontSize: 13, marginTop: 6 }}>
            Loading the demonstration dataset and running the screening engine…
          </div>
        </div>
      </div>
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/officer" element={<OfficerDashboard />} />
          <Route path="/scanner" element={<Scanner />} />
          <Route path="/traps" element={<Traps />} />
          <Route path="/risk" element={<RiskForecast />} />
          <Route path="/map" element={<HotspotMapPage />} />
          <Route path="/advisories" element={<Advisories />} />
          <Route path="/farms" element={<Farms />} />
          <Route path="/farms/:farmId" element={<FarmDetail />} />
          <Route path="/plots/:plotId" element={<PlotDetail />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/report/:scanId" element={<ReportDetail />} />
          <Route path="/expert" element={<ExpertReview />} />
          <Route path="/feedback" element={<FeedbackDataset />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
