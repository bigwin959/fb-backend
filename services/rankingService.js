import puppeteer from 'puppeteer';

// Use specific Table URLs to ensure table presence
const LEAGUES = [
    { name: 'Premier League', url: 'https://www.fotmob.com/leagues/47/table/premier-league' },
    { name: 'La Liga', url: 'https://www.fotmob.com/leagues/87/table/laliga' },
    { name: 'Bundesliga', url: 'https://www.fotmob.com/leagues/54/table/bundesliga' },
    { name: 'Serie A', url: 'https://www.fotmob.com/leagues/55/table/serie-a' },
    { name: 'Ligue 1', url: 'https://www.fotmob.com/leagues/53/table/ligue-1' }
];

export const fetchRankings = async () => {
    console.log('=== Starting Ranking Service (FotMob) ===');
    // Launch headless: false to bypass bot detection and allow visual debugging
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
        defaultViewport: null
    });

    const allRankings = [];

    try {
        const page = await browser.newPage();

        // Set user agent to avoid bot detection (FotMob can be picky)
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        let isFirst = true;

        for (const league of LEAGUES) {
            console.log(`Fetching ${league.name} from ${league.url}...`);
            await page.goto(league.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

            // Handle Cookie Consent
            if (isFirst) {
                try {
                    const cookieClicked = await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button'));
                        const acceptBtn = buttons.find(b =>
                            b.innerText.toLowerCase().includes('accept') ||
                            b.innerText.toLowerCase().includes('agree') ||
                            b.innerText.toLowerCase().includes('allow')
                        );
                        if (acceptBtn) {
                            acceptBtn.click();
                            return true;
                        }
                        return false;
                    });
                    if (cookieClicked) {
                        console.log('Clicked Cookie Consent button.');
                        await new Promise(r => setTimeout(r, 2000));
                    }
                } catch (e) {
                    // Ignore
                }
                isFirst = false;
            }

            try {
                // Wait specifically for team names or main content, rather than assuming 'tbody'
                // Wait for network idle to ensure dynamic content loads
                await new Promise(r => setTimeout(r, 3000));

                // Attempt Generic Extraction via InnerText (Robust fallback)
                const leagueRankings = await page.evaluate((leagueName) => {
                    const text = document.body.innerText;
                    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    const results = [];

                    // FotMob text pattern usually looks like:
                    // #
                    // Team Name
                    // P
                    // ...
                    // OR: 1 Arsenal 20 ... (tabular line)

                    // Simple parser: Look for lines that are just numbers (rank) followed by text (team)
                    for (let i = 0; i < lines.length - 1; i++) {
                        // Check if line is a rank (1-30)
                        if (/^[0-9]{1,2}$/.test(lines[i])) {
                            const rank = parseInt(lines[i]);
                            // Sanity check rank
                            if (rank < 1 || rank > 30) continue;

                            const potentialTeam = lines[i + 1];
                            // Sanity check team name (length, no numbers at start usually)
                            if (potentialTeam.length > 2 && isNaN(parseInt(potentialTeam))) {
                                // Exclude common bad matches
                                if (['pl', 'w', 'd', 'l', 'pts', 'gd'].includes(potentialTeam.toLowerCase())) continue;

                                // Avoid duplicates
                                if (!results.find(r => r.rank === rank)) {
                                    results.push({
                                        league: leagueName,
                                        rank: rank,
                                        teamName: potentialTeam
                                    });
                                }
                            }
                        }
                    }
                    return results;
                }, league.name);

                if (leagueRankings.length > 0) {
                    console.log(`Found ${leagueRankings.length} teams in ${league.name} (via Text Scan)`);
                    allRankings.push(...leagueRankings);
                } else {
                    console.warn(`No rankings parsed for ${league.name}. Dumping first 200 chars of text:`);
                    const debugText = await page.evaluate(() => document.body.innerText.substring(0, 200));
                    console.log(debugText);
                }

            } catch (e) {
                console.error(`Error extracting ${league.name}:`, e.message);
                try {
                    const title = await page.title();
                    console.log(`Current page title: ${title}`);
                } catch (err) { }
            }

            await new Promise(r => setTimeout(r, 1000));
        }

    } catch (error) {
        console.error('Ranking fetch error:', error);
    } finally {
        await browser.close();
    }

    return allRankings;
};
