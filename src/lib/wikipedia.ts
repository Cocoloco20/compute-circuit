/**
 * Wikipedia Pageviews API Client.
 *
 * Free, no auth needed for public page view metrics.
 * Endpoint:
 *   GET https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/{title}/daily/{start}/{end}
 *
 * We fetch ~395 days of history to capture the current 28d window, the current 7d window,
 * and the prior 28d window from exactly 1 year ago (365 days offset) to calculate YoY growth.
 */

const UA = 'compute-circuit (research tool) luigui.h2002@gmail.com';

export interface WikiResult {
  views7d: number;
  views28d: number;
  yoyPct: number | null;
}

export async function fetchPageViews(slug: string): Promise<WikiResult | null> {
  const today = new Date();
  const start = new Date(Date.now() - 395 * 24 * 60 * 60 * 1000);
  
  const startStr = start.toISOString().slice(0, 10).replace(/-/g, '');
  const endStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${encodeURIComponent(slug)}/daily/${startStr}/${endStr}`;
  
  try {
    const res = await fetch(url, { 
      headers: { 
        'User-Agent': UA,
        'Accept': 'application/json'
      } 
    });
    
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[wikipedia] Fetch failed with status ${res.status} for slug: ${slug}`);
      return null;
    }
    
    const data = await res.json();
    if (!Array.isArray(data.items) || data.items.length === 0) {
      return null;
    }
    
    const items = data.items;
    const viewsMap = new Map<string, number>();
    for (const item of items) {
      if (item.timestamp && item.views != null) {
        const dayKey = item.timestamp.slice(0, 8); // "YYYYMMDD"
        viewsMap.set(dayKey, item.views);
      }
    }

    const lastItem = items[items.length - 1];
    const lastTs = lastItem.timestamp; // "YYYYMMDD00"
    if (!lastTs || lastTs.length < 8) return null;

    const year = parseInt(lastTs.slice(0, 4), 10);
    const month = parseInt(lastTs.slice(4, 6), 10) - 1;
    const day = parseInt(lastTs.slice(6, 8), 10);
    
    const lastDate = new Date(Date.UTC(year, month, day));

    // Helper to format date as YYYYMMDD
    const formatYmd = (d: Date) => {
      return d.toISOString().slice(0, 10).replace(/-/g, '');
    };

    // Helper to get sum for a range of offset days
    const getSum = (startOffset: number, numDays: number) => {
      let sum = 0;
      for (let i = 0; i < numDays; i++) {
        const d = new Date(lastDate.getTime());
        d.setUTCDate(d.getUTCDate() - startOffset - i);
        const key = formatYmd(d);
        sum += viewsMap.get(key) ?? 0;
      }
      return sum;
    };

    const views7d = getSum(0, 7);
    const views28d = getSum(0, 28);
    const viewsPrior28d = getSum(365, 28);

    let yoyPct: number | null = null;
    if (viewsPrior28d > 0) {
      yoyPct = parseFloat((((views28d - viewsPrior28d) / viewsPrior28d) * 100).toFixed(2));
    }

    return {
      views7d,
      views28d,
      yoyPct
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[wikipedia] Error fetching pageviews for ${slug}:`, err);
    return null;
  }
}
