import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteer.use(StealthPlugin());
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
            args: [
                '--start-maximized',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--single-process'
            ]
        });

        globalPage = await globalBrowser.newPage();
        await globalPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log('Navigating to Sport368...');
        await globalPage.goto('http://www.sport368.com', {
            waitUntil: 'domcontentloaded',
            timeout: 0
        });

        // Option 2: Automated Login via Environment Variables (For Render / Cloud)
        if (process.env.SPORT368_USERNAME && process.env.SPORT368_PASSWORD) {
            console.log('Credentials detected. Attempting automated login...');
            try {
                const currentUrl = await globalPage.url();
                const currentTitle = await globalPage.title();
                console.log(`Current URL: ${currentUrl} | Title: ${currentTitle}`);
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
                    const debugHtml = await globalPage.content();
                    console.log(`[DEBUG] Page HTML preview:`, debugHtml.substring(0, 500));
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

        console.log('Closing small pop up posters / announcements across all frames...');
        for (const frame of [page, ...page.frames()]) {
            try {
                await frame.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('a, button, input'));
                    const agree = btns.find(b => {
                        const text = (b.innerText || b.value || '').toLowerCase();
                        return text === 'i agree' || text === 'accept' || text === 'ok' || text.includes('i agree');
                    });
                    if (agree) { agree.click(); }
                });
            } catch (e) { /* ignore frame cross-origin issues */ }
        }
        await new Promise(r => setTimeout(r, 6000));

        console.log('Attempting to navigate to Soccer / Football in left menu...');
        let clickedMenu = false;
        for (const frame of page.frames()) {
            try {
                const clicked = await frame.evaluate(() => {
                    let clickedSomething = false;
                    const links = Array.from(document.querySelectorAll('a, span, div, li'));
                    for (const link of links) {
                        const txt = (link.innerText || '').trim().toLowerCase();
                        if (txt === 'soccer' || txt === 'football' || txt === '足球' || txt === 'early') {
                            const rect = link.getBoundingClientRect();
                            if (rect.width > 0 && rect.height > 0) {
                                link.click();
                                clickedSomething = true;
                                // don't break, might need to click multiple nested menus
                            }
                        }
                    }
                    return clickedSomething;
                });
                if (clicked) clickedMenu = true;
            } catch (e) { }
        }

        if (clickedMenu) {
            console.log('Navigated menu. Waiting 10s for odds frame to load...');
            await new Promise(r => setTimeout(r, 10000));
        }

        console.log('Scanning for match table in frames...');

        // Find best frame by looking for specific keywords instead of complex scoring
        let bestFrame = null;
        for (const f of page.frames()) {
            try {
                const txt = await f.evaluate(() => document.body ? document.body.innerText.substring(0, 500) : '');
                if (txt.includes('Select League') || txt.includes('MMR') || txt.includes('HDP')) {
                    bestFrame = f;
                    break;
                }
            } catch (e) { }
        }

        if (!bestFrame) {
            throw new Error('Could not identify a match data frame. Check if you are on the Correct Score/Match page.');
        }

        console.log(`Analyzing best frame: ${bestFrame.url()} (Score: ${maxScore})`);

        console.log('Attempting to Select Leagues automatically...');
        try {
            await bestFrame.evaluate(() => {
                const els = Array.from(document.querySelectorAll('a, button, span, div'));
                let selectLeagueBtn = els.find(e => {
                    const txt = (e.innerText || '').trim().toLowerCase();
                    return txt === 'select league' || txt === 'leagues' || txt === '选择联赛';
                });

                if (selectLeagueBtn) {
                    selectLeagueBtn.click();
                    setTimeout(() => {
                        const modalEls = Array.from(document.querySelectorAll('a, button, span, div, input, label'));
                        let allBtn = modalEls.find(e => {
                            const txt = (e.innerText || '').trim().toLowerCase();
                            return ['all', 'select all', '全选'].includes(txt);
                        });
                        if (allBtn) allBtn.click();

                        setTimeout(() => {
                            let submitBtn = modalEls.find(e => {
                                const txt = (e.innerText || '').trim().toLowerCase();
                                return ['submit', 'go', 'ok', '确定', '确认'].includes(txt);
                            });
                            if (submitBtn) submitBtn.click();
                        }, 500);
                    }, 1000);
                }
            });
            await new Promise(r => setTimeout(r, 4000)); // wait for league reload
        } catch (e) {
            console.log('Select leagues auto-step failed or not found, continuing...');
        }

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
