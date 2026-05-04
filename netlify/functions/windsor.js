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
    const { api_key, connector, date_preset, date_from, date_to, fields, account_id, options, filters, strip_zero_spend, top_n_by_spend, min_spend } = JSON.parse(event.body);

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

    // Build URL params
    const params = new URLSearchParams();
    params.append('api_key', api_key);
    params.append('fields', fields);

    if (resolvedFrom) params.append('date_from', resolvedFrom);
    if (resolvedTo)   params.append('date_to',   resolvedTo);
    if (!resolvedFrom && !resolvedTo && date_preset && !needsDates) params.append('date_preset', date_preset);

    const filterableConnectors = ['facebook', 'pinterest', 'tiktok', 'google_ads'];
    const supportsFilter = filterableConnectors.some(c => connector.startsWith(c));

    // Build filter — combine account filter and min_spend if both apply
    // Connector-specific field name for account filtering
    const accountFilterField = connector === 'tiktok' ? 'account_id' : 'accountid';
    let filterArr = null;
    if (filters) {
      filterArr = filters;
    } else if (top_n_by_spend && supportsFilter) {
      // Product-level request — filter by min spend at Windsor level
      const minSp = parseFloat(min_spend) || 1.0;
      if (account_id) {
        filterArr = [[accountFilterField, 'eq', account_id], 'and', ['spend', 'gt', minSp]];
      } else {
        filterArr = [['spend', 'gt', minSp]];
      }
    } else if (account_id && supportsFilter) {
      filterArr = [[accountFilterField, 'eq', account_id]];
    }

    if (account_id) params.append('account_id', account_id);
    if (filterArr) params.append('filter', JSON.stringify(filterArr));

    if (options && typeof options === 'object') {
      Object.entries(options).forEach(([k, v]) => {
        if (k !== 'strip_zero_spend' && k !== 'top_n_by_spend' && k !== 'min_spend') params.append(k, v);
      });
    }

    // Fetch with hard timeout — Windsor sometimes hangs and we'd hit Netlify's 10s limit
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8500); // 8.5s — leaves buffer

    let response;
    try {
      response = await fetch(`https://connectors.windsor.ai/${connector}?${params}`, { signal: controller.signal });
    } catch(e) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        return {
          statusCode: 504,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ error: 'Windsor request timed out — try a shorter date range or higher minimum spend threshold' }),
        };
      }
      throw e;
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      return {
        statusCode: response.status,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: `Windsor returned ${response.status}`, detail: text.slice(0, 300) }),
      };
    }

    let data = await response.json();

    // Aggregate by product_id and slice top N
    if (top_n_by_spend && Array.isArray(data)) {
      const productMap = {};
      data.forEach(r => {
        const pid = r.product_id || '';
        if (!pid) return;
        const spend = parseFloat(r.spend || 0);
        if (spend <= 0) return;
        if (!productMap[pid]) {
          productMap[pid] = { product_id: pid, account_id: r.account_id || account_id, spend: 0, impressions: 0, clicks: 0 };
        }
        productMap[pid].spend       += spend;
        productMap[pid].impressions += parseFloat(r.impressions || 0);
        productMap[pid].clicks      += parseFloat(r.clicks || 0);
      });
      data = Object.values(productMap)
        .sort((a, b) => b.spend - a.spend)
        .slice(0, top_n_by_spend);
    } else {
      // Strip zero-spend rows
      const shouldStrip = strip_zero_spend || (options && options.strip_zero_spend);
      if (shouldStrip && Array.isArray(data)) {
        data = data.filter(r => parseFloat(r.spend || 0) > 0);
      }

      // Safety net account filter for non-aggregated responses
      if (account_id && Array.isArray(data)) {
        const hasAccountField = data.some(r => r.account_id || r.accountid);
        if (hasAccountField) {
          data = data.filter(r => {
            const rid = String(r.account_id || r.accountid || '');
            return rid === '' || rid === String(account_id);
          });
        }
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
