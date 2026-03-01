import puppeteer from 'puppeteer';
<<<<<<< HEAD
import fs from 'fs';
import path from 'path';

let globalBrowser = null;
let globalPage = null;

export const launchBrowser = async () => {
    console.log('=== Football Data Scraper (Step 1: Launch) ===');

    // Close existing browser if open
    if (globalBrowser) {
        try {
            await globalBrowser.close();
            console.log('Closed previous browser instance.');
        } catch (e) { }
    }

    try {
        globalBrowser = await puppeteer.launch({
            headless: process.env.NODE_ENV === 'production' ? 'new' : false, // Render uses production
            defaultViewport: null,
            args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        globalPage = await globalBrowser.newPage();

        console.log('Navigating to Sport368...');
        await globalPage.goto('http://www.sport368.com', {
            waitUntil: 'domcontentloaded',
            timeout: 0
        });

        // Option 2: Automated Login via Environment Variables (For Render / Cloud)
        if (process.env.SPORT368_USERNAME && process.env.SPORT368_PASSWORD) {
            console.log('Credentials detected. Attempting automated login...');
            try {
                // Give the page plenty of time to load past any splash screens
                console.log('Waiting for login fields...');
                await globalPage.waitForSelector('#UserName', { timeout: 45000 }).catch(() => { });

                const userField = await globalPage.$('#UserName');
                const passField = await globalPage.$('#Password'); // The site uses type="text" for the password field!
                const btnField = await globalPage.$('#sub, input[value="Login"], button');

                if (userField && passField && btnField) {
                    await userField.type(process.env.SPORT368_USERNAME, { delay: 50 });
                    await passField.type(process.env.SPORT368_PASSWORD, { delay: 50 });

                    console.log('Clicking login...');
                    await btnField.click();

                    // Don't wait for navigation explicitly, just wait a few seconds
                    await new Promise(r => setTimeout(r, 4000));
                    console.log('Auto-login sequence completed.');
                    return { success: true, message: 'Browser launched and logged in automatically!' };
                } else {
                    console.log('Could not find standard login fields in the main page. Falling back to manual...');
                    return { success: true, message: 'Browser opened. Please log in manually if needed.' };
                }
            } catch (err) {
                console.error('Automated login error:', err.message);
                return { success: true, message: 'Browser opened, but auto-login skipped. Please log in manually.' };
            }
        }

        console.log('Browser launched. Waiting for user login...');
        return { success: true, message: 'Browser opened. Please login and navigate to matches.' };
    } catch (error) {
        console.error('Launch Error:', error);
        throw error;
    }
};

export const executeScrape = async () => {
    if (!globalPage) {
        throw new Error('Browser not running. Please launch scraper first.');
    }

    console.log('=== Football Data Scraper (Step 2: Execute) ===');
    const page = globalPage;

    // We assume the user has navigated to the right place.
    // We will do a quick check for the frame, but mostly we presume readiness.

    try {
        console.log('Scanning for match table in frames...');

        // Helper to get frame content
        const getFrameContent = async (frame) => {
            try {
                return await frame.evaluate(() => {
                    const text = document.body ? document.body.innerText : '';
                    return {
                        url: document.location.href,
                        textLength: text.length,
                        preview: text.substring(0, 200).replace(/\n/g, ' '),
                        hasVs: text.includes('vs'),
                        hasHDP: text.includes('HDP'),
                        hasTime: /\d{1,2}:\d{2}/.test(text),
                        fullText: text
                    };
                });
            } catch (e) { return null; }
        };

        let bestFrame = null;
        let maxScore = 0;
        let debugLog = '=== FRAME DEBUG LOG ===\n';

        for (const frame of page.frames()) {
            const content = await getFrameContent(frame);
            if (!content) continue;

            let score = 0;
            // Relaxed Scoring
            if (content.hasVs) score += 10;
            if (content.hasHDP) score += 10;
            if (content.hasTime) score += 5;
            if (content.textLength > 1000) score += 2;

            // Penalties for nav frames
            if (content.url.includes('left') || content.url.includes('menu')) score -= 20;

            debugLog += `URL: ${content.url}\nScore: ${score}\nLen: ${content.textLength}\nPreview: ${content.preview}\n---\n`;

            if (score > maxScore) {
                maxScore = score;
                bestFrame = frame;
            }
        }

        fs.writeFileSync(path.resolve('frames_debug.txt'), debugLog);

        if (!bestFrame) {
            throw new Error('Could not identify a match data frame. Check if you are on the Correct Score/Match page.');
        }

        console.log(`Analyzing best frame: ${bestFrame.url()} (Score: ${maxScore})`);

        console.log('Forcing odds format to Myanmar (MMR)...');
        await bestFrame.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('a, span, div, li, button'));
            const mmrBtns = btns.filter(el => el.innerText.trim() === 'MMR');
            if (mmrBtns.length > 0) {
                // Clicking the last matched MMR item usually targets the dropdown item instead of the closed header
                const target = mmrBtns[mmrBtns.length - 1];
                target.click();
            }
        });

        // Wait a few seconds for odds frame to reload after switching to MMR format
        await new Promise(r => setTimeout(r, 4000));

        const rawText = await bestFrame.evaluate(() => document.body.innerText);
        fs.writeFileSync(path.resolve('scraper_debug.txt'), rawText);

        const results = await bestFrame.evaluate(() => {
            const matches = [];
            const all = Array.from(document.querySelectorAll('*'));

            let currentLeague = 'Unknown League';

            for (const el of all) {
                if (el.children.length > 20) continue; // Skip huge containers

                const txt = el.innerText;
                if (!txt || txt.length < 5) continue;

                // Detect League Header (Uppercase, short, no time)
                const cleanTxt = txt.trim().split('\n')[0]; // usually first line
                if (cleanTxt.length > 5 && cleanTxt.length < 50 && cleanTxt === cleanTxt.toUpperCase() && !cleanTxt.match(/\d{1,2}:\d{2}/) && !cleanTxt.includes('(')) {
                    currentLeague = cleanTxt;
                }

                const timeMatch = txt.match(/\b(\d{1,2}:\d{2})\b/);
                if (!timeMatch) continue;

                const lines = txt.split('\n').map(l => l.trim()).filter(l => l);

                // Sport368 MMR format breaks odds into multiple newlines: "1(", "65", ")A"
                // Reconnect them into a single token: "1(65)A"
                const normalizedLines = [];
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].endsWith('(')) {
                        let combined = lines[i];
                        if (i + 1 < lines.length) {
                            combined += lines[i + 1]; // Add the price inside parenthesis
                            i++;
                        }
                        if (i + 1 < lines.length && lines[i + 1].startsWith(')')) {
                            combined += lines[i + 1]; // Add closing parenthesis and H/A
                            i++;
                        }
                        normalizedLines.push(combined.replace(/\s/g, ''));
                    } else {
                        normalizedLines.push(lines[i]);
                    }
                }

                // Identify Teams and MMR Odds Tokens
                const teams = [];
                const odds = [];

                for (const l of normalizedLines) {
                    if (l === 'Live' || l === 'HT' || l.includes(':') || l.match(/^[12]H \d+$/)) continue;

                    if (l.match(/^[A-Za-z]/) && !l.includes('LEAGUE') && !l.includes('CHAMPIONSHIP')) {
                        if (teams.length < 2) teams.push(l);
                    } else if (l.match(/^(\d+(\.\d+)?)?\([-+]?\d+\)[HA]?$/)) {
                        odds.push(l);
                    }
                }

                if (teams.length < 2) continue;

                // Pick the first odd ending in H/A as handicap, the first without H/A as OU
                let handicapStr = '';
                let ouStr = '';

                for (const o of odds) {
                    if (o.endsWith('H') || o.endsWith('A')) {
                        if (!handicapStr) handicapStr = o;
                    } else {
                        if (!ouStr) ouStr = o;
                    }
                }

                // If text was too big, keep skipping
                if (txt.length > 500) continue;

                matches.push({
                    league: currentLeague,
                    time: timeMatch[0],
                    home: teams[0],
                    away: teams[1],
                    handicap: handicapStr,
                    overUnder: ouStr,
                    raw: `${timeMatch[0]}  ${teams[0]} vs ${teams[1]}  ${handicapStr}  ${ouStr}`
                });
            }
            return matches;
        });

        // The user wants strictly these major leagues:
        const desiredLeagues = [
            'ENGLISH PREMIER LEAGUE',
            'GERMANY-BUNDESLIGA I',
            'GERMANY BUNDESLIGA 1',
            'FRANCE LIGUE 1',
            'ITALY SERIE A',
            'SPAIN PRIMERA LALIGA',
            'UEFA CHAMPIONS LEAGUE',
            'UEFA EUROPA LEAGUE',
            'FIFA WORLD CUP'
        ];

        // Deduplicate and filter
        const unique = [];
        const seen = new Set();
        for (const m of results) {
            // Check if match belongs to a desired league
            const isDesired = desiredLeagues.some(dl => m.league.includes(dl));
            if (!isDesired) continue;

            const k = m.time + m.home + m.away;
            if (!seen.has(k)) {
                seen.add(k);
                unique.push(m);
            }
        }

        // Sort matches chronologically by time
        const timeToMins = (t) => {
            if (!t) return 0;
            const parts = t.split(':');
            if (parts.length < 2) return 0;
            const h = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10);
            // Assume betting day starts at noon (12:00 -> 23:59 are before 00:00 -> 11:59)
            const adjustedH = h < 12 ? h + 24 : h;
            return adjustedH * 60 + m;
        };

        unique.sort((a, b) => timeToMins(a.time) - timeToMins(b.time));

        console.log(`Extracted ${unique.length} matches from selected major leagues.`);

        // Auto-close after successful scrape, or let user do it?
        // Let's keep it open for a few seconds then close, or better, keep it open until user closes?
        // User asked for "confirm after login", then scrape. Usually after scrape they are done.
        setTimeout(() => {
            if (globalBrowser) {
                globalBrowser.close().catch(() => { });
            }
            globalBrowser = null;
            globalPage = null;
        }, 5000);

        return unique;
    } catch (error) {
        console.error('Execution Error:', error);
        throw error;
    }
};

