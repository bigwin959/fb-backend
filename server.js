import express from 'express';
import cors from 'cors';
import { scrapeOdds } from './services/scraperService.js';
import { fetchRankings } from './services/rankingService.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Backend is running' });
});

// API: Scrape Odds
app.post('/api/scrape-odds', async (req, res) => {
    try {
        const matches = await scrapeOdds();
        res.json({ success: true, matches });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: Fetch Rankings
app.post('/api/fetch-rankings', async (req, res) => {
    try {
        const rankings = await fetchRankings();
        res.json({ success: true, rankings });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Ready to accept scraping requests.');
});
