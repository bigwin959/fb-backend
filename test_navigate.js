import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
dotenv.config();

(async () => {
    console.log('Starting local headless browser to inspect Sport368...');
    const browser = await puppeteer.launch({ headless: false, defaultViewport: null });
    const page = await browser.newPage();

    console.log('Navigating to http://www.sport368.com...');
    await page.goto('http://www.sport368.com', { waitUntil: 'networkidle2', timeout: 60000 });

    if (process.env.SPORT368_USERNAME) {
        console.log('Logging in automatically...');
        try {
            await page.waitForSelector('#UserName', { timeout: 15000 });
            await page.type('#UserName', process.env.SPORT368_USERNAME);
            await page.type('#Password', process.env.SPORT368_PASSWORD);
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2' }),
                page.click('#sub, input[value="Login"], button')
            ]);
            console.log('Login navigated.');
        } catch (e) { console.log('Login err', e.message); }
    } else {
        console.log('No credentials in .env! Waiting 20 seconds for manual login.');
        await new Promise(r => setTimeout(r, 20000));
    }

    console.log('Fetching all frames and links...');
    await new Promise(r => setTimeout(r, 5000)); // Wait for lobby popups to settle

    for (const frame of page.frames()) {
        try {
            console.log(`\n\n--- Frame URL: ${frame.url()} ---`);
            const links = await frame.evaluate(() => {
                return Array.from(document.querySelectorAll('a')).map(a => `${a.innerText.trim()} -> ${a.href}`).filter(t => t.length > 5 && !t.includes('javascript:void'));
            });
            console.log(links.slice(0, 30).join('\n'));

            const buttons = await frame.evaluate(() => {
                return Array.from(document.querySelectorAll('button, div[onclick], span[onclick], li[onclick]')).map(b => b.innerText.trim()).filter(t => t.length > 2 && t.length < 30);
            });
            if (buttons.length > 0) console.log('Buttons:', buttons.slice(0, 10).join(' | '));

        } catch (e) { }
    }

    console.log('Done scanning frames.');
    await browser.close();
})();
