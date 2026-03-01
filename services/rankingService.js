import puppeteer from 'puppeteer';
import { TEAM_COUNTRY_MAP } from '../../constants.js'; // Adjust path as needed

/**
 * FotMob League Metadata – includes domestic leagues and UEFA competitions.
 */
const LEAGUE_DETAILS = {
    47: { country: '英格兰', name: 'Premier League', isDomestic: true },
    87: { country: '西班牙', name: 'LaLiga', isDomestic: true },
    55: { country: '意大利', name: 'Serie A', isDomestic: true },
    54: { country: '德国', name: 'Bundesliga', isDomestic: true },
    53: { country: '法国', name: 'Ligue 1', isDomestic: true },
    61: { country: '葡萄牙', name: 'Primeira Liga', isDomestic: true },
    57: { country: '荷兰', name: 'Eredivisie', isDomestic: true },
    71: { country: '土耳其', name: 'Süper Lig', isDomestic: true },
    64: { country: '苏格兰', name: 'Premiership', isDomestic: true },
    40: { country: '比利时', name: 'Pro League', isDomestic: true },
    135: { country: '希腊', name: 'Super League 1', isDomestic: true },
    182: { country: '塞尔维亚', name: 'SuperLiga', isDomestic: true },
    122: { country: '捷克', name: 'Chance liga', isDomestic: true },
    212: { country: '匈牙利', name: 'NB I', isDomestic: true },
    252: { country: '克罗地亚', name: 'SuperSport HNL', isDomestic: true },
    59: { country: '挪威', name: 'Eliteserien', isDomestic: true },
    270: { country: '保加利亚', name: 'Parva liga', isDomestic: true },
    189: { country: '罗马尼亚', name: 'Superliga', isDomestic: true },
    38: { country: '奥地利', name: 'Bundesliga', isDomestic: true },
    58: { country: '瑞士', name: 'Super League', isDomestic: true },
    50: { country: '丹麦', name: 'Superliga', isDomestic: true },
    102: { country: '波兰', name: 'Ekstraklasa', isDomestic: true },
    67: { country: '瑞典', name: 'Allsvenskan', isDomestic: true },
    42: { country: 'UEFA', name: 'Champions League', isDomestic: false },
    73: { country: 'UEFA', name: 'Europa League', isDomestic: false },
    84: { country: 'UEFA', name: 'Conference League', isDomestic: false }
};

// Eight major domestic leagues – fast mode.
const MAJOR_LEAGUE_IDS = [47, 87, 55, 54, 53, 61, 57, 71];

// Country (Chinese) → primary domestic league ID – used for UEFA mode (kept for fallback).
const COUNTRY_LEAGUE_MAP = {
    '英格兰': 47,
    '西班牙': 87,
    '意大利': 55,
    '德国': 54,
    '法国': 53,
    '葡萄牙': 61,
    '荷兰': 57,
    '土耳其': 71,
    '苏格兰': 64,
    '比利时': 40,
    '希腊': 135,
    '塞尔维亚': 182,
    '捷克': 122,
    '匈牙利': 212,
    '克罗地亚': 252,
    '挪威': 59,
    '保加利亚': 270,
    '罗马尼亚': 189,
    '奥地利': 38,
    '瑞士': 58,
    '丹麦': 50,
    '波兰': 102,
    '瑞典': 67
};

/**
 * Normalizes team names – strips common suffixes/prefixes.
 */
const normalize = (name) => {
    if (!name) return '';
    return name.toLowerCase()
        .replace(/\s+(fc|cf|ac|sc|sv|bk|fk|gnk|rsc|sk|as|rc|ssc|ud|cd|rcd|vfl|tsg|fsv|fcc|mff|fck|skp|krc|kaa|kv)\b/g, '')
        .replace(/\b(fc|cf|ac|sc|sv|bk|fk|gnk|rsc|sk|as|rc|ssc|ud|cd|rcd|vfl|tsg|fsv|fcc|mff|fck|skp|krc|kaa|kv)\s+/g, '')
        .trim();
};

/**
 * Fetch rankings.
 * @param {'major'|'uefa'} mode – "major" fetches only the eight major domestic leagues.
 *                               "uefa" fetches UEFA tables then **all** domestic leagues to guarantee data for every team.
 */
