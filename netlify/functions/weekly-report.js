// Netlify Scheduled Function — Babble & Goose weekly paid social report
// Runs every Sunday at 6pm UK time, emails last 7 days of Meta + TikTok performance
//
// REQUIRED ENVIRONMENT VARIABLES (set in Netlify dashboard):
//   WINDSOR_API_KEY  — your Windsor.ai API key
//   RESEND_API_KEY   — your Resend.com API key (free at resend.com)
//   REPORT_FROM      — verified sender email (e.g. reports@socialmavenpro.co.uk)
//   REPORT_TO        — comma-separated recipient list (e.g. jeanette@...,brad@...)

const BG_META   = '783788426913932';
const BG_TIKTOK = '7231226751496503297';

// Schedule: every Sunday at 6pm UK (= 17:00 UTC during BST, 18:00 UTC otherwise)
// Using 17:00 UTC = 6pm BST in summer / 5pm GMT in winter — close enough
exports.config = { schedule: '0 17 * * 0' };

const fmt = n => `£${Math.round(n).toLocaleString()}`;
const pct = n => `${(n * 100).toFixed(2)}%`;
const roas = (rev, sp) => sp > 0 ? (rev / sp).toFixed(2) + 'x' : '–';

async function fetchWindsor(connector, accountId, fields, dateFrom, dateTo, filters) {
  const params = new URLSearchParams();
  params.append('api_key', process.env.WINDSOR_API_KEY);
  params.append('fields', fields.join(','));
  params.append('date_from', dateFrom);
  params.append('date_to', dateTo);
  if (accountId) params.append('account_id', accountId);
  if (filters) params.append('filter', JSON.stringify(filters));

  const res = await fetch(`https://connectors.windsor.ai/${connector}?${params}`);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Windsor ${connector} ${res.status}: ${txt.slice(0,200)}`);
  }
  const json = await res.json();
  return Array.isArray(json) ? json : (json.data || []);
}

function dateRange(daysAgo, span = 7) {
  const end = new Date();
  end.setDate(end.getDate() - daysAgo);
  const start = new Date(end);
  start.setDate(start.getDate() - (span - 1));
  return [start.toISOString().split('T')[0], end.toISOString().split('T')[0]];
}

function aggregate(rows, keys) {
  return rows.reduce((acc, r) => {
    keys.forEach(k => { acc[k] = (acc[k] || 0) + parseFloat(r[k] || 0); });
    return acc;
  }, {});
}

function topByROAS(rows, isTikTok = false) {
  return rows
    .map(r => {
      const spend = parseFloat(r.spend || 0);
      const rev = isTikTok
        ? spend * parseFloat(r.complete_payment_roas || 0)
        : parseFloat(r.action_values_offsite_conversion_fb_pixel_purchase || 0);
      const purch = isTikTok
        ? parseFloat(r.complete_payment || 0)
        : parseFloat(r.actions_purchase || 0);
      return {
        name: r.ad_name || r.campaign || 'Unknown',
        spend, rev, purch,
        roas: spend > 0 ? rev / spend : 0,
      };
    })
    .filter(a => a.spend >= 20)
    .sort((a, b) => b.roas - a.roas);
}

function buildEmailHTML({ meta, tiktok, metaPrev, tiktokPrev, metaTopAds, tiktokTopAds, dateFrom, dateTo, prevFrom, prevTo }) {
  // Compute key metrics
  const m = {
    spend: meta.spend,
    rev: meta.action_values_offsite_conversion_fb_pixel_purchase,
    purch: meta.actions_purchase,
    imp: meta.impressions,
    clk: meta.clicks,
  };
  const mPrev = {
    spend: metaPrev.spend,
    rev: metaPrev.action_values_offsite_conversion_fb_pixel_purchase,
    purch: metaPrev.actions_purchase,
  };
  const t = {
    spend: tiktok.spend,
    rev: tiktok.spend * (tiktok.complete_payment_roas_weighted_total / tiktok.spend || 0),
    purch: tiktok.complete_payment,
    imp: tiktok.impressions,
    clk: tiktok.clicks,
  };
  // For TikTok, recompute revenue from raw rows (already done)
  t.rev = tiktok._revenue || 0;
  const tPrev = {
    spend: tiktokPrev.spend,
    rev: tiktokPrev._revenue || 0,
    purch: tiktokPrev.complete_payment,
  };

  const totalSpend = m.spend + t.spend;
  const totalRev = m.rev + t.rev;
  const totalPurch = m.purch + t.purch;
  const totalSpendPrev = mPrev.spend + tPrev.spend;
  const totalRevPrev = mPrev.rev + tPrev.rev;
  const totalPurchPrev = mPrev.purch + tPrev.purch;

  const delta = (now, prev) => {
    if (prev === 0) return '';
    const d = (now - prev) / prev * 100;
    const arrow = d > 0 ? '▲' : '▼';
    const color = d > 0 ? '#1d9e75' : '#e24b4a';
    return `<span style="color:${color};font-size:11px;font-weight:500;">${arrow} ${Math.abs(d).toFixed(0)}%</span>`;
  };

  const metricCard = (label, value, sub) => `
    <td style="padding:14px 12px;background:#1a1d22;border-radius:6px;width:20%;vertical-align:top;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.6px;color:#86878a;margin-bottom:4px;">${label}</div>
      <div style="font-family:Georgia,serif;font-size:22px;font-weight:600;color:#f0ede8;line-height:1.1;">${value}</div>
      <div style="font-size:11px;color:#86878a;margin-top:4px;">${sub}</div>
    </td>`;

  const adRow = (ad, isTikTok) => {
    const roasStr = ad.roas.toFixed(2) + 'x';
    const color = ad.roas >= 2.5 ? '#1d9e75' : ad.roas >= 1.87 ? '#c97b0a' : '#e24b4a';
    return `
      <tr style="border-bottom:1px solid #2a2d33;">
        <td style="padding:8px 10px;font-size:12px;color:#f0ede8;">${(ad.name || '').slice(0, 50)}</td>
        <td style="padding:8px 10px;font-size:12px;color:#b6b8bb;text-align:right;">${fmt(ad.spend)}</td>
        <td style="padding:8px 10px;font-size:12px;font-weight:500;color:${color};text-align:right;">${roasStr}</td>
        <td style="padding:8px 10px;font-size:12px;color:#b6b8bb;text-align:right;">${Math.round(ad.purch)}</td>
      </tr>`;
  };

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>B&G Weekly Paid Social</title></head>
<body style="margin:0;padding:0;background:#0e0f11;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#f0ede8;">
  <div style="max-width:680px;margin:0 auto;padding:32px 24px;">

    <!-- Header -->
    <div style="margin-bottom:24px;">
      <div style="display:inline-block;background:#FF6B35;color:#0e0f11;font-weight:700;padding:4px 10px;border-radius:3px;font-size:11px;letter-spacing:0.5px;">SMPro</div>
      <h1 style="font-family:Georgia,serif;font-size:24px;font-weight:600;color:#f0ede8;margin:14px 0 4px;">Babble &amp; Goose · Weekly Paid Social</h1>
      <div style="font-size:13px;color:#86878a;">${dateFrom} — ${dateTo} · vs ${prevFrom} — ${prevTo}</div>
    </div>

    <!-- Headline metrics -->
    <table style="width:100%;border-collapse:separate;border-spacing:6px;margin-bottom:24px;">
      <tr>
        ${metricCard('Total Spend', fmt(totalSpend), delta(totalSpend, totalSpendPrev))}
        ${metricCard('Revenue', fmt(totalRev), delta(totalRev, totalRevPrev))}
        ${metricCard('Blended ROAS', roas(totalRev, totalSpend), delta(totalRev/totalSpend, totalRevPrev/totalSpendPrev))}
        ${metricCard('Purchases', Math.round(totalPurch).toString(), delta(totalPurch, totalPurchPrev))}
        ${metricCard('Blended CPA', totalPurch > 0 ? fmt(totalSpend / totalPurch) : '–', '')}
      </tr>
    </table>

    <!-- Platform split -->
    <div style="background:#1a1d22;border-radius:6px;padding:16px;margin-bottom:20px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#86878a;margin-bottom:12px;">Platform Split</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr style="border-bottom:1px solid #2a2d33;">
          <td style="padding:8px 0;font-size:13px;color:#f0ede8;width:30%;"><strong>Meta</strong></td>
          <td style="padding:8px 12px;font-size:12px;color:#b6b8bb;text-align:right;">${fmt(m.spend)} spend</td>
          <td style="padding:8px 12px;font-size:12px;color:#b6b8bb;text-align:right;">${fmt(m.rev)} rev</td>
          <td style="padding:8px 12px;font-size:13px;font-weight:500;color:${m.rev/m.spend >= 2.5 ? '#1d9e75' : '#c97b0a'};text-align:right;">${roas(m.rev, m.spend)}</td>
          <td style="padding:8px 0;font-size:12px;color:#b6b8bb;text-align:right;">${Math.round(m.purch)} purch</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#f0ede8;"><strong>TikTok</strong></td>
          <td style="padding:8px 12px;font-size:12px;color:#b6b8bb;text-align:right;">${fmt(t.spend)} spend</td>
          <td style="padding:8px 12px;font-size:12px;color:#b6b8bb;text-align:right;">${fmt(t.rev)} rev</td>
          <td style="padding:8px 12px;font-size:13px;font-weight:500;color:${t.rev/t.spend >= 2.5 ? '#1d9e75' : '#c97b0a'};text-align:right;">${roas(t.rev, t.spend)}</td>
          <td style="padding:8px 0;font-size:12px;color:#b6b8bb;text-align:right;">${Math.round(t.purch)} purch</td>
        </tr>
      </table>
    </div>

    <!-- Top Meta ads -->
    <div style="background:#1a1d22;border-radius:6px;padding:16px;margin-bottom:16px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#86878a;margin-bottom:12px;">Top Meta Ads · by ROAS</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr style="border-bottom:1px solid #2a2d33;">
          <th style="padding:6px 10px;font-size:10px;text-transform:uppercase;color:#86878a;text-align:left;font-weight:500;">Ad Name</th>
          <th style="padding:6px 10px;font-size:10px;text-transform:uppercase;color:#86878a;text-align:right;font-weight:500;">Spend</th>
          <th style="padding:6px 10px;font-size:10px;text-transform:uppercase;color:#86878a;text-align:right;font-weight:500;">ROAS</th>
          <th style="padding:6px 10px;font-size:10px;text-transform:uppercase;color:#86878a;text-align:right;font-weight:500;">Purch</th>
        </tr>
        ${metaTopAds.slice(0, 5).map(a => adRow(a, false)).join('')}
      </table>
    </div>

    <!-- Top TikTok ads -->
    <div style="background:#1a1d22;border-radius:6px;padding:16px;margin-bottom:24px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.6px;color:#86878a;margin-bottom:12px;">Top TikTok Ads · by ROAS</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr style="border-bottom:1px solid #2a2d33;">
          <th style="padding:6px 10px;font-size:10px;text-transform:uppercase;color:#86878a;text-align:left;font-weight:500;">Ad Name</th>
          <th style="padding:6px 10px;font-size:10px;text-transform:uppercase;color:#86878a;text-align:right;font-weight:500;">Spend</th>
          <th style="padding:6px 10px;font-size:10px;text-transform:uppercase;color:#86878a;text-align:right;font-weight:500;">ROAS</th>
          <th style="padding:6px 10px;font-size:10px;text-transform:uppercase;color:#86878a;text-align:right;font-weight:500;">Conv</th>
        </tr>
        ${tiktokTopAds.slice(0, 5).map(a => adRow(a, true)).join('')}
      </table>
    </div>

    <!-- Footer -->
    <div style="border-top:1px solid #2a2d33;padding-top:16px;font-size:11px;color:#86878a;line-height:1.6;">
      Generated automatically · Live dashboard: <a href="https://socialmavenpro.co.uk/dashboard" style="color:#FF6B35;text-decoration:none;">socialmavenpro.co.uk/dashboard</a><br>
      Meta attribution: 7-day click / 1-day view · TikTok: 7-day click · Do not sum platform purchases (overlap)<br>
      Prepared by Bradley Walker · Social Maven Pro
    </div>

  </div>
</body>
</html>`;
}

