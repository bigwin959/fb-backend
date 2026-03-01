import puppeteer from 'puppeteer';
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
        console.log('Waiting 10 seconds for sportsbook frames to fully load...');
        await new Promise(r => setTimeout(r, 10000));

        console.log('Bypassing potential rules/regulations popups...');
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('a, button, input'));
            const agree = btns.find(b => {
                const text = (b.innerText || b.value || '').toLowerCase();
                return text.includes('i agree') || text.includes('accept') || text === 'ok';
            });
            if (agree) agree.click();
        });
        await new Promise(r => setTimeout(r, 3000));

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
    }
};
