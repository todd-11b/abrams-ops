import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import ConsultPage from './pages/consult/ConsultPage';
import ProposalPage from './pages/proposal/ProposalPage';
import ProductionDashboard from './pages/production/ProductionDashboard';
import ProductionJob from './pages/production/ProductionJob';

function Home() {
  return (
    <div className="min-h-screen bg-white p-8">
      <h1 className="text-3xl font-semibold text-primary mb-2">Abrams Fence Ops</h1>
      <p className="text-gray-600 mb-8">Internal operations app</p>
      <nav className="flex flex-col gap-2">
        <Link to="/consult" className="text-primary underline">Consult</Link>
        <Link to="/production" className="text-primary underline">Production dashboard</Link>
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/consult" element={<ConsultPage />} />
        <Route path="/proposal/:contactId" element={<ProposalPage />} />
        <Route path="/production" element={<ProductionDashboard />} />
        <Route path="/production/job/:jobId" element={<ProductionJob />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