export const fetchRankings = async (mode = 'major') => {
    console.log('=== Fetching Rankings (mode:', mode, ') ===');
    const allRankings = [];
    const teamDomesticData = new Map(); // normalized name → { rank, country }
    let browser = null;

    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-http2']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
        await page.goto('https://www.fotmob.com/', { waitUntil: 'networkidle2', timeout: 60000 });

        // ---------- Major mode ----------
        if (mode === 'major') {
            for (const id of MAJOR_LEAGUE_IDS) {
                const details = LEAGUE_DETAILS[id];
                console.log(`Fetching ${details.name} (ID: ${id})...`);
                const data = await page.evaluate(async (leagueId) => {
                    try { const resp = await fetch(`/api/data/tltable?leagueId=${leagueId}`); if (!resp.ok) return { error: resp.status }; return await resp.json(); }
                    catch (e) { return { error: e.message }; }
                }, id);
                if (data && !data.error) {
                    const root = Array.isArray(data) ? data[0] : data;
                    const actual = root.data || root;
                    const table = actual.table?.all || (actual.tabel ? actual.tabel[0]?.data?.table?.all : null);
                    if (Array.isArray(table)) {
                        table.forEach(item => {
                            const rank = item.idx || item.rank;
                            allRankings.push({ teamName: item.name, rank, country: details.country, leagueName: details.name, isDomestic: true });
                            teamDomesticData.set(normalize(item.name), { rank, country: details.country });
                        });
                    }
                }
                await new Promise(r => setTimeout(r, 800));
            }
            return allRankings;
        }

        // ---------- UEFA mode ----------
        // 1️⃣ Fetch UEFA tables (Champions & Europa) to collect all participating teams.
        const uefaIds = [42, 73]; // Champions & Europa
        const discoveredTeams = new Set();
        for (const id of uefaIds) {
            const details = LEAGUE_DETAILS[id];
            console.log(`Fetching UEFA ${details.name} (ID: ${id})...`);
            const data = await page.evaluate(async (leagueId) => {
                try { const resp = await fetch(`/api/data/tltable?leagueId=${leagueId}`); if (!resp.ok) return { error: resp.status }; return await resp.json(); }
                catch (e) { return { error: e.message }; }
            }, id);
            if (data && !data.error) {
                const root = Array.isArray(data) ? data[0] : data;
                const actual = root.data || root;
                const tables = actual.tables || [{ table: actual.table }];
                tables.forEach(tg => {
                    const tbl = tg.table?.all;
                    if (Array.isArray(tbl)) {
                        tbl.forEach(item => {
                            const uefaRank = item.idx || item.rank;
                            allRankings.push({ teamName: item.name, rank: uefaRank, uefaRank, country: 'Unknown', leagueName: details.name, isDomestic: false });
                            discoveredTeams.add(item.name);
                        });
                    }
                });
            }
            await new Promise(r => setTimeout(r, 800));
        }

        // 2️⃣ Fetch **all** domestic leagues (not just needed ones) to guarantee we have a domestic entry for every team.
        const domesticIds = Object.keys(LEAGUE_DETAILS).map(Number).filter(id => LEAGUE_DETAILS[id].isDomestic);
        for (const id of domesticIds) {
            const details = LEAGUE_DETAILS[id];
            console.log(`Fetching domestic ${details.name} (ID: ${id}) for full mapping...`);
            const data = await page.evaluate(async (leagueId) => {
                try { const resp = await fetch(`/api/data/tltable?leagueId=${leagueId}`); if (!resp.ok) return { error: resp.status }; return await resp.json(); }
                catch (e) { return { error: e.message }; }
            }, id);
            if (data && !data.error) {
                const root = Array.isArray(data) ? data[0] : data;
                const actual = root.data || root;
                const table = actual.table?.all || (actual.tabel ? actual.tabel[0]?.data?.table?.all : null);
                if (Array.isArray(table)) {
                    table.forEach(item => {
                        const rank = item.idx || item.rank;
                        teamDomesticData.set(normalize(item.name), { rank, country: details.country });
                    });
                }
            }
            await new Promise(r => setTimeout(r, 800));
        }

        // 3️⃣ Merge UEFA entries with the domestic info where possible.
        allRankings.forEach(entry => {
            if (!entry.isDomestic) {
                const domesticInfo = teamDomesticData.get(normalize(entry.teamName));
                if (domesticInfo) {
                    entry.rank = domesticInfo.rank; // prefer domestic rank
                    entry.country = domesticInfo.country;
                } else {
                    // As a fallback, try to infer country via TEAM_COUNTRY_MAP (may be missing for some teams).
                    const inferred = TEAM_COUNTRY_MAP[entry.teamName] || TEAM_COUNTRY_MAP[entry.teamName.replace(/\s+/g, '')];
                    if (inferred) entry.country = inferred;
                }
            }
        });

        return allRankings;
    } catch (e) {
        console.error('Puppeteer Fatal Error:', e);
        return [];
    } finally {
        if (browser) await browser.close();
    }
};
