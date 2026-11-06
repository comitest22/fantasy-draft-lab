import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import ImportPage from './pages/ImportPage';
import InsightsPage from './pages/InsightsPage';
import LearningsPage from './pages/LearningsPage';
import TakeawaysPage from './pages/TakeawaysPage';
import SeasonDetailPage from './pages/SeasonDetailPage';
import SeasonsPage from './pages/SeasonsPage';
import SosPage from './pages/SosPage';
import StrategyHubPage from './pages/StrategyHubPage';
import StrategyPage from './pages/StrategyPage';
import SurvivorPage from './pages/SurvivorPage';
import TdStreakPage from './pages/TdStreakPage';
import ToolsPage from './pages/ToolsPage';
import CheatSheetsPage from './pages/CheatSheetsPage';
import TrendsPage from './pages/TrendsPage';
import MyTeamPage from './pages/MyTeamPage';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="seasons" element={<SeasonsPage />} />
          <Route path="tools" element={<ToolsPage />} />
          <Route path="tools/sos" element={<SosPage />} />
          <Route path="tools/cheatsheet" element={<CheatSheetsPage />} />
          <Route path="tools/trends" element={<TrendsPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="season/:season" element={<SeasonDetailPage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="insights/learnings" element={<LearningsPage />} />
          <Route path="insights/takeaways" element={<TakeawaysPage />} />
          <Route path="trends" element={<Navigate to="/tools/trends" replace />} />
          <Route path="strategy" element={<StrategyHubPage />} />
          <Route path="strategy/draft" element={<StrategyPage />} />
          <Route path="strategy/survivor" element={<SurvivorPage mode="win" />} />
          <Route path="strategy/survivor-loser" element={<SurvivorPage mode="lose" />} />
          <Route path="strategy/td-streak" element={<TdStreakPage />} />
          <Route path="my-team" element={<MyTeamPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
