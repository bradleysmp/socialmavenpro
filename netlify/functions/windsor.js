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
    if (date_preset) params.append('date_preset', date_preset);
    if (date_from) params.append('date_from', date_from);
    if (date_to) params.append('date_to', date_to);

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
