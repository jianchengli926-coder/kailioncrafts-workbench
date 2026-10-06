// Phase 6 Loader - fetches consolidated JSON and injects into localStorage
(async function() {
  const PREFIX = 'kailion_ark_';
  try {
    const resp = await fetch('/phase6_data.json');
    const data = await resp.json();
    const newCustomers = data.customers || [];
    const newDrafts = data.drafts || [];

    let existingCustomers = [];
    try {
      const raw = localStorage.getItem(PREFIX + 'customers');
      if (raw) existingCustomers = JSON.parse(raw);
    } catch(e) { console.warn('load customers err:', e); }

    let existingDrafts = [];
    try {
      const raw = localStorage.getItem(PREFIX + 'drafts');
      if (raw) existingDrafts = JSON.parse(raw);
    } catch(e) { console.warn('load drafts err:', e); }

    const existingCompanies = new Set(existingCustomers.map(c => (c.company||'').toLowerCase()));
    const added = [];
    const skipped = [];
    newCustomers.forEach(c => {
      if (existingCompanies.has((c.company||'').toLowerCase())) {
        skipped.push(c.company);
      } else {
        existingCustomers.push(c);
        added.push(c.id);
      }
    });

    const addedSet = new Set(added);
    newDrafts.forEach(d => {
      if (addedSet.has(d.customerId)) existingDrafts.push(d);
    });

    localStorage.setItem(PREFIX + 'customers', JSON.stringify(existingCustomers));
    localStorage.setItem(PREFIX + 'drafts', JSON.stringify(existingDrafts));

    console.log('PHASE6 IMPORT: added=' + added.length + ' skipped=' + skipped.length +
      ' totalCustomers=' + existingCustomers.length + ' totalDrafts=' + existingDrafts.length);
    return {added: added.length, skipped: skipped.length, totalCustomers: existingCustomers.length, totalDrafts: existingDrafts.length};
  } catch(e) {
    console.error('PHASE6 IMPORT FAILED:', e);
    return {error: e.message};
  }
})();