// Check if browser is alive
export const isBrowserRunning = () => !!globalBrowser;

// Helper to close manually
export const closeBrowser = async () => {
    if (globalBrowser) {
        await globalBrowser.close();
        globalBrowser = null;
        globalPage = null;
=======

const TARGET_LEAGUES = [
    'ENGLISH PREMIER LEAGUE',
    'GERMANY BUNDESLIGA 1',
    'ITALY SERIE A',
    'FRANCE LEAGUE 1',
    'SPAIN PREMIER LALIGA',
    'UEFA CHAMPIONS LEAGUE',
    'UEFA EUROPA LEAGUE',
    'WORLD CUP'
];

export const scrapeOdds = async () => {
    console.log('=== Starting Sport368 Scraper (Debug + Smart Extract) ===');
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized']
    });

    let page;

    // Overlay
    const setStatus = async (p, msg, color = '#3b82f6', showButton = false) => {
        try {
            if (!p || p.isClosed()) return;
            await p.evaluate((m, c, showBtn) => {
                let div = document.getElementById('scraper-overlay');
                if (!div) {
                    div = document.createElement('div');
                    div.id = 'scraper-overlay';
                    div.style.position = 'fixed';
                    div.style.top = '10px'; div.style.right = '10px';
                    div.style.padding = '15px'; div.style.background = 'rgba(0,0,0,0.9)';
                    div.style.color = '#fff'; div.style.zIndex = '2147483647';
                    div.style.borderRadius = '8px'; div.style.fontFamily = 'sans-serif';
                    div.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
                    div.style.display = 'flex'; div.style.flexDirection = 'column'; div.style.gap = '10px';
                    div.style.minWidth = '300px';
                    document.body.appendChild(div);
                }
                let msgEl = document.getElementById('scraper-msg');
                if (!msgEl) {
                    msgEl = document.createElement('div');
                    msgEl.id = 'scraper-msg';
                    div.appendChild(msgEl);
                }
                msgEl.textContent = `🤖 ${m}`;
                div.style.borderLeft = `5px solid ${c}`;

                let btn = document.getElementById('scraper-start-btn');
                if (showBtn && !btn) {
                    btn = document.createElement('button');
                    btn.id = 'scraper-start-btn';
                    btn.textContent = "Start Extraction Now ➤";
                    btn.style.padding = '10px 15px'; btn.style.background = '#10b981';
                    btn.style.color = 'white'; btn.style.border = 'none'; btn.style.borderRadius = '4px';
                    btn.style.cursor = 'pointer'; btn.style.fontWeight = 'bold';
                    btn.onclick = () => { window._scraperReady = true; btn.textContent = 'Starting...'; btn.disabled = true; };
                    div.appendChild(btn);
                } else if (!showBtn && btn) btn.remove();
            }, msg, color, showButton);
        } catch (e) { }
    };

    try {
        page = await browser.newPage();

        // Console bridge
        page.on('console', msg => {
            const text = msg.text();
            if (text.includes('SCRAPER_DEBUG')) console.log(text);
        });

        await page.goto('https://www.sport368.com', { waitUntil: 'domcontentloaded' });

        await setStatus(page, 'Waiting for Dashboard...', '#f59e0b', true);

        // --- 1. WAIT FOR DASHBOARD ---
        let attempts = 0;
        let mainFrame = null;
        while (attempts < 600) {
            try {
                if (await page.evaluate(() => window._scraperReady === true)) break;
                for (const f of page.frames()) {
                    const found = await f.$('#li_ddlCountry a, #li_ddlLine a').catch(() => null);
                    if (found) { mainFrame = f; break; }
                }
                if (mainFrame) break;
            } catch (e) { }
            await new Promise(r => setTimeout(r, 1000));
            attempts++;
        }

        await setStatus(page, 'Configuring Settings...', '#8b5cf6');

        // --- 2. CONFIG SETTINGS ---
        const findSettingsFrame = async () => {
            for (const f of page.frames()) {
                const el = await f.$('#li_ddlCountry a');
                if (el) return f;
            }
            return mainFrame;
        };

        let settingsFrame = await findSettingsFrame();

        if (settingsFrame) {
            console.log(`Settings found in frame: ${settingsFrame.name()}`);
            // Set MMK
            try {
                const currentTxt = await settingsFrame.$eval('#li_ddlCountry a', el => el.innerText).catch(() => '');
                if (!currentTxt.includes('MMR') && !currentTxt.includes('MMK')) {
                    await settingsFrame.$eval('#li_ddlCountry a', el => el.click());
                    await new Promise(r => setTimeout(r, 1000));
                    await settingsFrame.evaluate(() => {
                        const opts = Array.from(document.querySelectorAll('ul.subs li a'));
                        const target = opts.find(a => a.innerText.includes('MMR') || a.innerText.includes('MMK'));
                        if (target) target.click();
                    });
                    await new Promise(r => setTimeout(r, 3000));
                    if (settingsFrame.isDetached()) settingsFrame = await findSettingsFrame();
                }
            } catch (e) { }

            // Set Double
            try {
                if (settingsFrame) {
                    const lineTxt = await settingsFrame.$eval('#li_ddlLine a', el => el.innerText).catch(() => '');
                    if (!lineTxt.includes('Double')) {
                        await settingsFrame.$eval('#li_ddlLine a', el => el.click());
                        await new Promise(r => setTimeout(r, 800));
                        await settingsFrame.evaluate(() => {
                            const el = document.querySelector('li.lineType_double a');
                            if (el) el.click();
                        });
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }
            } catch (e) { }
        }

        // --- 3. FILTER LEAGUES ---
        await setStatus(page, 'Filtering Leagues...', '#ec4899');
        let leagueFrame = null;
        for (const f of page.frames()) {
            if (await f.$('#league-wrapper a, span.leagueFilter').catch(() => null)) {
                leagueFrame = f; break;
            }
        }

        if (leagueFrame) {
            try {
                await leagueFrame.$eval('#league-wrapper a, span.leagueFilter', el => el.click());
                await new Promise(r => setTimeout(r, 2000));

                const count = await leagueFrame.evaluate((targets) => {
                    const labels = Array.from(document.querySelectorAll('label'));
                    let c = 0;
                    labels.forEach(l => {
                        const txt = l.innerText.toUpperCase().replace(/[^A-Z0-9]/g, '');
                        if (targets.some(t => {
                            const ct = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
                            return txt.includes(ct) || ct.includes(txt);
                        })) { l.click(); c++; }
                    });
                    return c;
                }, TARGET_LEAGUES);

                if (count > 0) {
                    await new Promise(r => setTimeout(r, 1000));
                    await leagueFrame.evaluate(() => {
                        const btn = document.querySelector('#btnOk') || document.querySelector('input[value="OK"]');
                        if (btn) btn.click();
                    });
                    await new Promise(r => setTimeout(r, 3000));
                }
            } catch (e) { }
        }

        // --- 4. EXTRACT ---
        await setStatus(page, 'Scanning matches...', '#10b981');

        let allMatches = [];

        // Check finding data
        for (let i = 0; i < 8; i++) {
            const found = await page.evaluate(() => document.body.innerText.match(/\d{1,2}:\d{2}/));
            if (found) break;
            await new Promise(r => setTimeout(r, 1000));
        }

        for (const frame of page.frames()) {
            try {
                const results = await frame.evaluate(() => {
                    const data = [];
                    // Target specifically matching rows
                    const rows = [
                        ...document.querySelectorAll('tr'),
                        ...document.querySelectorAll('.line_row'),
                        ...document.querySelectorAll('.lines_row')
                    ];

                    // Fallback to div scan if no specific rows found
                    const candidates = rows.length > 5 ? rows : document.querySelectorAll('div');

                    console.log(`SCRAPER_DEBUG: Frame ${window.name} scanning ${candidates.length} els`);

                    const processed = new Set();

                    for (const row of candidates) {
                        const txt = row.innerText;

                        // 1. AGGRESSIVE JUNK FILTER
                        if (!txt || txt.length < 10 || txt.length > 2000) continue;
                        if (txt.includes('Login Time') || txt.includes('GMT') || txt.includes('Announcement')) continue;
                        if (txt.includes('Personal Msg') || txt.includes('Security Message')) continue;
                        if (txt.includes('TIME vs RUNNING BALL') || txt.includes('TIME vs EVENT')) continue;

                        // Must have time
                        if (!/\d{1,2}:\d{2}/.test(txt)) continue;
                        // Avoid headers
                        if (txt.includes('Time') && txt.includes('Event')) continue;

                        const lines = txt.split('\n').map(l => l.trim()).filter(l => l);
                        const timeIdx = lines.findIndex(l => /\d{1,2}:\d{2}/.test(l));
                        if (timeIdx === -1) continue;
                        const time = lines[timeIdx];

                        // REGEX for "1(25)A" or "3(10)" or "0/0.5(50)"
                        const fullText = lines.join(' ');
                        const oddRegex = /([0-9./-]+)\s*\(\s*([+-]?[0-9]+)\s*\)\s*([A-Za-z]?)/g;

                        const matchesArr = [...fullText.matchAll(oddRegex)];

                        let handicap = '';
                        let overUnder = '';

                        // SMART ASSIGNMENT
                        for (const regexMatch of matchesArr) {
                            const full = regexMatch[0]; // "1(25)A"
                            const suffix = regexMatch[3]; // "A" or ""

                            // H/A suffix = Handicap
                            if (suffix && (suffix.toUpperCase() === 'H' || suffix.toUpperCase() === 'A')) {
                                handicap = full;
                            }
                            else {
                                // If we assume HDP usually comes first or has suffix
                                if (handicap && !overUnder) overUnder = full;
                                else if (!handicap) {
                                    // Make a guess based on value?
                                    // Usually HDP is small (0, 0.5, 1), OU is large (2.5, 3).
                                    // But not always.
                                    // Let's assume strict: If no H/A suffix, it's ambiguous.
                                    // But user requested specific format 1(25)A.
                                    // If text is "0/0.5(50)", it has no suffix.
                                    // If we see two odds, first is typically HDP, second OU.
                                    if (matchesArr.indexOf(regexMatch) === 0) handicap = full;
                                    else overUnder = full;
                                }
                            }
                        }

                        // Clean Over/Under (remove trailing o/u)
                        if (overUnder) {
                            overUnder = overUnder.replace(/\s*[ouOU]$/, '');
                        }

                        // Fallback O/U (simple number 2.5/3 etc)
                        if (!overUnder) {
                            const simpleOU = /\b(2\.5|3|3\.5|4|4\.5)(\s*\(\s*[+-]?[0-9]+\s*\))?/;
                            const m = fullText.match(simpleOU);
                            if (m && m[0] !== handicap) overUnder = m[0];
                        }

                        // TEAMS EXTRACTION
                        // Filter out lines that look like:
                        // - 'Live' status
                        // - The extracted Time
                        // - The extracted Odds
                        // - Parentheses (odds parts)
                        const cleanLines = lines.filter(l =>
                            !['Live', 'Running', 'Live Center'].includes(l) &&
                            l !== time &&
                            !l.match(/[0-9.]+\(.*\)/) &&
                            !l.includes('(') && !l.includes(')')
                        );

                        // Filter out pure numbers
                        let teams = cleanLines.filter(l => !/^[0-9./-]+$/.test(l));

                        // 2. SUPPORT VS SPLITTING
                        // If we only found 1 line (e.g. "Arsenal vs Chelsea"), split it
                        if (teams.length === 1 && teams[0].toLowerCase().includes(' vs ')) {
                            teams = teams[0].split(/\s+vs\s+/i);
                        }

                        // Must have 2 teams
                        if (teams.length >= 2) {
                            const matchKey = time + teams[0] + teams[1];
                            if (!processed.has(matchKey)) {
                                processed.add(matchKey);
                                data.push({
                                    time,
                                    home: teams[0],
                                    away: teams[1],
                                    handicap,
                                    overUnder,
                                    raw: fullText
                                });
                            }
                        }
                    }
                    return data;
                });

                if (results.length > 0) {
                    console.log(`Frame ${frame.name()} yielded ${results.length} matches`);
                    allMatches = allMatches.concat(results);
                }
            } catch (e) {
                console.log(`SCRAPER_DEBUG: Frame Error: ${e.message}`);
            }
        }

        // Dedupe
        const unique = [];
        const seen = new Set();
        allMatches.forEach(m => {
            const k = `${m.time}-${m.home}-${m.away}`;
            if (!seen.has(k)) { seen.add(k); unique.push(m); }
        });

        unique.sort((a, b) => { // Sort
            const getM = (t) => {
                const [h, m] = t.split(':').map(Number);
                let mins = h * 60 + m;
                if (mins < 990) mins += 1440;
                return mins;
            };
            return getM(a.time) - getM(b.time);
        });

        console.log(`Extracted ${unique.length} matches.`);
        await setStatus(page, `Success! ${unique.length} matches found.`, '#10b981');
        await new Promise(r => setTimeout(r, 4000));
        return unique;

    } catch (error) {
        console.error('Fatal Error:', error);
        if (page && !page.isClosed()) await setStatus(page, `Error: ${error.message}`, '#ef4444');
        throw error;
    } finally {
        if (browser) setTimeout(() => browser.close(), 1000);
>>>>>>> 5634fdfd343abf03effc7c33429ffe196cc76f4f
    }
};
