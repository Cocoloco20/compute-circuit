/**
 * Google Trends unofficial API client.
 *
 * Implements the two-step explore + widgetdata dance:
 *   1. Fetch the widget token from /trends/api/explore
 *   2. Fetch the multiline chart data from /trends/api/widgetdata/multiline
 *
 * Designed to degrade gracefully (returns { score: null, delta7d: null })
 * under aggressive rate-limiting (429/403) from Google.
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface TrendsResult {
  score: number | null;
  delta7d: number | null;
}

export async function fetchTrendsScore(term: string): Promise<TrendsResult> {
  try {
    const exploreObj = {
      comparisonItem: [{ keyword: term, geo: '', time: 'today 1-m' }],
      category: 0,
      property: ''
    };
    
    const exploreUrl = `https://trends.google.com/trends/api/explore?hl=en-US&req=${encodeURIComponent(JSON.stringify(exploreObj))}&tz=300`;
    
    const res1 = await fetch(exploreUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://trends.google.com/trends/explore',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    
    if (!res1.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[google-trends] Explore failed with status ${res1.status} for term: ${term}`);
      return { score: null, delta7d: null };
    }
    
    const text1 = await res1.text();
    const cleanText1 = text1.startsWith(')]}\'') ? text1.slice(5) : text1;
    const data1 = JSON.parse(cleanText1);
    
    // Find TIMESERIES widget which contains the data we need
    const widget = data1.widgets?.find((w: { id: string; token: string; request: Record<string, unknown> }) => w.id === 'TIMESERIES');
    if (!widget || !widget.token || !widget.request) {
      // eslint-disable-next-line no-console
      console.warn(`[google-trends] TIMESERIES widget not found for term: ${term}`);
      return { score: null, delta7d: null };
    }
    
    const widgetUrl = `https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&req=${encodeURIComponent(JSON.stringify(widget.request))}&token=${widget.token}&tz=300`;
    
    const res2 = await fetch(widgetUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://trends.google.com/trends/explore',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    
    if (!res2.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[google-trends] Widgetdata failed with status ${res2.status} for term: ${term}`);
      return { score: null, delta7d: null };
    }
    
    const text2 = await res2.text();
    const cleanText2 = text2.startsWith(')]}\'') ? text2.slice(5) : text2;
    const data2 = JSON.parse(cleanText2);
    
    const timelineData = data2.default?.timelineData;
    if (!Array.isArray(timelineData) || timelineData.length < 8) {
      // eslint-disable-next-line no-console
      console.warn(`[google-trends] Insufficient timeline data for term: ${term}`);
      return { score: null, delta7d: null };
    }
    
    const latestEntry = timelineData[timelineData.length - 1];
    const prevEntry = timelineData[timelineData.length - 8]; // 7 days ago
    
    const score = latestEntry.value?.[0] !== undefined ? Number(latestEntry.value[0]) : null;
    const prevScore = prevEntry.value?.[0] !== undefined ? Number(prevEntry.value[0]) : null;
    
    const delta7d = (score !== null && prevScore !== null) ? (score - prevScore) : null;
    
    return { score, delta7d };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[google-trends] Fetch failed for term: ${term}. Gracefully degrading.`, err);
    return { score: null, delta7d: null };
  }
}
