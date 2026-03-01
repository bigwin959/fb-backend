import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
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


if (process.env.MONGODB_URI) {
    mongoose.connect(process.env.MONGODB_URI)
        .then(() => console.log('[DATABASE] Connected to MongoDB.'))
        .catch(err => console.error('[DATABASE] MongoDB connection error:', err));
}

const reportSchema = new mongoose.Schema({
    identifier: { type: String, default: 'main_report', unique: true },
    rows: [mongoose.Schema.Types.Mixed],
    columns: [mongoose.Schema.Types.Mixed],
    title: String,
    totalLabel: String
});
const Report = mongoose.model('Report', reportSchema);

const inputHistorySchema = new mongoose.Schema({
    text: String,
    date: { type: Date, default: Date.now } // automatically save the current date
});
const InputHistory = mongoose.model('InputHistory', inputHistorySchema);

// Database files for fallback
const DB_FILE = path.resolve('data', 'daily_summary.json');
const HISTORY_FILE = path.resolve('data', 'input_history.json');

// --- Input History APIs ---
app.get('/api/inputs', async (req, res) => {
    try {
        if (process.env.MONGODB_URI) {
            const history = await InputHistory.find().sort({ date: -1 }).limit(50);
            res.json({ success: true, history: history.map(h => ({ id: h._id, text: h.text, date: h.date })) });
        } else {
            if (!fs.existsSync(path.resolve('data'))) fs.mkdirSync(path.resolve('data'));
            if (!fs.existsSync(HISTORY_FILE)) return res.json({ success: true, history: [] });
            res.json({ success: true, history: JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')) });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/inputs', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text || !text.trim()) return res.json({ success: false, error: 'Empty text' });

        if (process.env.MONGODB_URI) {
            const newItem = new InputHistory({ text });
            await newItem.save();
            res.json({ success: true, item: { id: newItem._id, text: newItem.text, date: newItem.date } });
        } else {
            if (!fs.existsSync(path.resolve('data'))) fs.mkdirSync(path.resolve('data'));
            let history = [];
            if (fs.existsSync(HISTORY_FILE)) history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
            const newItem = { id: Date.now().toString(), text, date: new Date().toISOString() };
            history.unshift(newItem);
            if (history.length > 50) history = history.slice(0, 50);
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
            res.json({ success: true, item: newItem });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/inputs/:id', async (req, res) => {
    try {
        if (process.env.MONGODB_URI) {
            await InputHistory.findByIdAndDelete(req.params.id);
            res.json({ success: true });
        } else {
            if (fs.existsSync(HISTORY_FILE)) {
                let history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
                history = history.filter(h => h.id !== req.params.id);
                fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
            }
            res.json({ success: true });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});



// API: Setup Database for Report
app.get('/api/report', async (req, res) => {
    try {
        if (process.env.MONGODB_URI) {
            const report = await Report.findOne({ identifier: 'main_report' });
            if (!report) {
                return res.json({ success: true, data: { rows: [], columns: [{ id: 'col1', header: 'Date' }, { id: 'col2', header: 'Win/Lose' }], title: 'Currency ( Input )', totalLabel: '總' } });
            }
            res.json({ success: true, data: { rows: report.rows, columns: report.columns, title: report.title, totalLabel: report.totalLabel } });
        } else {
            if (!fs.existsSync(path.resolve('data'))) fs.mkdirSync(path.resolve('data'));
            if (!fs.existsSync(DB_FILE)) {
                return res.json({ success: true, data: { rows: [], columns: [{ id: 'col1', header: 'Date' }, { id: 'col2', header: 'Win/Lose' }], title: 'Currency ( Input )', totalLabel: '總' } });
            }
            res.json({ success: true, data: JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/report', async (req, res) => {
    try {
        if (process.env.MONGODB_URI) {
            await Report.findOneAndUpdate(
                { identifier: 'main_report' },
                {
                    identifier: 'main_report',
                    rows: req.body.rows || [],
                    columns: req.body.columns || [],
                    title: req.body.title || '',
                    totalLabel: req.body.totalLabel || ''
                },
                { upsert: true, new: true }
            );
            res.json({ success: true });
        } else {
            if (!fs.existsSync(path.resolve('data'))) fs.mkdirSync(path.resolve('data'));
            fs.writeFileSync(DB_FILE, JSON.stringify(req.body, null, 2));
            res.json({ success: true });
        }
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

