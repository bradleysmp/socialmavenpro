// Netlify Scheduled Function — Babble & Goose weekly paid social report
// Runs every Sunday at 6pm UK time, emails last 7 days of Meta + TikTok performance

const BG_META   = '783788426913932';
const BG_TIKTOK = '7231226751496503297';

exports.config = { schedule: '0 17 * * 0' };

const fmt = n => `£${Math.round(n).toLocaleString()}`;
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

function buildEmailHTML({ meta, tiktok, metaPrev, tiktokPrev, dateFrom, dateTo, prevFrom, prevTo }) {
  const m = {
    spend: meta.spend,
    rev: meta.action_values_offsite_conversion_fb_pixel_purchase,
    purch: meta.actions_purchase,
  };
  const mPrev = {
    spend: metaPrev.spend,
    rev: metaPrev.action_values_offsite_conversion_fb_pixel_purchase,
    purch: metaPrev.actions_purchase,
  };
  const t = { spend: tiktok.spend, rev: tiktok._revenue || 0, purch: tiktok.complete_payment };
  const tPrev = { spend: tiktokPrev.spend, rev: tiktokPrev._revenue || 0, purch: tiktokPrev.complete_payment };

  const totalSpend = m.spend + t.spend;
  const totalRev = m.rev + t.rev;
  const totalPurch = m.purch + t.purch;
  const totalSpendPrev = mPrev.spend + tPrev.spend;
  const totalRevPrev = mPrev.rev + tPrev.rev;
  const totalPurchPrev = mPrev.purch + tPrev.purch;

  const delta = (now, prev) => {
    if (prev === 0 || !prev) return '';
    const d = (now - prev) / prev * 100;
    const arrow = d > 0 ? '▲' : '▼';
    const color = d > 0 ? '#1d9e75' : '#e24b4a';
    return `<div style="color:${color};font-size:11px;font-weight:500;margin-top:6px;">${arrow} ${Math.abs(d).toFixed(0)}%</div>`;
  };

  // Format dates nicely
  const formatDate = d => {
    const [y, m, day] = d.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${parseInt(day)} ${months[parseInt(m)-1]}`;
  };

  const metricCard = (label, value, delta) => `
    <td style="padding:0 4px;width:20%;vertical-align:top;">
      <div style="background:#15171a;border:1px solid #2a2d33;border-radius:8px;padding:18px 14px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:#86878a;margin-bottom:8px;font-weight:500;">${label}</div>
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:600;color:#f0ede8;line-height:1.1;letter-spacing:-0.5px;">${value}</div>
        ${delta}
      </div>
    </td>`;

  const platformRow = (name, data, isLast) => {
    const roasVal = data.rev / data.spend;
    const roasColor = roasVal >= 2.5 ? '#1d9e75' : roasVal >= 1.87 ? '#c97b0a' : '#e24b4a';
    return `
      <tr ${isLast ? '' : 'style="border-bottom:1px solid #2a2d33;"'}>
        <td style="padding:14px 0;font-size:14px;color:#f0ede8;font-weight:600;width:25%;">${name}</td>
        <td style="padding:14px 12px;font-size:13px;color:#b6b8bb;text-align:right;">${fmt(data.spend)}</td>
        <td style="padding:14px 12px;font-size:13px;color:#b6b8bb;text-align:right;">${fmt(data.rev)}</td>
        <td style="padding:14px 12px;font-size:14px;font-weight:600;color:${roasColor};text-align:right;">${roas(data.rev, data.spend)}</td>
        <td style="padding:14px 0;font-size:13px;color:#b6b8bb;text-align:right;">${Math.round(data.purch)} purch</td>
      </tr>`;
  };

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>B&G Weekly Paid Social</title></head>
<body style="margin:0;padding:0;background:#0e0f11;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f0ede8;">
  <div style="max-width:640px;margin:0 auto;padding:36px 24px;background:#0e0f11;">

    <!-- SMPro Logo (styled text matching dashboard) -->
    <div style="margin-bottom:32px;">
      <div style="display:inline-block;">
        <span style="font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:900;color:#f0ede8;letter-spacing:-1px;">SM</span><span style="font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:900;color:#FF6B35;letter-spacing:-1px;">Pro</span>
      </div>
      <div style="font-size:11px;color:#86878a;letter-spacing:0.5px;margin-top:4px;">Paid Social · Client Dashboard</div>
    </div>

    <!-- Title -->
    <div style="margin-bottom:28px;border-bottom:1px solid #2a2d33;padding-bottom:20px;">
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:600;color:#f0ede8;margin:0 0 6px;letter-spacing:-0.5px;">Babble &amp; Goose</h1>
      <div style="font-size:13px;color:#b6b8bb;margin-bottom:2px;">Weekly Paid Social Report</div>
      <div style="font-size:12px;color:#86878a;">${formatDate(dateFrom)} – ${formatDate(dateTo)} · vs ${formatDate(prevFrom)} – ${formatDate(prevTo)}</div>
    </div>

    <!-- Headline metrics -->
    <table style="width:100%;border-collapse:separate;border-spacing:0;margin-bottom:24px;">
      <tr>
        ${metricCard('Spend', fmt(totalSpend), delta(totalSpend, totalSpendPrev))}
        ${metricCard('Revenue', fmt(totalRev), delta(totalRev, totalRevPrev))}
        ${metricCard('Blended ROAS', roas(totalRev, totalSpend), delta(totalRev/totalSpend, totalRevPrev/totalSpendPrev))}
        ${metricCard('Purchases', Math.round(totalPurch).toString(), delta(totalPurch, totalPurchPrev))}
        ${metricCard('Blended CPA', totalPurch > 0 ? fmt(totalSpend / totalPurch) : '–', delta(totalSpend/totalPurch, totalSpendPrev/totalPurchPrev))}
      </tr>
    </table>

    <!-- Platform split -->
    <div style="background:#15171a;border:1px solid #2a2d33;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:#86878a;margin-bottom:8px;font-weight:500;">Platform Split</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr style="border-bottom:1px solid #2a2d33;">
          <th style="padding:8px 0;font-size:10px;text-transform:uppercase;color:#86878a;text-align:left;font-weight:500;letter-spacing:0.5px;width:25%;">Platform</th>
          <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:#86878a;text-align:right;font-weight:500;letter-spacing:0.5px;">Spend</th>
          <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:#86878a;text-align:right;font-weight:500;letter-spacing:0.5px;">Revenue</th>
          <th style="padding:8px 12px;font-size:10px;text-transform:uppercase;color:#86878a;text-align:right;font-weight:500;letter-spacing:0.5px;">ROAS</th>
          <th style="padding:8px 0;font-size:10px;text-transform:uppercase;color:#86878a;text-align:right;font-weight:500;letter-spacing:0.5px;">Conv</th>
        </tr>
        ${platformRow('Meta', m, false)}
        ${platformRow('TikTok', t, true)}
      </table>
    </div>

    <!-- Footer -->
    <div style="border-top:1px solid #2a2d33;padding-top:18px;margin-top:32px;font-size:11px;color:#86878a;line-height:1.7;">
      Meta attribution: 7-day click / 1-day view · TikTok: 7-day click<br>
      Platform purchases should not be summed (cross-platform overlap)<br>
      <span style="color:#b6b8bb;">Prepared by Bradley Walker · Social Maven Pro</span>
    </div>

  </div>
</body>
</html>`;
}

exports.handler = async function() {
  try {
    const [from, to] = dateRange(1);
    const [prevFrom, prevTo] = dateRange(8);

    const metaFields = ['spend','impressions','clicks','reach','actions_purchase','action_values_offsite_conversion_fb_pixel_purchase'];
    const ttFields = ['spend','impressions','clicks','reach','complete_payment','complete_payment_roas'];

    const [metaTotal, metaPrevTotal, ttTotal, ttPrevTotal] = await Promise.all([
      fetchWindsor('facebook', BG_META, metaFields, from, to, [['accountid','eq',BG_META]]),
      fetchWindsor('facebook', BG_META, metaFields, prevFrom, prevTo, [['accountid','eq',BG_META]]),
      fetchWindsor('tiktok',   BG_TIKTOK, ttFields, from, to, [['account_id','eq',BG_TIKTOK]]),
      fetchWindsor('tiktok',   BG_TIKTOK, ttFields, prevFrom, prevTo, [['account_id','eq',BG_TIKTOK]]),
    ]);

    const meta = aggregate(metaTotal, ['spend','impressions','clicks','reach','actions_purchase','action_values_offsite_conversion_fb_pixel_purchase']);
    const metaPrev = aggregate(metaPrevTotal, ['spend','impressions','clicks','reach','actions_purchase','action_values_offsite_conversion_fb_pixel_purchase']);

    const aggregateTikTok = rows => {
      const agg = aggregate(rows, ['spend','impressions','clicks','reach','complete_payment']);
      agg._revenue = rows.reduce((s,r) => s + parseFloat(r.spend||0) * parseFloat(r.complete_payment_roas||0), 0);
      return agg;
    };
    const tiktok = aggregateTikTok(ttTotal);
    const tiktokPrev = aggregateTikTok(ttPrevTotal);

    const html = buildEmailHTML({
      meta, tiktok, metaPrev, tiktokPrev,
      dateFrom: from, dateTo: to, prevFrom, prevTo,
    });

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
