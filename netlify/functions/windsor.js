exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { api_key, connector, date_preset, date_from, date_to, fields, account_id, options, filters, strip_zero_spend, top_n_by_spend } = JSON.parse(event.body);

    const now = new Date();
    const fmtDate = (d) => d.toISOString().split('T')[0];
    const daysAgo = (n) => { const d = new Date(now); d.setDate(d.getDate()-n); return fmtDate(d); };
    const monthStart = (offset=0) => fmtDate(new Date(now.getFullYear(), now.getMonth()+offset, 1));
    const monthEnd   = (offset=0) => fmtDate(new Date(now.getFullYear(), now.getMonth()+offset+1, 0));

    const presetMap = {
      'last_7d':    [daysAgo(7),   daysAgo(1)],
      'last_30d':   [daysAgo(30),  daysAgo(1)],
      'last_3m':    [daysAgo(90),  daysAgo(1)],
      'last_year':  [daysAgo(365), daysAgo(1)],
      'this_month': [monthStart(),  fmtDate(now)],
      'last_1m':    [monthStart(-1), monthEnd(-1)],
    };

    const needsExplicitDates = ['google_merchant', 'googleanalytics'];
    const needsDates = needsExplicitDates.some(c => connector.startsWith(c));

    let resolvedFrom = date_from;
    let resolvedTo   = date_to;
    if ((!resolvedFrom || !resolvedTo) && date_preset) {
      const preset = presetMap[date_preset];
      if (preset) { resolvedFrom = preset[0]; resolvedTo = preset[1]; }
    }

    // ── PRODUCT MODE: fetch day-by-day to avoid Windsor timeouts on large catalogues
    if (top_n_by_spend && resolvedFrom && resolvedTo) {
      const days = [];
      const start = new Date(resolvedFrom + 'T00:00:00Z');
      const end   = new Date(resolvedTo   + 'T00:00:00Z');
      for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
        days.push(fmtDate(new Date(d)));
      }

      const productMap = {};

      for (const day of days) {
        const p = new URLSearchParams();
        p.append('api_key', api_key);
        p.append('fields', fields);
        p.append('date_from', day);
        p.append('date_to', day);
        if (account_id) {
          p.append('account_id', account_id);
          p.append('filter', JSON.stringify([['accountid', 'eq', account_id], 'and', ['spend', 'gt', 0]]));
        } else {
          p.append('filter', JSON.stringify([['spend', 'gt', 0]]));
        }

        try {
          const res = await fetch(`https://connectors.windsor.ai/${connector}?${p}`);
          if (!res.ok) continue;
          const rows = await res.json();
          if (!Array.isArray(rows)) continue;
          rows.forEach(r => {
            const pid   = r.product_id || '';
            const spend = parseFloat(r.spend || 0);
            if (!pid || spend <= 0) return;
            if (!productMap[pid]) productMap[pid] = { product_id: pid, spend: 0, impressions: 0, clicks: 0 };
            productMap[pid].spend       += spend;
            productMap[pid].impressions += parseFloat(r.impressions || 0);
            productMap[pid].clicks      += parseFloat(r.clicks || 0);
          });
        } catch(e) { continue; }
      }

      const data = Object.values(productMap)
        .sort((a, b) => b.spend - a.spend)
        .slice(0, top_n_by_spend);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data),
      };
    }

    // ── STANDARD PATH
    const params = new URLSearchParams();
    params.append('api_key', api_key);
    params.append('fields', fields);

    if (resolvedFrom) params.append('date_from', resolvedFrom);
    if (resolvedTo)   params.append('date_to',   resolvedTo);
    if (!resolvedFrom && !resolvedTo && date_preset && !needsDates) params.append('date_preset', date_preset);

    const filterableConnectors = ['facebook', 'pinterest', 'tiktok', 'google_ads'];
    const supportsFilter = filterableConnectors.some(c => connector.startsWith(c));

    if (account_id) {
      params.append('account_id', account_id);
      if (supportsFilter) params.append('filter', JSON.stringify([['accountid', 'eq', account_id]]));
    }

    if (filters) params.append('filter', JSON.stringify(filters));

    if (options && typeof options === 'object') {
      Object.entries(options).forEach(([k, v]) => {
        if (k !== 'strip_zero_spend' && k !== 'top_n_by_spend') params.append(k, v);
      });
    }

    const response = await fetch(`https://connectors.windsor.ai/${connector}?${params}`);

    if (!response.ok) {
      const text = await response.text();
      return {
        statusCode: response.status,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: `Windsor returned ${response.status}`, detail: text }),
      };
    }

    let data = await response.json();

    const shouldStrip = strip_zero_spend || (options && options.strip_zero_spend);
    if (shouldStrip && Array.isArray(data)) {
      data = data.filter(r => parseFloat(r.spend || 0) > 0);
    }

    if (account_id && Array.isArray(data)) {
      const hasAccountField = data.some(r => r.account_id || r.accountid);
      if (hasAccountField) {
        data = data.filter(r => {
          const rid = String(r.account_id || r.accountid || '');
          return rid === '' || rid === String(account_id);
        });
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(data),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
