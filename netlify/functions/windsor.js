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
    const { api_key, connector, date_preset, date_from, date_to, fields, account_id, options } = JSON.parse(event.body);

    const params = new URLSearchParams();
    params.append('api_key', api_key);
    params.append('fields', fields);
    // Connectors that need explicit dates instead of date presets
    const needsExplicitDates = ['google_merchant', 'googleanalytics'];
    const needsDates = needsExplicitDates.some(c => connector.startsWith(c));

    let resolvedDateFrom = date_from;
    let resolvedDateTo = date_to;

    if (needsDates && date_preset && !date_from && !date_to) {
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const daysAgo = (n) => { const d = new Date(now); d.setDate(d.getDate()-n); return d.toISOString().split('T')[0]; };
      const monthStart = (offset=0) => { const d = new Date(now.getFullYear(), now.getMonth()+offset, 1); return d.toISOString().split('T')[0]; };
      const monthEnd = (offset=0) => { const d = new Date(now.getFullYear(), now.getMonth()+offset+1, 0); return d.toISOString().split('T')[0]; };

      const presetMap = {
        'last_7d':   [daysAgo(7), daysAgo(1)],
        'last_30d':  [daysAgo(30), daysAgo(1)],
        'last_3m':   [daysAgo(90), daysAgo(1)],
        'last_year': [daysAgo(365), daysAgo(1)],
        'this_month':[monthStart(), today],
        'last_1m':   [monthStart(-1), monthEnd(-1)],
      };
      const resolved = presetMap[date_preset];
      if (resolved) { resolvedDateFrom = resolved[0]; resolvedDateTo = resolved[1]; }
    }

    if (date_preset && !needsDates) params.append('date_preset', date_preset);
    if (resolvedDateFrom) params.append('date_from', resolvedDateFrom);
    if (resolvedDateTo) params.append('date_to', resolvedDateTo);

    // Connectors that support account_id filtering via filter param
    const filterableConnectors = ['facebook', 'pinterest', 'tiktok', 'google_ads'];
    const supportsFilter = filterableConnectors.some(c => connector.startsWith(c));

    if (account_id) {
      params.append('account_id', account_id);
      if (supportsFilter) {
        params.append('filter', JSON.stringify([['accountid', 'eq', account_id]]));
      }
    }

    if (options && typeof options === 'object') {
      Object.entries(options).forEach(([k, v]) => params.append(k, v));
    }

    const url = `https://connectors.windsor.ai/${connector}?${params}`;
    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      return {
        statusCode: response.status,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: `Windsor returned ${response.status}`, detail: text }),
      };
    }

    let data = await response.json();

    // Safety net — filter by account_id client-side in case Windsor returns mixed accounts
    if (account_id && Array.isArray(data)) {
      const filtered = data.filter(r => {
        const rid = String(r.account_id || r.accountid || '');
        return rid === '' || rid === String(account_id);
      });
      // Only apply filter if it doesn't remove everything (i.e. account_id field exists)
      const hasAccountField = data.some(r => r.account_id || r.accountid);
      data = hasAccountField ? filtered : data;
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
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
