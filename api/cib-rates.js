import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const URL = "https://www.cibeg.com/en/currency-converter";

function pairFromText(text, { min=10, max=200, maxSpread=3 } = {}) {
  const nums = (text.match(/\d{1,3}(?:[.,]\d+)?/g) || [])
    .map(s => parseFloat(s.replace(",", ".")));
  for (let i = 0; i < nums.length - 1; i++) {
    let buy = nums[i], sell = nums[i + 1];
    if (!(isFinite(buy) && isFinite(sell))) continue;
    if (sell < buy) [buy, sell] = [sell, buy];
    const spread = sell - buy;
    if (buy >= min && buy <= max && sell >= min && sell <= max && spread >= 0 && spread <= maxSpread) {
      return { buy, sell };
    }
  }
  return null;
}

export default async function handler(req, res) {
  let browser;
  try {
    const executablePath = await chromium.executablePath();
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1200, height: 900 },
      executablePath,
      headless: chromium.headless
    });

    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36");
    await page.setRequestInterception(true);
    page.on("request", r => {
      const t = r.resourceType();
      if (["image","font","media"].includes(t)) r.abort(); else r.continue();
    });

    await page.goto(URL, { waitUntil: "networkidle2", timeout: 45000 })
      .catch(() => page.goto(URL, { waitUntil: "domcontentloaded" }));

    try {
      await page.$$eval("button", btns => {
        const b = [...btns].find(x => /accept|agree/i.test(x.textContent || ""));
        if (b) b.click();
      });
    } catch {}

    const rows = await page.$$eval("tr", trs =>
      trs.map(tr => tr.innerText.replace(/\s+/g, " ").trim())
    );

    const want = {
      USD: { label: "USD", bounds: { min: 35, max: 100, maxSpread: 2.0 } },
      EUR: { label: "EUR", bounds: { min: 40, max: 110, maxSpread: 2.5 } },
      AED: { label: "AED", bounds: { min:  9, max:  20, maxSpread: 0.4 } }
    };

    const out = {};
    for (const [code, cfg] of Object.entries(want)) {
      const r = rows.find(t => t.toUpperCase().includes(cfg.label));
      if (r) out[code] = pairFromText(r, cfg.bounds);
    }

    if (!out.USD) throw new Error("USD row not found or malformed.");

    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
    res.status(200).json({ source: "CIB", url: URL, ts: new Date().toISOString(), rates: out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    try { if (browser) await browser.close(); } catch {}
  }
}
