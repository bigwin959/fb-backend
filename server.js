import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { launchBrowser, executeScrape, closeBrowser } from './services/scraperService.js';
import { fetchRankings } from './services/rankingService.js';
import { fetchMatchResults } from './services/resultService.js';
import fs from 'fs';
import path from 'path';


const app = express();
let PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Backend is running' });
});

// API: Launch Browser
app.post('/api/launch-scraper', async (req, res) => {
    try {
        const result = await launchBrowser();
        res.json({ success: true, message: result.message });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: Execute Scrape
app.post('/api/execute-scrape', async (req, res) => {
    try {
        const matches = await executeScrape();
        res.json({ success: true, matches });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: Close Browser (Optional)
app.post('/api/close-scraper', async (req, res) => {
    try {
        await closeBrowser();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: Fetch Rankings
app.post('/api/fetch-rankings', async (req, res) => {
    try {
        const mode = req.body?.mode || 'major';
        const rankings = await fetchRankings(mode);
        res.json({ success: true, rankings, mode });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: Fetch Results
app.post('/api/fetch-results', async (req, res) => {
    try {
        const { dates } = req.body;
        const results = await fetchMatchResults(dates);
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Database file for the report
const DB_FILE = path.resolve('data', 'daily_summary.json');

// API: Setup Database for Report
app.get('/api/report', (req, res) => {
    try {
        if (!fs.existsSync(path.resolve('data'))) fs.mkdirSync(path.resolve('data'));
        if (!fs.existsSync(DB_FILE)) {
            return res.json({ success: true, data: { rows: [], columns: [{ id: 'col1', header: 'Date' }, { id: 'col2', header: 'Win/Lose' }], title: 'Currency ( Input )', totalLabel: '總' } });
        }
        res.json({ success: true, data: JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/report', (req, res) => {
    try {
        if (!fs.existsSync(path.resolve('data'))) fs.mkdirSync(path.resolve('data'));
        fs.writeFileSync(DB_FILE, JSON.stringify(req.body, null, 2));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


const startServer = (port) => {
    const server = app.listen(port, '0.0.0.0', () => {
        console.log(`[BACKEND] Server starting on port ${port}...`);
        console.log(`[BACKEND] URL: http://localhost:${port}`);
        console.log('[BACKEND] Ready to accept scraping requests.');
    });

    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
            console.log(`[BACKEND] Port ${port} is in use, trying ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error('[BACKEND] Server Error:', error);
            process.exit(1);
        }
    });
};

startServer(PORT);

// Keep process alive
process.on('uncaughtException', (err) => {
    console.error('[BACKEND] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[BACKEND] Unhandled Rejection at:', promise, 'reason:', reason);
});