exports.handler = async function() {
  try {
    // Date ranges
    const [from, to] = dateRange(1);          // last 7 days ending yesterday
    const [prevFrom, prevTo] = dateRange(8);  // the 7 days before that

    // Meta fields
    const metaFields = ['spend','impressions','clicks','reach','actions_purchase','action_values_offsite_conversion_fb_pixel_purchase'];
    const metaAdFields = ['ad_name','spend','impressions','clicks','actions_purchase','action_values_offsite_conversion_fb_pixel_purchase'];

    // TikTok fields
    const ttFields = ['spend','impressions','clicks','reach','complete_payment','complete_payment_roas'];
    const ttAdFields = ['ad_name','spend','complete_payment','complete_payment_roas'];

    // Parallel fetch — current + previous week, totals + ad-level
    const [metaTotal, metaPrevTotal, metaAds, ttTotal, ttPrevTotal, ttAds] = await Promise.all([
      fetchWindsor('facebook', BG_META, metaFields, from, to, [['accountid','eq',BG_META]]),
      fetchWindsor('facebook', BG_META, metaFields, prevFrom, prevTo, [['accountid','eq',BG_META]]),
      fetchWindsor('facebook', BG_META, metaAdFields, from, to, [['accountid','eq',BG_META],'and',['spend','gt',20]]),
      fetchWindsor('tiktok',   BG_TIKTOK, ttFields, from, to, [['account_id','eq',BG_TIKTOK]]),
      fetchWindsor('tiktok',   BG_TIKTOK, ttFields, prevFrom, prevTo, [['account_id','eq',BG_TIKTOK]]),
      fetchWindsor('tiktok',   BG_TIKTOK, ttAdFields, from, to, [['account_id','eq',BG_TIKTOK],'and',['spend','gt',20]]),
    ]);

    // Aggregate Meta totals
    const meta = aggregate(metaTotal, ['spend','impressions','clicks','reach','actions_purchase','action_values_offsite_conversion_fb_pixel_purchase']);
    const metaPrev = aggregate(metaPrevTotal, ['spend','impressions','clicks','reach','actions_purchase','action_values_offsite_conversion_fb_pixel_purchase']);

    // Aggregate TikTok totals — revenue is spend × roas per row, summed
    const aggregateTikTok = rows => {
      const agg = aggregate(rows, ['spend','impressions','clicks','reach','complete_payment']);
      agg._revenue = rows.reduce((s,r) => s + parseFloat(r.spend||0) * parseFloat(r.complete_payment_roas||0), 0);
      return agg;
    };
    const tiktok = aggregateTikTok(ttTotal);
    const tiktokPrev = aggregateTikTok(ttPrevTotal);

    // Top ads by ROAS
    const metaTopAds = topByROAS(metaAds, false);
    const tiktokTopAds = topByROAS(ttAds, true);

    // Build email HTML
    const html = buildEmailHTML({
      meta, tiktok, metaPrev, tiktokPrev, metaTopAds, tiktokTopAds,
      dateFrom: from, dateTo: to, prevFrom, prevTo,
    });

    // Send via Resend
    const recipients = (process.env.REPORT_TO || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!recipients.length) throw new Error('REPORT_TO env var not set');

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.REPORT_FROM,
        to: recipients,
        subject: `Babble & Goose · Paid Social Weekly · ${from} — ${to}`,
        html,
      }),
    });

    if (!sendRes.ok) {
      const errText = await sendRes.text();
      throw new Error(`Resend ${sendRes.status}: ${errText}`);
    }

    return { statusCode: 200, body: JSON.stringify({ sent: true, recipients, date_range: [from, to] }) };

  } catch (err) {
    console.error('Weekly report failed:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
