import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import draftsRouter from './routes/drafts';
import analysisRouter from './routes/analysis';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'dontsuckatfantasydrafts' });
});


app.use('/api/drafts', draftsRouter);
app.use('/api/analysis', analysisRouter);

app.listen(PORT, () => {
  console.log(`DontSuckAtFantasyDrafts server running on http://localhost:${PORT}`);
});


export default app;
