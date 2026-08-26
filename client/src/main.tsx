import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import ImportPage from './pages/ImportPage';
import SeasonDetailPage from './pages/SeasonDetailPage';
import SeasonsPage from './pages/SeasonsPage';
import StrategyPage from './pages/StrategyPage';
import TrendsPage from './pages/TrendsPage';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<SeasonsPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="season/:season" element={<SeasonDetailPage />} />
          <Route path="trends" element={<TrendsPage />} />
          <Route path="strategy" element={<StrategyPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
