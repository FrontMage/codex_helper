import puppeteer from 'puppeteer-core';

const CHROME_PATH =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HEADLESS_MODE = process.env.HEADLESS_MODE || 'new';

(async () => {
  try {
    const useLegacyHeadless = HEADLESS_MODE === 'legacy';
    const headless = useLegacyHeadless ? true : 'new';
    const headlessArgs = useLegacyHeadless ? ['--headless'] : ['--headless=new'];
    const browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless,
      args: ['--no-sandbox', ...headlessArgs]
    });
    const spawnArgs = browser.process()?.spawnargs || [];
    const hasHeadless = spawnArgs.some((arg) => arg.includes('--headless'));
    console.log(`headless flag detected: ${hasHeadless}`);
    if (spawnArgs.length) {
      console.log(`spawn args: ${spawnArgs.join(' ')}`);
    }
    console.log('launch ok');
    await browser.close();
  } catch (err) {
    console.error('launch failed:', err.message);
    console.error(err);
    process.exit(1);
  }
})();
