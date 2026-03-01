import puppeteer from 'puppeteer';

/**
 * Fetches match results from FotMob API using Puppeteer piggyback method
 */
export const fetchMatchResults = async (dates = []) => {
    console.log('=== Fetching Match Results from FotMob ===');

    // If no dates provided, use yesterday and today
    if (dates.length === 0) {
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);

        const formatDate = (d) => d.toISOString().split('T')[0].replace(/-/g, '');
        dates = [formatDate(yesterday), formatDate(today)];
    }

    console.log(`Dates to fetch: ${dates.join(', ')}`);

    const allResults = [];
    let browser = null;

    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log('Establishing session on FotMob...');
        await page.goto('https://www.fotmob.com/', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        for (const dateStr of dates) {
            try {
                console.log(`Fetching results for date: ${dateStr}...`);

                const data = await page.evaluate(async (d) => {
                    try {
                        const response = await fetch(`/api/data/matches?date=${d}`);
                        if (!response.ok) return { error: response.status };
                        return await response.json();
                    } catch (e) {
                        return { error: e.message };
                    }
                }, dateStr);

                if (!data || data.error) {
                    console.error(`  ✗ Error specialized for ${dateStr}:`, data?.error || 'null response');
                    continue;
                }

                if (data.leagues && Array.isArray(data.leagues)) {
                    let matchCount = 0;
                    data.leagues.forEach(league => {
                        if (league.matches && Array.isArray(league.matches)) {
                            league.matches.forEach(match => {
                                // Only interested in matches that are finished or have a score
                                if (match.home && match.away) {
                                    allResults.push({
                                        homeTeam: match.home.name,
                                        awayTeam: match.away.name,
                                        homeScore: match.home.score,
                                        awayScore: match.away.score,
                                        status: match.status?.reason?.short || 'Unknown'
                                    });
                                    matchCount++;
                                }
                            });
                        }
                    });
                    console.log(`  ✓ Extracted ${matchCount} matches for ${dateStr}`);
                }
            } catch (err) {
                console.error(`Error processing date ${dateStr}:`, err.message);
            }
        }

    } catch (e) {
        console.error('Puppeteer Fatal Error in fetchMatchResults:', e);
    } finally {
        if (browser) await browser.close();
    }

    console.log(`Summary: Successfully fetched ${allResults.length} total match results.`);
    return allResults;
};
