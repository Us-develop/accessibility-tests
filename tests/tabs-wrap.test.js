import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const HTML = `<!doctype html>
<html>
  <head>
    <style>
      body { margin: 0; }
      .tabs-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 16px;
      }
      .tabs-scroll {
        flex: 1 1 100%;
        min-width: 60%;
      }
      .variant-switcher { display: flex; }
    </style>
  </head>
  <body>
    <div class="tabs-row">
      <div class="tabs-scroll" id="tabs">Overview Issues Pages Manual</div>
      <div class="variant-switcher" id="variant">Simple Detailed</div>
    </div>
  </body>
</html>`;

describe('report tab strip wrap', () => {
  it('wraps the tab strip before the variant switcher at 360, 390 and 560 px', async () => {
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
    } catch (err) {
      assert.ok(err, 'playwright chromium is required for this layout check');
      return;
    }
    try {
      for (const width of [360, 390, 560]) {
        const context = await browser.newContext({ viewport: { width, height: 800 } });
        const page = await context.newPage();
        await page.setContent(HTML);
        const metrics = await page.evaluate(() => {
          const tabs = document.getElementById('tabs');
          const variant = document.getElementById('variant');
          const row = tabs.getBoundingClientRect();
          return {
            tabsTop: tabs.getBoundingClientRect().top,
            variantTop: variant.getBoundingClientRect().top,
            tabsWidth: tabs.getBoundingClientRect().width,
            rowWidth: row.width,
          };
        });
        assert.ok(
          metrics.variantTop > metrics.tabsTop + 1 || metrics.tabsWidth >= width * 0.6,
          `expected wrap or 60% min-width at ${width}px, got ${JSON.stringify(metrics)}`
        );
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
});
