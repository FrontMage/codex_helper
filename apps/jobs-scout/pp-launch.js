import puppeteer from 'puppeteer-core';

const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  try {
    const browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new',
      args: ['--no-sandbox']
    });
    console.log('launch ok');
    await browser.close();
  } catch (err) {
    console.error('launch failed:', err.message);
    console.error(err);
    process.exit(1);
  }
})();
