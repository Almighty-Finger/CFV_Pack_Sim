let currentSetIdx = -1;
let currentFormat = 'OG';
const SERIES_FORMATS = ['ALL', 'OG', 'G', 'V', 'D'];
const PLAY_FORMATS = ['Premium', 'V-Premium', 'Standard'];

function getSetFormat(set) {
  if (!set) return 'OG';
  const f = set.format;
  if (f === 'G' || f === 'V' || f === 'D') return f;
  return 'OG';
}

function setMatchesFormat(set, fmt) {
  return getSetFormat(set) === fmt;
}

function cardIdMatchesFormat(cardId, fmt) {
  const setId = cardId.split('_')[0];
  const set = SETS.find(s => s.id === setId);
  return setMatchesFormat(set, fmt);
}

function cardIdMatchesSeries(cardId, series) {
  if (series === 'ALL') return true;
  return cardIdMatchesFormat(cardId, series);
}

function cardMatchesPlayFormat(cardId, playFmt) {
  if (playFmt === 'Premium') return true;
  if (playFmt === 'V-Premium') return cardIdMatchesFormat(cardId, 'V');
  if (playFmt === 'Standard') return cardIdMatchesFormat(cardId, 'D');
  return true;
}

function getCardPlayFormat(card) {
  if (!card) return 'Premium';
  const f = getSetFormat(SETS.find(s => s.id === card.id.split('_')[0]));
  if (f === 'D') return 'Standard';
  if (f === 'V') return 'V-Premium';
  return 'Premium';
}

function detectDeckEraFromCards() {
  let hasD = false, hasV = false;
  const check = (card) => {
    if (!card) return;
    const pf = getCardPlayFormat(card);
    if (pf === 'Standard') hasD = true;
    else if (pf === 'V-Premium') hasV = true;
  };
  check(fvCard);
  for (const { card } of Object.values(deck)) check(card);
  if (hasD) return 'Standard';
  if (hasV) return 'V-Premium';
  return 'Premium';
}

function updateFormatTabUI(prefix, fmt) {
  for (const f of SERIES_FORMATS) {
    const el = document.getElementById(prefix + f.toLowerCase());
    if (el) el.classList.toggle('active', fmt === f);
  }
}

function updatePlayFormatTabUI(prefix, playFmt) {
  for (const pf of PLAY_FORMATS) {
    const id = prefix + pf.toLowerCase().replace(/-/g, '');
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', playFmt === pf);
  }
}

function filterChipBtn(label, active, onclick) {
  return `<button type="button" class="filter-btn ${active ? 'active' : ''}" style="font-size:10px;padding:3px 10px;white-space:nowrap" onclick="${onclick}">${label}</button>`;
}

const SORT_RARITY_ORDER = ['C','R','RR','RRR','SP','LR','SCR','GR','SGR','OR','TD'];

function getCardSeriesTag(cardId) {
  const setId = cardId.split('_')[0];
  const set = SETS.find(s => s.id === setId);
  return getSetFormat(set);
}

function seriesTagHtml(cardId) {
  const series = getCardSeriesTag(cardId);
  return `<span class="card-series-tag series-${series}" title="${series} Series">${series}</span>`;
}

function parseCardNumSort(id) {
  const m = id.match(/_(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function compareCardsForSort(a, b, sortBy) {
  if (sortBy === 'rarity') {
    const ia = SORT_RARITY_ORDER.indexOf(a.rarity);
    const ib = SORT_RARITY_ORDER.indexOf(b.rarity);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  }
  if (sortBy === 'grade') {
    const g = (a.grade ?? 0) - (b.grade ?? 0);
    return g !== 0 ? g : a.name.localeCompare(b.name);
  }
  if (sortBy === 'setno') {
    const setA = a.id.split('_')[0];
    const setB = b.id.split('_')[0];
    let c = setA.localeCompare(setB, undefined, { numeric: true });
    if (c === 0) c = parseCardNumSort(a.id) - parseCardNumSort(b.id);
    return c;
  }
  if (sortBy === 'owned') {
    return (collection[b.id]?.count || 0) - (collection[a.id]?.count || 0);
  }
  return a.name.localeCompare(b.name);
}

function sortCardList(cards, sortBy, sortDir, missingFirst) {
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...cards].sort((a, b) => {
    if (missingFirst) {
      const ao = collection[a.id]?.count > 0 ? 1 : 0;
      const bo = collection[b.id]?.count > 0 ? 1 : 0;
      if (ao !== bo) return ao - bo;
    }
    const cmp = compareCardsForSort(a, b, sortBy);
    if (cmp !== 0) return cmp * dir;
    return a.id.localeCompare(b.id) * dir;
  });
}
let packPanelOpen = false;
let collection = {};
let history = [];
let totalPacks = 0;
let packsSinceLastRRR = 0;
let packsSinceLastLR = 0;
let totalPacksOpened = 0;
let wishlist = new Set();
let godPacksEnabled = true;
let sessionStats = {
  totalPulled: 0,
  byRarity: {},
  bestPull: null,
  packPrice: 350,
  wishlistHits: 0,
};

function toggleGodPacks(el) {
  godPacksEnabled = el.checked;
}

function buildSaveData() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    collection: Object.fromEntries(Object.entries(collection).map(([id,{count}])=>[id,count])),
    history,
    deck: Object.fromEntries(Object.entries(deck).map(([id,{count}])=>[id,count])),
    fvCardId: fvCard ? fvCard.id : null,
    deckName: document.getElementById('deck-name-input')?.value || 'My Deck',
    totalPacks: parseInt(document.getElementById('total-packs')?.textContent)||0,
  };
}

function applySaveData(data) {
  collectionDirty = true; SET_COMPLETION_CACHE.clear();
  // Build cardMap from ALL cards (both OG and G format) so saves always load correctly
  const cardMap = {};
  for (const c of getAllSetCards()) cardMap[c.id] = c;

  collection = {};
  if (data.collection) {
    for (const [id, count] of Object.entries(data.collection)) {
      if (cardMap[id] && count > 0) collection[id] = { card: cardMap[id], count };
    }
  }

  history = (data.history || []).map(e => ({...e, time: e.time ? new Date(e.time) : new Date()}));
  deck = {};
  if (data.deck) {
    for (const [id, count] of Object.entries(data.deck)) {
      if (cardMap[id] && count > 0) deck[id] = { card: cardMap[id], count };
    }
  }
  fvCard = (data.fvCardId && cardMap[data.fvCardId]) ? cardMap[data.fvCardId] : null;

  const dn = document.getElementById('deck-name-input');
  if (dn && data.deckName) dn.value = data.deckName;
}

function saveSession() {
  try {
    const data = buildSaveData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const defaultName = `vanguard-save-${new Date().toISOString().slice(0,10)}`;
    const customName = prompt('Enter filename:', defaultName);
    if (customName === null) { URL.revokeObjectURL(url); return; }
    const finalName = customName.trim() ? (customName.endsWith('.json') ? customName : customName + '.json') : defaultName + '.json';
    a.download = finalName;
    a.click();
    URL.revokeObjectURL(url);
    setSaveIndicator('💾 Saved to file');
  } catch(e) { console.warn('Save failed', e); setSaveIndicator('❌ Save failed'); }
}

function loadSession() {
  document.getElementById('load-file-input').click();
}

function onLoadFileChosen(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || typeof data !== 'object') throw new Error('Not a valid save object');
      applySaveData(data);
      addTDsToCollection();
      renderSetButtons();
      renderCollection();
      renderHistory();
      updateStats();
      setSaveIndicator('✅ Session loaded — ' + new Date().toLocaleTimeString());
      showToast({icon:'✅', name:'Session loaded!', rarity:'R'});
    } catch(err) {
      console.error('Load failed:', err);
      setSaveIndicator('❌ Load failed');
      showToast({icon:'❌', name:'Load failed: ' + err.message, rarity:'C'});
    }
    input.value = '';
  };
  reader.onerror = () => {
    showToast({icon:'❌', name:'Could not read file', rarity:'C'});
    input.value = '';
  };
  reader.readAsText(file);
}

function clearSession() {
  if (!confirm('Reset ALL progress? This cannot be undone.')) return;
  collection = {};
  history = [];
  deck = {};
  fvCard = null;
  totalPacks = 0;
  stagedCards = [];
  packsSinceLastRRR = 0;
  packsSinceLastLR = 0;
  totalPacksOpened = 0;
  sessionStats = { totalPulled:0, byRarity:{}, bestPull:null, packPrice:sessionStats.packPrice, wishlistHits:0 };
  document.getElementById('total-packs').textContent = '0';
  document.getElementById('total-cards-stat').textContent = '0';
  document.getElementById('rrr-count').textContent = '0';
  document.getElementById('reveal-section').classList.remove('active');
  updatePityDisplay();
  addTDsToCollection();
  renderCollection();
  updateHistory();
  updateStats();
  setSaveIndicator('');
  showToast({icon:'🗑️', name:'Session cleared', rarity:'C'});
}

function setSaveIndicator(msg) {
  const el = document.getElementById('save-indicator');
  if (el) el.textContent = msg;
}

function addTDsToCollection() {
  collectionDirty = true;
  const allCards = getAllSetCards();
  let added = 0;
  for (const card of allCards) {
    if (!card.id.startsWith('TD') && !card.id.startsWith('GTD')) continue;
    if (card.rarity === 'SP') continue;
    if (!collection[card.id]) {
      collection[card.id] = { card, count: 4 };
      added++;
    }
  }
  return added;
}

function init() {
  _buildCardMap();
  addTDsToCollection();

  document.getElementById('pack-area').style.display = 'none';
  document.getElementById('td-decklist-panel').style.display = 'none';
  const _psb = document.getElementById('pack-sim-body');
  const _psa = document.getElementById('pack-sim-arrow');
  if (_psb) _psb.classList.add('collapsed');
  if (_psa) _psa.classList.add('collapsed');

  renderSetButtons();
  renderCollection();
  renderHistory();
  updateStats();

  setSaveIndicator('✨ New session — TDs pre-loaded');
}

const TD_COUNTS = {
  'GTD01_001':2,'GTD01_002':2,'GTD01_003':4,'GTD01_004':2,'GTD01_005':4,
  'GTD01_006':2,'GTD01_007':2,'GTD01_008':2,'GTD01_009':4,'GTD01_010':4,
  'GTD01_011':3,'GTD01_012':2,'GTD01_013':2,'GTD01_014':1,'GTD01_015':4,
  'GTD01_016':2,'GTD01_017':4,'GTD01_018':4,'GTD01_019':2,
  'GTD02_001':2,'GTD02_002':2,'GTD02_003':2,'GTD02_004':4,'GTD02_005':4,
  'GTD02_006':2,'GTD02_007':2,'GTD02_008':2,'GTD02_009':4,'GTD02_010':4,
  'GTD02_011':3,'GTD02_012':2,'GTD02_013':2,'GTD02_014':1,'GTD02_015':4,
  'GTD02_016':2,'GTD02_017':4,'GTD02_018':4,'GTD02_019':2,
  'GTD03_001':2,'GTD03_002':2,'GTD03_003':4,'GTD03_004':2,'GTD03_005':4,
  'GTD03_006':2,'GTD03_007':2,'GTD03_008':2,'GTD03_009':4,'GTD03_010':4,
  'GTD03_011':2,'GTD03_012':2,'GTD03_013':3,'GTD03_014':1,'GTD03_015':4,
  'GTD03_016':4,'GTD03_017':2,'GTD03_018':4,'GTD03_019':2,
  'TD01_001':4,'TD01_002':1,'TD01_003':2,'TD01_004':4,'TD01_005':1,'TD01_006':3,'TD01_007':4,
  'TD01_008':4,'TD01_009':2,'TD01_010':4,'TD01_011':4,'TD01_012':1,'TD01_013':4,'TD01_014':4,
  'TD01_015':4,'TD01_016':4,
  'TD02_001':2,'TD02_002':1,'TD02_003':4,'TD02_004':4,'TD02_005':4,'TD02_006':4,'TD02_007':4,
  'TD02_008':2,'TD02_009':4,'TD02_010':2,'TD02_011':2,'TD02_012':1,'TD02_013':4,'TD02_014':4,
  'TD02_015':4,'TD02_016':4,
  'TD03_001':1,'TD03_002':2,'TD03_003':4,'TD03_004':4,'TD03_005':2,'TD03_006':4,'TD03_007':4,
  'TD03_008':4,'TD03_009':4,'TD03_010':3,'TD03_011':2,'TD03_012':4,'TD03_013':4,'TD03_014':4,
  'TD03_015':4,
  'TD04_001':4,'TD04_002':1,'TD04_003':2,'TD04_004':4,'TD04_005':4,'TD04_006':2,'TD04_007':4,
  'TD04_008':4,'TD04_009':4,'TD04_010':2,'TD04_011':3,'TD04_012':4,'TD04_013':4,'TD04_014':4,
  'TD04_015':4,
  'TD05_001':1,'TD05_002':2,'TD05_003':4,'TD05_004':4,'TD05_005':1,'TD05_006':4,'TD05_007':2,
  'TD05_008':4,'TD05_009':4,'TD05_010':2,'TD05_011':2,'TD05_012':2,'TD05_013':1,'TD05_014':1,
  'TD05_015':4,'TD05_016':4,'TD05_017':4,'TD05_018':4,
  'TD06_001':1,'TD06_002':2,'TD06_003':4,'TD06_004':4,'TD06_005':4,'TD06_006':1,'TD06_007':2,
  'TD06_008':4,'TD06_009':4,'TD06_010':2,'TD06_011':1,'TD06_012':2,'TD06_013':2,'TD06_014':1,
  'TD06_015':4,'TD06_016':4,'TD06_017':4,'TD06_018':4,
  'TD07_001':1,'TD07_002':2,'TD07_003':4,'TD07_004':4,'TD07_005':1,'TD07_006':2,'TD07_007':4,
  'TD07_008':4,'TD07_009':4,'TD07_010':2,'TD07_011':1,'TD07_012':2,'TD07_013':2,'TD07_014':1,
  'TD07_015':4,'TD07_016':4,'TD07_017':4,'TD07_018':4,
  'TD08_001':1,'TD08_002':2,'TD08_003':4,'TD08_004':4,'TD08_005':1,'TD08_006':1,'TD08_007':2,
  'TD08_008':4,'TD08_009':4,'TD08_010':4,'TD08_011':4,'TD08_012':2,'TD08_013':1,'TD08_014':4,
  'TD08_015':4,'TD08_016':4,'TD08_017':4,
  'TD09_001':1,'TD09_002':4,'TD09_003':2,'TD09_004':4,'TD09_005':1,'TD09_006':1,'TD09_007':2,
  'TD09_008':4,'TD09_009':4,'TD09_010':4,'TD09_011':4,'TD09_012':2,'TD09_013':1,'TD09_014':4,
  'TD09_015':4,'TD09_016':4,'TD09_017':4,
  'TD10_001':1,'TD10_002':2,'TD10_003':4,'TD10_004':4,'TD10_005':1,'TD10_006':1,'TD10_007':4,
  'TD10_008':2,'TD10_009':4,'TD10_010':4,'TD10_011':4,'TD10_012':2,'TD10_013':1,'TD10_014':4,
  'TD10_015':4,'TD10_016':4,'TD10_017':4,
  'TD11_001':1,'TD11_002':4,'TD11_003':2,'TD11_004':4,'TD11_005':1,'TD11_006':1,'TD11_007':4,
  'TD11_008':2,'TD11_009':4,'TD11_010':4,'TD11_011':4,'TD11_012':2,'TD11_013':1,'TD11_014':4,
  'TD11_015':4,'TD11_016':4,'TD11_017':4,
  'TD12_001':1,'TD12_002':2,'TD12_003':4,'TD12_004':4,'TD12_005':1,'TD12_006':1,'TD12_007':4,
  'TD12_008':2,'TD12_009':4,'TD12_010':4,'TD12_011':2,'TD12_012':4,'TD12_013':1,'TD12_014':4,
  'TD12_015':4,'TD12_016':4,'TD12_017':4,
  'TD13_001':1,'TD13_002':2,'TD13_003':4,'TD13_004':4,'TD13_005':2,'TD13_006':1,'TD13_007':4,
  'TD13_008':4,'TD13_009':2,'TD13_010':1,'TD13_011':4,'TD13_012':4,'TD13_013':1,'TD13_014':4,
  'TD13_015':4,'TD13_016':4,'TD13_017':4,
  'TD14_001':1,'TD14_002':2,'TD14_003':4,'TD14_004':4,'TD14_005':1,'TD14_006':1,'TD14_007':4,
  'TD14_008':2,'TD14_009':4,'TD14_010':4,'TD14_011':4,'TD14_012':2,'TD14_013':1,'TD14_014':4,
  'TD14_015':4,'TD14_016':4,'TD14_017':4,
  'TD16_001':1,'TD16_002':4,'TD16_003':2,'TD16_004':4,'TD16_005':1,'TD16_006':1,'TD16_007':4,
  'TD16_008':2,'TD16_009':4,'TD16_010':4,'TD16_011':4,'TD16_012':2,'TD16_013':1,'TD16_014':4,
  'TD16_015':4,'TD16_016':4,'TD16_017':4,
  'TD17_001':1,'TD17_002':4,'TD17_003':2,'TD17_004':4,'TD17_005':1,'TD17_006':1,'TD17_007':2,
  'TD17_008':4,'TD17_009':4,'TD17_010':4,'TD17_011':4,'TD17_012':2,'TD17_013':1,'TD17_014':4,
  'TD17_015':4,'TD17_016':4,'TD17_017':4,
};
let setGroupCollapsed = {};
function toggleSetGroup(key) {
  const opening = setGroupCollapsed[key];
  for (const k of ['td','bt','eb','gbt','geb','gcb']) setGroupCollapsed[k] = true;
  setGroupCollapsed[key] = !opening;
  renderSetButtons();
}
function togglePackSim() {
  const body  = document.getElementById('pack-sim-body');
  const arrow = document.getElementById('pack-sim-arrow');
  const open  = !body.classList.contains('collapsed');
  body.classList.toggle('collapsed', open);
  arrow.classList.toggle('collapsed', open);
}

function setFormat(fmt) {
  currentFormat = fmt;
  updateFormatTabUI('fmt-', fmt);
  packPanelOpen = false;
  currentSetIdx = -1;
  selectedTD = null;
  document.getElementById('pack-area').style.display = 'none';
  document.getElementById('td-decklist-panel').style.display = 'none';
  document.getElementById('reveal-section').classList.remove('active');
  renderSetButtons();
}

function renderSetButtons() {
  const el = document.getElementById('set-selector');
  function numSort(a,b){return parseInt(a.s.id.replace(/\D/g,''))-parseInt(b.s.id.replace(/\D/g,''));}
  const inFmt = s => currentFormat === 'ALL' || setMatchesFormat(s, currentFormat);
  if (!SETS.some(inFmt)) {
    el.innerHTML = `<div style="padding:20px 16px;color:var(--text-muted);font-size:13px;text-align:center;line-height:1.5">No <b style="color:var(--text)">${currentFormat} Series</b> sets in the database yet.<br><span style="font-size:11px">Add sets with <code style="font-size:10px">format:"${currentFormat}"</code> in data.js when ready.</span></div>`;
    return;
  }
  const btSets  = SETS.map((s,i)=>({s,i})).filter(({s})=>/^BT/.test(s.id)&&inFmt(s)).sort(numSort);
  const ebSets  = SETS.map((s,i)=>({s,i})).filter(({s})=>/^EB/.test(s.id)&&inFmt(s)).sort(numSort);
  const gbtSets = SETS.map((s,i)=>({s,i})).filter(({s})=>s.id.startsWith('GBT')&&inFmt(s)).sort(numSort);
  const gebSets = SETS.map((s,i)=>({s,i})).filter(({s})=>s.id.startsWith('GEB')&&inFmt(s)).sort(numSort);
  const gcbSets = SETS.map((s,i)=>({s,i})).filter(({s})=>s.id.startsWith('GCB')&&inFmt(s)).sort(numSort);
  const tdSets  = SETS.filter(s=>s.packSize===50&&inFmt(s)).sort((a,b)=>parseInt(a.id.replace(/\D/g,''))-parseInt(b.id.replace(/\D/g,'')));
  if (setGroupCollapsed['td'] === undefined) setGroupCollapsed['td'] = true;
  if (setGroupCollapsed['bt'] === undefined) setGroupCollapsed['bt'] = true;
  if (setGroupCollapsed['eb']  === undefined) setGroupCollapsed['eb']  = true;
  if (setGroupCollapsed['gbt'] === undefined) setGroupCollapsed['gbt'] = true;
  if (setGroupCollapsed['geb'] === undefined) setGroupCollapsed['geb'] = true;
  if (setGroupCollapsed['gcb'] === undefined) setGroupCollapsed['gcb'] = true;
  for (const td of tdSets) {
    const k = 'td_'+td.id;
    if (setGroupCollapsed[k] === undefined) setGroupCollapsed[k] = true;
  }

  function groupHtml(key, label, sets) {
    const collapsed = setGroupCollapsed[key];
    const arrow = collapsed ? '▶' : '▼';
    const btns = sets.map(({s,i}) => {
      const pct = getSetCompletion(s);
      const pctColor = pct===100?'var(--green)':pct>=50?'var(--gold)':'var(--text-muted)';
      const isTD = (s.format==='TD'||s.packSize===50);
      return `<button class="set-btn ${isTD?(selectedTD===s.id?'active':''):(i===currentSetIdx?'active':'')}" onclick="${isTD?`selectTD('${s.id}')`:`selectSet(${i})`}">
        <span>${s.label} – ${s.name}</span>
        <span style="font-size:9px;color:${pctColor};margin-left:auto;flex-shrink:0">${pct}%</span>
      </button>`;
    }).join('');
    return {
      header: `<div class="set-group-label" onclick="toggleSetGroup('${key}')">${arrow} ${label}</div>`,
      body:   `<div class="set-group-cards ${collapsed?'collapsed':''}" id="set-group-cards-${key}">${btns}</div>`
    };
  }

  function tdCardBadge(card) {
    if (isSentinel(card)) return `<span style="font-size:9px;padding:1px 4px;border-radius:3px;background:rgba(240,180,41,0.85);color:#000;font-weight:700">🛡 Sentinel</span>`;
    const t = getTriggerType(card); if (!t) return '';
    const colors = {Critical:'rgba(240,180,41,0.85)',Draw:'rgba(230,120,40,0.85)',Stand:'rgba(59,130,246,0.85)',Heal:'rgba(61,191,127,0.85)'};
    const labels = {Critical:'🟡 Critical',Draw:'🟠 Draw',Stand:'🔵 Stand',Heal:'💚 Heal'};
    return `<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:${colors[t]};color:#fff">${labels[t]||t}</span>`;
  }
  function tdDeckListHtml(td) {
    const maxGtd = Math.max(4, ...td.cards.map(c=>c.grade));
    const byGrade = {};
    for (let g=0; g<=maxGtd; g++) byGrade[g]=[];
    for (const c of td.cards) byGrade[c.grade].push(c);
    return Array.from({length:maxGtd+1},(_,i)=>maxGtd-i).map(g => {
      if (!byGrade[g].length) return '';
      const allGUnitsTD = byGrade[g].every(c=>isGUnit(c));
      const glabel = allGUnitsTD ? `G Units (Grade ${g})` : `Grade ${g}`;
      const cardRows = byGrade[g].map(c => `
        <div class="td-card-row" onclick="openZoom(getAllCardById('${c.id}'))">
          <span class="td-card-qty">${TD_COUNTS[c.id]||1}x</span>
          <span>${c.icon}</span>
          <span style="flex:1">${c.name}</span>
          ${tdCardBadge(c)}
        </div>`).join('');
      return `<div style="font-size:9px;font-weight:700;color:var(--text-muted);margin:6px 0 3px;text-transform:uppercase">${glabel}</div>${cardRows}`;
    }).join('');
  }

  function tdGroupHtml() {
    const collapsed = setGroupCollapsed['td'];
    const arrow = collapsed ? '▶' : '▼';
    const inner = tdSets.map(td => {
      const key = `td_${td.id}`;
      const open = !setGroupCollapsed[key];
      const tdUnique = [...new Set(td.cards.map(c=>c.name))];
      const tdOwned  = tdUnique.filter(n => td.cards.some(c=>c.name===n && collection[c.id]?.count>0));
      const tdPct    = tdUnique.length ? Math.round((tdOwned.length/tdUnique.length)*100) : 0;
      const tdColor  = tdPct===100?'var(--green)':tdPct>=50?'var(--gold)':'var(--text-muted)';
      return `
        <div style="margin-bottom:6px">
          <button class="set-btn ${selectedTD===td.id?'active':''}" style="width:100%;text-align:left"
            onclick="selectTD('${td.id}')">
            <span>${td.label} – ${td.name}</span>
            <span style="font-size:9px;color:${tdColor};margin-left:auto;flex-shrink:0">${tdPct}%</span>
          </button>
        </div>`;
    }).join('');
    return {
      header: `<div class="set-group-label" onclick="toggleSetGroup('td')">${arrow} ${currentFormat==='G'?'G Trial Decks (GTD)':'Trial Decks (TD)'}</div>`,
      body:   `<div class="set-group-cards ${collapsed?'collapsed':''}" id="set-group-cards-td">${inner}</div>`
    };
  }

  const tdG  = tdGroupHtml();
  if (currentFormat === 'G') {
    const gbtG = groupHtml('gbt','G Boosters (GBT)',gbtSets);
    const gebG = groupHtml('geb','G Extra Boosters (GEB)',gebSets);
    const gcbG = groupHtml('gcb','G Clan Boosters (GCB)',gcbSets);
    el.innerHTML = `
      <div class="set-group-headers">
        ${tdG.header}${gbtG.header}${gebG.header}${gcbG.header}
      </div>
      ${tdG.body}${gbtG.body}${gebG.body}${gcbG.body}
    `;
  } else if (currentFormat === 'OG') {
    const btG  = groupHtml('bt','Booster Sets (BT)',btSets);
    const ebG  = groupHtml('eb','Extra Boosters (EB)',ebSets);
    el.innerHTML = `
      <div class="set-group-headers">
        ${tdG.header}${btG.header}${ebG.header}
      </div>
      ${tdG.body}${btG.body}${ebG.body}
    `;
  } else {
    const seriesLabel = currentFormat === 'V' ? 'V Series' : 'D Series';
    const allSets = SETS.map((s,i)=>({s,i})).filter(({s})=>setMatchesFormat(s,currentFormat)).sort(numSort);
    const allG = groupHtml(currentFormat.toLowerCase(), seriesLabel, allSets);
    el.innerHTML = `<div class="set-group-headers">${allG.header}</div>${allG.body}`;
  }
}

let selectedTD = null;

function selectTD(tdId) {
  if (selectedTD === tdId && packPanelOpen) {
    packPanelOpen = false;
    selectedTD = null;
    currentSetIdx = -1;
    document.getElementById('pack-area').style.display = 'none';
    document.getElementById('td-decklist-panel').style.display = 'none';
    document.getElementById('reveal-section').classList.remove('active');
    renderSetButtons();
    return;
  }

  selectedTD = tdId;
  packPanelOpen = true;
  currentSetIdx = -1;
  document.getElementById('pack-area').style.display = 'none';
  document.getElementById('reveal-section').classList.remove('active');
  const td = SETS.find(s => s.id === tdId);
  if (!td) return;
  const maxGselTD = Math.max(4, ...td.cards.map(c=>c.grade));
  const byGrade = {};
  for (let g=0; g<=maxGselTD; g++) byGrade[g]=[];
  for (const c of td.cards) byGrade[c.grade].push(c);
  let html = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
    <img id="td-box-img-${td.id}" src="" style="height:80px;border-radius:6px;display:none">
    <div>
      <div style="font-family:'Rajdhani',sans-serif;font-size:20px;font-weight:700">${td.label} – ${td.name}</div>
      <div style="font-size:12px;color:var(--text-muted)">${td.desc}</div>
    </div>
  </div>`;
  for (const g of Array.from({length:maxGselTD+1},(_,i)=>maxGselTD-i)) {
    if (!byGrade[g].length) continue;
    const allGUnitsSel = byGrade[g].every(c=>isGUnit(c));
    const glbl = allGUnitsSel?`G Units (Grade ${g})`:`Grade ${g}`;
    html += `<div style="font-size:10px;font-weight:700;color:var(--text-muted);margin:10px 0 4px;text-transform:uppercase;letter-spacing:.05em">${glbl}</div>`;
    for (const c of byGrade[g]) {
      const badge = (() => {
        if (isSentinel(c)) return '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(240,180,41,0.85);color:#000;font-weight:700">🛡 Sentinel</span>';
        const t = getTriggerType(c); if (!t) return '';
        const bg = {Critical:'rgba(240,180,41,0.85)',Draw:'rgba(230,120,40,0.85)',Stand:'rgba(59,130,246,0.85)',Heal:'rgba(61,191,127,0.85)'}[t]||'#555';
        const lbl = {Critical:'🟡 Critical',Draw:'🟠 Draw',Stand:'🔵 Stand',Heal:'💚 Heal'}[t]||t;
        return `<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:${bg};color:#fff;font-weight:700">${lbl}</span>`;
      })();
      html += `<div class="td-card-row" onclick="openZoom(getAllCardById('${c.id}'))" style="padding:3px 6px;border-radius:5px">
        <span class="td-card-qty">${TD_COUNTS[c.id]||1}x</span>
        <span style="margin-right:4px">${c.icon}</span>
        <span style="flex:1">${c.name}</span>
        ${badge}
      </div>`;
    }
  }
  document.getElementById('td-decklist-content').innerHTML = html;
  document.getElementById('td-decklist-panel').style.display = 'block';
  const _tdBoxEl = document.getElementById(`td-box-img-${tdId}`);
  if (_tdBoxEl) {
    const p = new Image();
    p.onload  = () => { _tdBoxEl.src = p.src; _tdBoxEl.style.display = ''; };
    p.src = `${IMG_BOXES}box-${tdId}.webp`;
  }
  renderSetButtons();
  const _tdSet = SETS.find(s => s.id === tdId);
  if (_tdSet) preloadSetImages(_tdSet);
}

function selectSet(idx) {
  const set = SETS[idx];
  if (!set) return;

  if (currentSetIdx === idx && packPanelOpen) {
    packPanelOpen = false;
    currentSetIdx = -1;
    document.getElementById('pack-area').style.display = 'none';
    document.getElementById('td-decklist-panel').style.display = 'none';
    document.getElementById('reveal-section').classList.remove('active');
    renderSetButtons();
    return;
  }

  currentSetIdx = idx;
  selectedTD = null;
  packPanelOpen = true;

  document.getElementById('pack-area').style.display = '';
  document.getElementById('td-decklist-panel').style.display = 'none';

  document.getElementById('pack-icon').textContent = set.icon;
  document.getElementById('pack-label').textContent = set.label;
  document.getElementById('set-title').textContent = set.name;
  document.getElementById('set-desc').textContent = set.desc;
  const lrTag = document.getElementById('lr-legend-tag');
  if (lrTag) lrTag.style.display = set.cards.some(c => c.rarity === 'LR') ? '' : 'none';
  document.getElementById('reveal-section').classList.remove('active');
  const grid = document.getElementById('cards-grid');
  if (grid) { grid.className = 'cards-grid'; grid.innerHTML = ''; }
  const boxImg = document.getElementById('box-img');
  const boxFallback = document.getElementById('box-fallback');
  boxImg.style.display = 'none'; boxImg.src = '';
  boxFallback.style.display = 'flex';
  const _m = set.id.match(/^([A-Z]+)(\d+)$/);
  const _bNames = [`box-${set.id}.webp`];
  let _bTry = 0;
  (function _tryBox() {
    if (_bTry >= _bNames.length) return;
    const probe = new Image();
    const url = `${IMG_BOXES}${_bNames[_bTry]}`;
    probe.onload  = () => { boxImg.src = url; boxImg.style.display = ''; boxFallback.style.display = 'none'; };
    probe.onerror = () => { _bTry++; _tryBox(); };
    probe.src = url;
  })();
  renderSetButtons();
  preloadSetImages(set);
}

let _preloadQueue = [];
let _preloadActive = 0;
const _PRELOAD_CONCURRENCY = 4;
let _preloadSetId = null;

function preloadSetImages(set) {
  if (!set || !set.cards) return;
  if (_preloadSetId === set.id) return;
  _preloadSetId = set.id;

  _preloadQueue = [];
  _preloadActive = 0;

  const urls = [];
  for (const card of set.cards) {
    const candidates = cardImgCandidates(card.id);
    if (candidates.length) urls.push({ id: card.id, candidates, ci: 0 });
  }

  _preloadQueue = urls;
  for (let i = 0; i < _PRELOAD_CONCURRENCY; i++) _preloadNext();
}

function _preloadNext() {
  if (!_preloadQueue.length) { _preloadActive = Math.max(0, _preloadActive - 1); return; }
  const item = _preloadQueue.shift();
  _preloadActive++;
  const img = new Image();
  img.onload = () => { _preloadActive--; _preloadNext(); };
  img.onerror = () => {
    if (item.ci < item.candidates.length - 1) {
      item.ci++;
      _preloadQueue.unshift(item);
    }
    _preloadActive--; _preloadNext();
  };
  img.src = item.candidates[item.ci];
}
function weightedPick(pool) {
  const total = pool.reduce((s,x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const item of pool) {
    r -= item.weight;
    if (r <= 0) return item.rarity;
  }
  return pool[pool.length-1].rarity;
}

function pickCardWithRarity(cards, rarity) {
  const matches = cards.filter(c => c.rarity === rarity);
  if (!matches.length) {
    const order = ["C","R","RR","RRR","SP","LR"];
    const idx = order.indexOf(rarity);
    for (let i = idx-1; i >= 0; i--) {
      const fb = cards.filter(c => c.rarity === order[i]);
      if (fb.length) return fb[Math.floor(Math.random()*fb.length)];
    }
    return cards[Math.floor(Math.random()*cards.length)];
  }
  return matches[Math.floor(Math.random()*matches.length)];
}

function rollSlot(cards, slot, used) {
  used = used || new Set();
  const allowed = slot.raritiesAllowed;
  const setRarities = new Set(cards.map(c => c.rarity));
  const available = allowed.filter(r => setRarities.has(r));
  if (!available.length) return cards[Math.floor(Math.random()*cards.length)];

  const pool = slot.weights
    ? available.map((r) => ({ rarity: r, weight: slot.weights[allowed.indexOf(r)] }))
    : RARITY_POOL.filter(x => available.includes(x.rarity));
  const rarity = weightedPick(pool);

  if (slot.triggerOnly) {
    const trigCards = cards.filter(c => c.rarity === 'C' && c.trigger && c.trigger !== 'Sentinel' && !used.has(c.id));
    const fallback  = cards.filter(c => c.rarity === 'C' && c.trigger && c.trigger !== 'Sentinel');
    const pick = (trigCards.length ? trigCards : fallback)[Math.floor(Math.random() * (trigCards.length || fallback.length))];
    used.add(pick.id); return pick;
  }

  const candidates = cards.filter(c => c.rarity === rarity && !used.has(c.id));
  const fallback   = cards.filter(c => c.rarity === rarity);
  const pick = (candidates.length ? candidates : fallback)[Math.floor(Math.random() * (candidates.length || fallback.length))];
  used.add(pick.id); return pick;
}

function generatePack() {
  const set = SETS[currentSetIdx];
  const id  = set.id;
  const sub = set.subtype || '';

  const isGBT = id.startsWith('GBT');
  const isGEB = id.startsWith('GEB');
  const isEB  = id.startsWith('EB') || isGEB;
  const isBT  = id.startsWith('BT');
  const isTwoSlot = sub === 'clan' || sub === 'technical' || sub === 'character' || id.startsWith('GCB')
                 || (isGBT && parseInt(id.replace('GBT','')) >= 11);
  const isGEBOld  = isGEB && (sub === 'geb_old' || parseInt(id.replace('GEB','')) <= 1);

  if (isTwoSlot) {
    const used = new Set();
    const s1Rules = sub === 'clan' || sub === 'technical' || sub === 'character'
      ? SLOT_RULES_7_CLAN_S1 : SLOT_RULES_7_GBT11_S1;
    const slot0Card = rollSlot(set.cards, s1Rules[0], used);
    const s2Pool = (slot0Card && slot0Card.rarity === 'RRR')
      ? (sub === 'clan' || sub === 'technical' || sub === 'character'
          ? SLOT_RULES_7_CLAN_S2_CAP : SLOT_RULES_7_GBT11_S2_CAP)
      : (sub === 'clan' || sub === 'technical' || sub === 'character'
          ? SLOT_RULES_7_CLAN_S2_FULL : SLOT_RULES_7_GBT11_S2_FULL);
    const slot1Card = rollSlot(set.cards, s2Pool, used);
    const rest = s1Rules.slice(1).map(slot => rollSlot(set.cards, slot, used));
    return [slot0Card, slot1Card, ...rest];
  }
  if (isGEBOld)                           return generatePack5(set.cards, RPLUS_EB);
  if (isGBT) {
    const used = new Set();
    const num = parseInt(id.replace('GBT',''));
    const slots = num >= 7 ? SLOT_RULES_7_GBT07 : num >= 4 ? SLOT_RULES_7_GBT04 : SLOT_RULES_7_GBT01;
    return slots.map(slot => rollSlot(set.cards, slot, used));
  }

  // D-series booster — single pack (used when box generator calls generatePack individually)
  // Slot structure: [C/CT, C/CT, C/CT, C/CT, C/CT/R, R, RR+]
  // premiumRarity is injected by the box generator for slot 7 guarantee
  if (id.startsWith('DBT')) {
    return generatePackDBT(set.cards, null);
  }

  const btNum = isBT ? parseInt(id.replace('BT','')) : 99;
  const ebNum = isEB ? parseInt(id.replace('EB','')) : 99;
  const variableTrigger = (isBT && btNum <= 5) || (isEB && ebNum <= 7);

  if (isEB && id.match(/EB1[012]/))  return generatePack5(set.cards, RPLUS_EB_LR, null, variableTrigger);
  if (isEB)                          return generatePack5(set.cards, RPLUS_EB,    null, variableTrigger);
  if (isBT && id.match(/BT1[67]/))   return generatePack5(set.cards, RPLUS_BT_LR, null, variableTrigger);
  return generatePack5(set.cards, RPLUS_BT, null, variableTrigger);
}

let stagedCards = [];
let autoReveal = true;

function toggleAutoReveal(el) {
  autoReveal = el.checked;
}
function generatePack5(cards, rplusPool, forcedRarity, variableTrigger, isGodPackSlot) {
  const used = new Set();
  const normalCPool = cards.filter(c => c.rarity === 'C' && !c.trigger && !c.sentinel);
  const trigCPool   = cards.filter(c => c.rarity === 'C' && c.trigger && c.trigger !== 'Sentinel');
  const lrCards     = cards.filter(c => c.rarity === 'LR');
  const spCards     = cards.filter(c => c.rarity === 'SP');
  const hasLR = lrCards.length > 0;
  const hasSP = spCards.length > 0;

  function pickFrom(pool, fb) {
    const fresh = pool.filter(c => !used.has(c.id));
    const src = fresh.length ? fresh : (fb||pool).filter(c => !used.has(c.id));
    const final = src.length ? src : (fb||pool);
    const p = final[Math.floor(Math.random()*final.length)];
    used.add(p.id); return p;
  }
  
  function pickUniqueFrom(pool, count) {
    const available = pool.filter(c => !used.has(c.id));
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    const selected = [];
    for (let i = 0; i < Math.min(count, available.length); i++) {
      const card = shuffled[i];
      used.add(card.id);
      selected.push(card);
    }
    return selected;
  }

  function randSP() { 
    const available = spCards.filter(c => !used.has(c.id));
    if (available.length === 0) return spCards[Math.floor(Math.random()*spCards.length)];
    return available[Math.floor(Math.random()*available.length)]; 
  }

  function pickRplus(overrideRarity, lrBoosted) {
    const allowed = rplusPool.raritiesAllowed;
    const setRarities = new Set(cards.map(c => c.rarity));
    const available = allowed.filter(r => setRarities.has(r));
    let weights = rplusPool.weights
      ? available.map(r => ({ rarity: r, weight: rplusPool.weights[allowed.indexOf(r)] }))
      : RARITY_POOL.filter(x => available.includes(x.rarity));
    if (lrBoosted && hasLR) {
      const boost = (typeof packsSinceLastLR !== 'undefined' && packsSinceLastLR >= 240) ? 6 : 3;
      weights = weights.map(w => w.rarity === 'LR' ? {...w, weight: w.weight * boost} : w);
    }
    const rarity = overrideRarity && available.includes(overrideRarity)
      ? overrideRarity : weightedPick(weights);
    const candidates = cards.filter(c => c.rarity === rarity && !used.has(c.id));
    const fallback   = cards.filter(c => c.rarity === rarity);
    const picked = (candidates.length ? candidates : fallback)[Math.floor(Math.random()*(candidates.length||fallback.length))];
    used.add(picked.id); return picked;
  }

  const tp = typeof totalPacksOpened !== 'undefined' ? totalPacksOpened : 0;
  const spGodChance  = !isGodPackSlot ? (tp >= 500 ? 0.008 : tp >= 300 ? 0.004 : 0) : 0;
  const lrGodChance  = !isGodPackSlot ? (tp >= 1000 ? 0.004 : tp >= 700 ? 0.002 : 0) : 0;

  const doLRGod = typeof godPacksEnabled !== 'undefined' && godPacksEnabled && (isGodPackSlot === 'LR' || (hasLR && lrGodChance > 0 && Math.random() < lrGodChance));
  const doSPGod = typeof godPacksEnabled !== 'undefined' && godPacksEnabled && !doLRGod && (isGodPackSlot === 'SP' || (hasSP && spGodChance > 0 && Math.random() < spGodChance));

  if (doLRGod && hasLR) {
    const isEBSet = lrCards[0].id.startsWith('EB');
    let pack;
    if (isEBSet) {
      const spPicks = pickUniqueFrom(spCards, 3);
      pack = [...spPicks, ...lrCards].slice(0, 5);
    } else {
      const lrPicks = pickUniqueFrom(lrCards, 6);
      pack = [...lrPicks];
      if (pack.length < 6 && hasSP) {
        const spPicks = pickUniqueFrom(spCards, 6 - pack.length);
        pack.push(...spPicks);
      }
      pack = pack.slice(0, 6);
    }
    if (typeof showToast !== 'undefined') setTimeout(() => showToast({icon:'⚡', name:'LR GOD PACK!', rarity:'SP'}), 500);
    return pack;
  }

  if (doSPGod && hasSP) {
    const pack = pickUniqueFrom(spCards, 5);
    if (typeof showToast !== 'undefined') setTimeout(() => showToast({icon:'🌟', name:'SP GOD PACK!', rarity:'SP'}), 500);
    return pack;
  }

  const lrBoosted = hasLR && typeof packsSinceLastLR !== 'undefined' && packsSinceLastLR >= 150;
  const rPlusCard = pickRplus(forcedRarity, lrBoosted);

  let slot1, slot2, slot3, slot4;
  if (variableTrigger) {
    if (Math.random() < 0.5) {
      slot1 = pickFrom(normalCPool, cards.filter(c=>c.rarity==='C'));
      slot2 = pickFrom(normalCPool, cards.filter(c=>c.rarity==='C'));
      slot3 = pickFrom(trigCPool, normalCPool);
      slot4 = pickFrom(trigCPool, normalCPool);
    } else {
      slot1 = pickFrom(normalCPool, cards.filter(c=>c.rarity==='C'));
      slot2 = pickFrom(normalCPool, cards.filter(c=>c.rarity==='C'));
      slot3 = pickFrom(normalCPool, cards.filter(c=>c.rarity==='C'));
      slot4 = pickFrom(trigCPool, normalCPool);
    }
  } else {
    slot1 = pickFrom(normalCPool, cards.filter(c=>c.rarity==='C'));
    slot2 = pickFrom(normalCPool, cards.filter(c=>c.rarity==='C'));
    slot3 = pickFrom(trigCPool, normalCPool);
    slot4 = pickFrom(trigCPool, normalCPool);
  }
  return [slot1, slot2, slot3, slot4, rPlusCard];
}

// ── D-Series (overDress) pack & box generator ──
function generatePackDBT(cards, forcedPremium) {
  const used = new Set();
  const allCPool = cards.filter(c => (c.rarity === 'C') && !c.token);
  const rPool    = cards.filter(c => c.rarity === 'R');
  const premiumPool = cards.filter(c => ['RR','H','RRR','ORR','SP','DSR'].includes(c.rarity));

  function pick(pool, fallback) {
    const fresh = pool.filter(c => !used.has(c.id));
    const src = fresh.length ? fresh : (fallback || pool).filter(c => !used.has(c.id));
    if (!src.length) return null;
    const card = src[Math.floor(Math.random() * src.length)];
    if (card) used.add(card.id);
    return card;
  }
  function pickByRarity(rar) {
    const pool = cards.filter(c => c.rarity === rar && !used.has(c.id));
    const src = pool.length ? pool : premiumPool.filter(c => !used.has(c.id));
    if (!src.length) return null;
    const card = src[Math.floor(Math.random() * src.length)];
    used.add(card.id); return card;
  }

  const s1 = pick(allCPool);
  const s2 = pick(allCPool);
  const s3 = pick(allCPool);
  const s4 = pick(allCPool);
  const s5 = Math.random() < 0.25 ? pick(rPool, allCPool) : pick(allCPool);
  const s6 = pick(rPool, allCPool);
  const s7 = forcedPremium ? pickByRarity(forcedPremium) : pick(premiumPool, rPool);
  return [s1, s2, s3, s4, s5, s6, s7].filter(Boolean);
}

function generateBoxDBT(set) {
  const cards = set.cards.filter(c => c.rarity && c.rarity !== 'nan');
  const NATIONS = ['Dragon Empire','Dark States','Brandt Gate','Keter Sanctuary','Stoicheia'];

  // Box slot-7 distribution: 4 RRR, 5 RR (1/nation), 5 H, 1 ORR, 1 SP
  let slot7 = ['RRR','RRR','RRR','RRR','RR','RR','RR','RR','RR','H','H','H','H','H','ORR','SP'];
  for (let i = slot7.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slot7[i], slot7[j]] = [slot7[j], slot7[i]];
  }

  // Pre-assign RR cards — 1 per nation, shuffled
  const rrNations = [...NATIONS].sort(() => Math.random() - 0.5);
  const rrCardByNation = {};
  for (const n of NATIONS) {
    const pool = cards.filter(c => c.rarity === 'RR' && c.clan === n);
    rrCardByNation[n] = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }
  let rrIdx = 0;

  // Token: 50% chance per box, injected into 1 random C slot in 1 random pack
  const tokenCards = cards.filter(c => c.token);
  const includeToken = tokenCards.length > 0 && Math.random() < 0.5;
  const tokenPackIdx = includeToken ? Math.floor(Math.random() * 16) : -1;

  const allCards = [];
  for (let i = 0; i < 16; i++) {
    const rar = slot7[i];
    let pack;
    if (rar === 'RR' && rrIdx < rrNations.length) {
      pack = generatePackDBT(cards, null);
      const rrCard = rrCardByNation[rrNations[rrIdx++]];
      if (rrCard && pack.length >= 7) pack[6] = rrCard;
      else if (rrCard) pack.push(rrCard);
    } else {
      pack = generatePackDBT(cards, rar);
    }
    if (i === tokenPackIdx && tokenCards.length) {
      const token = tokenCards[Math.floor(Math.random() * tokenCards.length)];
      const slot = Math.floor(Math.random() * 4);
      pack[slot] = token;
    }
    allCards.push(...pack);
  }
  return allCards.filter(Boolean);
}



function generateBox5(cards, rplusPool, boxPacks, isEB, variableTrigger) {
  const hasLR = cards.some(c => c.rarity === 'LR');
  const hasSP = cards.some(c => c.rarity === 'SP');
  const tp = typeof totalPacksOpened !== 'undefined' ? totalPacksOpened : 0;

  const lrGodInBox = typeof godPacksEnabled !== 'undefined' && godPacksEnabled && hasLR && (tp >= 700 ? Math.random() < 0.015 : tp >= 400 ? Math.random() < 0.008 : false);
  const spGodInBox = typeof godPacksEnabled !== 'undefined' && godPacksEnabled && !lrGodInBox && hasSP && (tp >= 300 ? Math.random() < 0.025 : tp >= 150 ? Math.random() < 0.012 : false);
  const godPackType = lrGodInBox ? 'LR' : (spGodInBox ? 'SP' : null);

  let rarities = [];
  if (isEB) {
    const hasSPslot = hasSP && Math.random() < 0.25 && !godPackType;
    rarities = [
      ...Array(hasSPslot ? 10 : 11).fill('R'),
      ...Array(3).fill('RR'),
      'RRR',
      ...(hasSPslot ? ['SP'] : []),
    ];
  } else {
    const hasSPslot = hasSP && Math.random() < 0.25 && !godPackType;
    const rrrCount = godPackType ? 2 : (hasSPslot ? 2 : 3);
    rarities = [
      ...Array(22).fill('R'),
      ...Array(5).fill('RR'),
      ...Array(rrrCount).fill('RRR'),
      ...(hasSPslot ? ['SP'] : []),
    ];
  }
  
  for (let i = rarities.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rarities[i], rarities[j]] = [rarities[j], rarities[i]];
  }
  
  const godPackPos = godPackType ? Math.floor(Math.random() * boxPacks) : -1;
  const allCards = [];
  let ri = 0;
  
  for (let i = 0; i < boxPacks; i++) {
    if (i === godPackPos) {
      allCards.push(...generatePack5(cards, rplusPool, null, variableTrigger, godPackType));
    } else {
      allCards.push(...generatePack5(cards, rplusPool, rarities[ri] || 'R', variableTrigger));
      ri++;
    }
  }
  return allCards;
}

function stageBox() {
  const set = SETS[currentSetIdx];
  if (!set) return;
  const sub = set.subtype || '';

  // D-series box — dedicated generator
  if (set.id.startsWith('DBT')) {
    stagedCards = generateBoxDBT(set);
    _presentStagedCards(16);
    return;
  }
  const isGBT11plus = set.id.startsWith('GBT') && parseInt(set.id.replace('GBT','')) >= 11;
  const isClanStyle = sub==='clan'||sub==='technical'||sub==='character';
  const isGEBOld    = set.id.startsWith('GEB') && (sub==='geb_old'||parseInt(set.id.replace('GEB',''))<=1);
  const boxPacks = isClanStyle ? 12
                 : isGBT11plus ? 16
                 : isGEBOld    ? 15
                 : set.id.startsWith('GCB') ? 12
                 : set.id.startsWith('GEB') ? 12
                 : set.id.startsWith('EB')  ? 15 : 30;

  const is5card = (set.packSize || 5) === 5;
  if (is5card) {
    const id = set.id;
    const isEB = id.startsWith('EB') || isGEBOld;
    const btNum = id.startsWith('BT') ? parseInt(id.replace('BT','')) : 99;
    const ebNum = isEB ? parseInt(id.replace('EB','')) : 99;
    const variableTrigger = (id.startsWith('BT') && btNum <= 5) || (isEB && ebNum <= 7);
    const rplusPool = id.match(/BT1[67]/) || id.match(/EB1[012]/)
      ? (isEB ? RPLUS_EB_LR : RPLUS_BT_LR)
      : (isEB ? RPLUS_EB : RPLUS_BT);
    const allCards = generateBox5(set.cards, rplusPool, boxPacks, isEB, variableTrigger);
    stagedCards = allCards;
    _presentStagedCards(boxPacks);
  } else {
    _doStagePack(boxPacks);
  }
}
function stagePack(count) {
  const set = SETS[currentSetIdx];
  if (!set) return;
  if (count === 1) {
    playPackRip(set.icon, set.label, `images/boxes/box-${set.id}`, () => _doStagePack(count));
  } else {
    _doStagePack(count);
  }
}
function _doStagePack(count) {
  const allCards = [];
  for (let i = 0; i < count; i++) allCards.push(...generatePack());
  stagedCards = allCards;
  _presentStagedCards(count);
}

function _presentStagedCards(count) {
  const set = SETS[currentSetIdx];
  const allCards = stagedCards;
  const totalCards = allCards.length;

  if (autoReveal) {
    document.getElementById('reveal-title').textContent =
      count === 1 ? `Pack – ${set.label}` : `${count} Packs (${totalCards} cards) – ${set.label}`;
    renderReveal(allCards, [], true);
    document.getElementById('reveal-section').classList.add('active');
    document.getElementById('reveal-btn').style.display = 'none';
    document.getElementById('flip-all-btn').style.display = 'none';
    flippedAll = false;
    const delay = Math.min(allCards.length * 35 + 200, 1200);
    setTimeout(() => revealCards(), delay);
  } else {
    document.getElementById('reveal-title').textContent =
      count === 1 ? `Pack Ready – ${set.label}` : `${count} Packs Ready (${totalCards} cards) – ${set.label}`;
    renderReveal(allCards, [], true);
    document.getElementById('reveal-section').classList.add('active');
    document.getElementById('reveal-btn').style.display = '';
    document.getElementById('flip-all-btn').style.display = 'none';
    flippedAll = false;
  }
}

function revealCards() {
  const allCards = stagedCards;
  if (!allCards.length) return;

  const set = SETS[currentSetIdx];
  totalPacks += allCards.length / (set.packSize || 5);
  document.getElementById('total-packs').textContent = Math.round(totalPacks);

  const newCardIds = [];
  const packResults = [];
  const packSize = set.packSize || 5;
  collectionDirty = true;
  const packCount = Math.round(allCards.length / packSize);

  for (let i = 0; i < packCount; i++) {
    const packCards = allCards.slice(i * packSize, (i + 1) * packSize);
    packResults.push({ set: set.label, cards: packCards, time: new Date() });
    for (const card of packCards) {
      if (!collection[card.id]) { collection[card.id] = { card, count: 0, firstPulled: Date.now() }; newCardIds.push(card.id); }
      collection[card.id].count++;
      collection[card.id].lastPulled = Date.now();
    }
  }
  history.unshift(...packResults.reverse());

  renderReveal(allCards, newCardIds, false);
  updateStats();
  updateCollection();
  updateHistory();

  document.getElementById('reveal-title').textContent =
    packCount === 1 ? `Pack Results – ${set.label}` : `Results – ${packCount} Packs (${allCards.length} cards)`;
  document.getElementById('reveal-btn').style.display = 'none';
  document.getElementById('flip-all-btn').style.display = '';
  document.getElementById('flip-all-btn').textContent = 'Show All';
  flippedAll = false;

  const isBox = allCards.length > packSize;
  const inners = document.querySelectorAll('.card-inner');
  inners.forEach((el, i) => setTimeout(() => {
    el.classList.add('flipped');
    if (!isBox || i % packSize === 0) SFX.cardFlip();
  }, i * 80));

  const notable = allCards.filter(c => ["RRR","LR","SP"].includes(c.rarity));
  notable.slice(0, 3).forEach((c, i) => {
    setTimeout(() => showToast(c), 500 + i * 400);
    if (i === 0) setTimeout(() => (c.rarity === 'SP') ? SFX.spHit() : SFX.rrrHit(), 300 + i * 400);
  });

  for (const c of allCards) {
    sessionStats.totalPulled++;
    sessionStats.byRarity[c.rarity] = (sessionStats.byRarity[c.rarity]||0) + 1;
    const rarityOrder = ["C","R","H","RR","RRR","ORR","SP","DSR","LR","SCR","GR","SGR","OR"];
    if (!sessionStats.bestPull || rarityOrder.indexOf(c.rarity) > rarityOrder.indexOf(sessionStats.bestPull.rarity))
      sessionStats.bestPull = c;
    if (wishlist.has(c.id)) {
      sessionStats.wishlistHits++;
      setTimeout(() => showToast({...c, _wishlistHit: true}), 800);
    }
  }

  for (let pi = 0; pi < packCount; pi++) {
    const packCards = allCards.slice(pi * packSize, (pi + 1) * packSize);
    const hitRRR = packCards.some(c => ["RRR","LR","SP","OR","GR","SCR","SGR"].includes(c.rarity));
    if (hitRRR) { packsSinceLastRRR = 0; }
    else { packsSinceLastRRR++; }
    const hitLR = packCards.some(c => c.rarity === 'LR');
    if (hitLR) { packsSinceLastLR = 0; }
    else { packsSinceLastLR++; }
    totalPacksOpened++;
  }
  updatePityDisplay();

  stagedCards = [];
}

function resetPackStats() {
  if (!confirm('Reset pack stats? This resets packs opened, pull history and session stats only. Your collection stays.')) return;
  history = [];
  totalPacks = 0;
  packsSinceLastRRR = 0;
  sessionStats = { totalPulled:0, byRarity:{}, bestPull:null, packPrice:sessionStats.packPrice, wishlistHits:0 };
  stagedCards = [];
  document.getElementById('total-packs').textContent = '0';
  document.getElementById('reveal-section').classList.remove('active');
  updatePityDisplay();
  updateHistory();
  updateStats();
  showToast({ icon: '🔄', name: 'Pack stats reset', rarity: 'C' });
}

function clearCollection() {
  if (!confirm('Reset everything? This will clear your pack collection, history and stats.')) return;
  collection = {};
  history = [];
  totalPacks = 0;
  stagedCards = [];
  packsSinceLastRRR = 0;
  sessionStats = { totalPulled:0, byRarity:{}, bestPull:null, packPrice:sessionStats.packPrice, wishlistHits:0 };
  document.getElementById('total-packs').textContent = '0';
  document.getElementById('total-cards-stat').textContent = '0';
  document.getElementById('rrr-count').textContent = '0';
  document.getElementById('reveal-section').classList.remove('active');
  updatePityDisplay();
  addTDsToCollection();
  updateCollection();
  updateHistory();
  updateStats();
  showToast({ icon: '🗑️', name: 'Collection cleared (TDs kept)', rarity: 'C' });
}

function cardImgPath(id, ext) {
  ext = ext || 'webp';
  const setId = id.split('_')[0];
  const isGSeries = /^G(BT|EB|TD|CB)/.test(setId);
  const base = isGSeries ? IMG_CARDS_G : IMG_CARDS_OG;

  if (setId.startsWith('GTD')) {
    return `${base}${setId}/${id}.${ext}`;
  }

  if (setId.startsWith('GBT')) {
    return `${base}${setId}/${id}.${ext}`;
  }

  if (setId.startsWith('GEB') || setId.startsWith('GCB')) {
    return `${base}${setId}/${id}.${ext}`;
  }

  if (setId === 'EB10') {
    const m = id.match(/^(EB10_(?:S\d+|\d+)EN)-([BW])$/);
    if (m) {
      return `${base}${setId}/${m[1]}-${m[2]}.${ext}`;
    }
  }

  // For all OG sets (BT, EB, TD), just use the ID as-is
  return `${base}${setId}/${id}.${ext}`;
}

function cardImgCandidates(id) {
  const setId = id.split('_')[0];
  const isGSeries = /^G(BT|EB|TD|CB)/.test(setId);
  const base = isGSeries ? IMG_CARDS_G : IMG_CARDS_OG;
  
  // Use the ID exactly as is - it already has EN suffix
  const fileId = id;
  
  if (setId === 'EB10') {
    const m = id.match(/^(EB10_(?:S\d+|\d+)EN)-([BW])$/);
    if (m) {
      return [
        `${base}${setId}/${m[1]}-${m[2]}.webp`,
        `${base}${setId}/${m[1]}${m[2]}.webp`,
      ];
    }
  }

  // Try exact ID, then lowercase (GEB uses lowercase filenames)
  return [
    `${base}${setId}/${fileId}.webp`,
  ];
}

function setImgSrcWithFallback(imgEl, id, onBothFail) {
  const candidates = cardImgCandidates(id);
  let attempt = 0;
  function next() {
    if (attempt >= candidates.length) { if (onBothFail) onBothFail(); return; }
    imgEl.onerror = () => { attempt++; next(); };
    imgEl.src = candidates[attempt++];
  }
  next();
}
const IMG_CARDS_OG = 'images/cards/1 OG/';
const IMG_CARDS_G  = 'images/cards/2 G/';
const IMG_CARDS    = IMG_CARDS_OG;
const IMG_ASSETS  = 'images/assets/';
const IMG_BOXES   = 'images/boxes/';

function renderReveal(cards, newCardIds, faceDown) {
  const grid = document.getElementById('cards-grid');
  const set = SETS[currentSetIdx];
  const packSize = set ? (set.packSize || 5) : 5;
  
  const isLRGodPack = cards.length === 6 && cards.every(c => c.rarity === 'LR' || c.rarity === 'SP');
  
  if (isLRGodPack) {
    grid.className = 'cards-grid pack-6';
  } else {
    grid.className = packSize === 7 ? 'cards-grid pack-7' : 'cards-grid';
  }
  grid.innerHTML = '';
  cards.forEach((card, i) => {
    const isNew = newCardIds.includes(card.id);
    const slot = document.createElement('div');
    slot.className = `card-slot`;
    slot.style.animationDelay = `${i * 35}ms`;
    slot.innerHTML = `
      <div class="card-inner ${faceDown ? '' : 'flipped'}" id="card-inner-${i}">
        <div class="card-face card-back">
          <img src="${IMG_ASSETS}${isGUnit(card)?'card-back-g':'card-back'}.webp" alt="card back"
               onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
          <span class="back-fallback" style="display:none">🎴</span>
        </div>
        <div class="card-face card-front ${card.rarity}">
          ${isNew ? '<span class="card-new-badge">NEW</span>' : ''}
          <div class="card-art">
            <img data-id="${card.id}" alt="${card.name}"
                 src="${cardImgPath(card.id)}"
                 loading="lazy" onerror="(function(el){if(!el._cands){el._cands=cardImgCandidates(el.dataset.id);el._ci=1;}if(el._ci<el._cands.length){el.src=el._cands[el._ci++];}else{el.style.display='none';el.nextElementSibling&&(el.nextElementSibling.style.display='flex');}})(this)">
            <span class="card-emoji-fallback" style="display:none;font-size:30px;z-index:1">${card.icon}</span>
            <div style="position:absolute;bottom:0;left:0;right:0;height:35%;background:linear-gradient(transparent,rgba(0,0,0,0.85));z-index:2"></div>
            ${(()=>{ const owned=collection[card.id]?.count||0; return owned>=4?'<div style="position:absolute;top:4px;left:4px;background:rgba(239,68,68,0.92);color:#fff;font-size:8px;font-weight:700;padding:2px 5px;border-radius:3px;z-index:5">MAX</div>':owned>0?`<div style="position:absolute;top:4px;left:4px;background:rgba(0,0,0,0.6);color:#fff;font-size:8px;padding:2px 5px;border-radius:3px;z-index:5">Owned: ${owned}</div>`:''; })()}
            ${wishlist.has(card.id)?'<div style="position:absolute;top:4px;right:4px;font-size:14px;z-index:5">⭐</div>':''}
          </div>
          <div class="card-footer">
            <div class="card-name">${card.name}</div>
            <div class="card-meta">
              <span class="card-grade">G${card.grade} · ${card.clan} · <span style="opacity:0.65">${getCardNum(card.id)}</span></span>
              <span class="rarity-badge ${card.rarity}">${card.rarity}</span>
            </div>
          </div>
          <button class="reveal-quick-add" onclick="event.stopPropagation();quickAddFromReveal('${card.id}')" title="Add to deck">＋</button>
        </div>
      </div>`;
    slot.onclick = () => slot.querySelector('.card-inner').classList.toggle('flipped');
    slot.ondblclick = (e) => { e.stopPropagation(); openZoom(card); };
    grid.appendChild(slot);
  });
}

let flippedAll = false;
function flipAll() {
  const inners = document.querySelectorAll('.card-inner');
  flippedAll = !flippedAll;
  inners.forEach((el,i) => {
    setTimeout(() => el.classList.toggle('flipped', flippedAll), i*45);
  });
  document.getElementById('flip-all-btn').textContent = flippedAll ? 'Hide All' : 'Show All';
}

function updateStats() {
  const allCards = Object.values(collection).filter(x => !x.card.id.startsWith('TD') && !x.card.id.startsWith('GTD'));
  const totalCards = allCards.reduce((s,x) => s+x.count, 0);
  const rrrPlus = allCards.filter(x => ["RRR","SP"].includes(x.card.rarity)).reduce((s,x)=>s+x.count,0);
  document.getElementById('total-cards-stat').textContent = totalCards;
  document.getElementById('rrr-count').textContent = rrrPlus;
}

function renderCollection() { updateCollection(); }
function updateCollection() {
  const search = (document.getElementById('coll-search')?.value||'').toLowerCase();
  let allCards = Object.values(collection);

  const boosterCards = allCards.filter(x => !x.card.id.startsWith('TD') && !x.card.id.startsWith('GTD'));
  const total = boosterCards.reduce((s,x) => s+x.count, 0);
  const unique = boosterCards.length;
  const dupes = boosterCards.filter(x => x.count > 1).reduce((s,x) => s+(x.count-1), 0);

  document.getElementById('coll-total').textContent = total;
  document.getElementById('coll-unique').textContent = unique;
  document.getElementById('coll-dupes').textContent = dupes;

  const rarityCounts = {};
  const rarityOrder = ["TD","C","R","H","RR","RRR","ORR","SP","DSR","LR","SCR","GR","SGR","OR"];
  for (const r of rarityOrder) rarityCounts[r] = 0;
  for (const {card,count} of boosterCards) rarityCounts[card.rarity] = (rarityCounts[card.rarity]||0)+count;
  const maxCount = Math.max(...Object.values(rarityCounts), 1);

  const breakdown = document.getElementById('rarity-breakdown');
  breakdown.innerHTML = rarityOrder.filter(r => rarityCounts[r] > 0).map(r => `
    <div class="rarity-row">
      <span class="r-label rarity-badge ${r}">${r}</span>
      <div class="r-bar-bg"><div class="r-bar ${r}" style="width:${Math.max(4,(rarityCounts[r]/maxCount)*100)}%"></div></div>
      <span class="r-count">${rarityCounts[r]}</span>
    </div>`).join('');

  if (boosterCards.length === 0) {
    document.getElementById('collection-list-container').innerHTML = '<div class="empty-state"><div class="icon">🎴</div><p>Open your first pack to start your collection!</p></div>';
    return;
  }

  allCards = allCards.filter(({card}) => !card.id.startsWith('TD') && !card.id.startsWith('GTD'));
  if (search) allCards = allCards.filter(({card}) => card.name.toLowerCase().includes(search) || card.clan.toLowerCase().includes(search));

  const sortMode = document.getElementById('coll-sort')?.value || 'rarity';

  function collRow(card, count) {
    const badge = (() => {
      if (isSentinel(card)) return '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(240,180,41,0.85);color:#000;font-weight:700">🛡 Sentinel</span>';
      const t = getTriggerType(card); if (!t) return '';
      const bg = {Critical:'rgba(240,180,41,0.85)',Draw:'rgba(230,120,40,0.85)',Stand:'rgba(59,130,246,0.85)',Heal:'rgba(61,191,127,0.85)'}[t]||'#555';
      const lbl = {Critical:'🟡 Critical',Draw:'🟠 Draw',Stand:'🔵 Stand',Heal:'💚 Heal'}[t]||t;
      return `<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(100,100,100,0.3);color:var(--text-muted);font-weight:600">Trigger</span><span style="font-size:9px;padding:1px 5px;border-radius:3px;background:${bg};color:#fff;font-weight:700">${lbl}</span>`;
    })();
    return `<div class="coll-card-row" onclick="openZoom(getAllCardById('${card.id}'))" style="cursor:pointer">
      <span class="coll-icon">${card.icon}</span>
      <div class="coll-info">
        <div class="coll-name">${card.name}</div>
        <div class="coll-sub" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
          <span>${card.clan} · G${card.grade} · <span style="font-family:monospace;opacity:0.65">${getCardNum(card.id)}</span></span>${badge}
        </div>
      </div>
      <span class="coll-count ${count>=3?'highlight':''}">${count}x</span>
    </div>`;
  }

  let html = '<div class="collection-list">';

  if (sortMode === 'rarity') {
    const grouped = {};
    for (const r of rarityOrder) grouped[r] = [];
    for (const {card,count} of allCards) grouped[card.rarity].push({card,count});
    for (const r of rarityOrder) grouped[r].sort((a,b) => a.card.name.localeCompare(b.card.name));
    for (const r of rarityOrder) {
      if (!grouped[r].length) continue;
      html += `<div class="section-title">${r} <span style="color:var(--text-muted);font-weight:400">(${grouped[r].length})</span></div>`;
      for (const {card,count} of grouped[r]) html += collRow(card, count);
    }
  } else if (sortMode === 'most-owned') {
    allCards.sort((a,b) => b.count - a.count || a.card.name.localeCompare(b.card.name));
    for (const {card,count} of allCards) html += collRow(card, count);
  } else if (sortMode === 'recent') {
    allCards.sort((a,b) => (b.lastPulled||0) - (a.lastPulled||0));
    for (const {card,count} of allCards) html += collRow(card, count);
  } else if (sortMode === 'name') {
    allCards.sort((a,b) => a.card.name.localeCompare(b.card.name));
    for (const {card,count} of allCards) html += collRow(card, count);
  }

  html += '</div>';
  document.getElementById('collection-list-container').innerHTML = html;
}

function renderHistory() { updateHistory(); }
let historyExpanded = new Set();
function toggleHistoryEntry(i) {
  if (historyExpanded.has(i)) historyExpanded.delete(i); else historyExpanded.add(i);
  updateHistory();
}
function updateHistory() {
  const el = document.getElementById('history-list');
  if (!history.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">📋</div><p>Your pack history will appear here.</p></div>';
    return;
  }
  const rarityOrder = ["DSR","ORR","SGR","SCR","GR","OR","LR","SP","RRR","H","RR","R","C"];
  el.innerHTML = history.slice(0,20).map((entry,i) => {
    const rrrs = entry.cards.filter(c=>["RRR","SP"].includes(c.rarity));
    const open = historyExpanded.has(i);
    let breakdown = '';
    if (open) {
      const byRarity = {};
      for (const c of entry.cards) byRarity[c.rarity] = (byRarity[c.rarity]||[]).concat(c);
      const counts = rarityOrder.filter(r=>byRarity[r]).map(r=>`<span class="rarity-badge ${r}" style="font-size:8px">${r}</span><span style="font-size:10px;color:var(--text-muted)"> ×${byRarity[r].length}</span>`).join('  ');
      const notables = rrrs.map(c=>`<span class="history-pill ${c.rarity}" title="${c.name}">${c.name}</span>`).join('');
      breakdown = `<div style="margin-top:6px;border-top:1px solid var(--border);padding-top:6px;display:flex;flex-direction:column;gap:4px">
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${counts}</div>
        ${notables ? `<div style="margin-top:2px">${notables}</div>` : '<div style="font-size:10px;color:var(--text-muted)">No notable pulls</div>'}
      </div>`;
    }
    return `<div class="history-entry" style="cursor:pointer" onclick="toggleHistoryEntry(${i})">
      <div class="history-entry-header">
        <span class="history-set-name">${entry.set} – ${entry.cards.length} cards</span>
        <span style="font-size:9px;color:var(--text-muted);margin-left:4px">${open?'▲':'▼'}</span>
        <span class="history-time">${formatTime(entry.time)}</span>
      </div>
      ${open ? breakdown : `<div class="history-cards">${entry.cards.map(c=>`<span class="history-pill ${c.rarity}" title="${c.name}">${c.name}</span>`).join('')}</div>`}
    </div>`;
  }).join('');
}

function formatTime(d) {
  return d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
}

function switchTab(name) {
  const tabs = ['collection','history','missing'];
  document.querySelectorAll('.tab-btn').forEach((b,i) => b.classList.toggle('active', tabs[i]===name));
  document.getElementById('tab-collection').classList.toggle('active', name==='collection');
  document.getElementById('tab-history').classList.toggle('active', name==='history');
  document.getElementById('tab-missing').classList.toggle('active', name==='missing');
  if (name === 'missing') renderMissing();
}

let zoomCard = null;
function openZoom(card) {
  zoomCard = card;
  const img = document.getElementById('zoom-img');
  const fallback = document.getElementById('zoom-fallback');
  
  img.style.display = 'block';
  fallback.style.display = 'none';
  
  const candidates = cardImgCandidates(card.id);
  let attempt = 0;
  
  function tryNext() {
    if (attempt >= candidates.length) {
      img.style.display = 'none';
      fallback.style.display = 'flex';
      document.getElementById('zoom-icon').textContent = card.icon;
      return;
    }
    img.onerror = () => { attempt++; tryNext(); };
    img.onload = () => { fallback.style.display = 'none'; };
    img.src = candidates[attempt];
    attempt++;
  }
  tryNext();
  
  document.getElementById('zoom-name').textContent = card.name;
  document.getElementById('zoom-sub').textContent = `${card.clan} · Grade ${card.grade} · ${card.rarity}`;
  document.getElementById('zoom-sub').style.color = `var(--rarity-${card.rarity.toLowerCase()})`;
  
  const owned = collection[card.id]?.count || 0;
  const ttype = getTriggerType(card);
  const unitType = isSentinel(card)?'Sentinel':ttype?`${ttype} Trigger`:card.grade===0?'First Vanguard':`Grade ${card.grade} Unit`;
  const inDeck = deck[card.id]?.count || 0;
  const inFV = fvCard?.id===card.id ? 1 : 0;
  
  document.getElementById('zoom-extra').innerHTML = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-top:4px">
      <span style="font-size:10px;padding:2px 7px;border-radius:4px;background:var(--surface2);color:var(--text-muted)">📦 Owned: <b style="color:var(--text)">${owned}</b></span>
      <span style="font-size:10px;padding:2px 7px;border-radius:4px;background:var(--surface2);color:var(--text-muted)">🃏 In Deck: <b style="color:var(--text)">${inDeck+inFV}</b></span>
      <span style="font-size:10px;padding:2px 7px;border-radius:4px;background:var(--surface2);color:var(--text-muted)">📂 ${card.id.split('_')[0]}</span>
      <span style="font-size:10px;padding:2px 7px;border-radius:4px;background:var(--surface2);color:var(--text-muted)">${unitType}</span>
    </div>`;
    
  const wb = document.getElementById('zoom-wishlist-btn');
  wb.textContent = wishlist.has(card.id) ? '⭐ On Wishlist' : '☆ Add to Wishlist';
  wb.style.background = wishlist.has(card.id) ? 'rgba(240,180,41,0.2)' : '';
  wb.style.borderColor = wishlist.has(card.id) ? 'var(--gold)' : '';
  document.getElementById('zoom-overlay').classList.add('active');
}

function closeZoom(e) {
  if (e && e.target !== document.getElementById('zoom-overlay')) return;
  document.getElementById('zoom-overlay').classList.remove('active');
  zoomCard = null;
}

function addToDeckFromZoom() {
  if (zoomCard) { 
    addToDeck(zoomCard); 
    document.getElementById('zoom-overlay').classList.remove('active'); 
  }
}

let galleryRarityFilter = 'ALL';
let galleryClanFilter = 'ALL';
let galleryTypeFilter = 'ALL';
let galleryGradeFilter = 'ALL';
let gallerySetFilter = 'ALL';
let _galRenderEpoch = 0;
let galleryFormat = 'OG';
let deckPoolFormat = 'OG';
let galleryPlayFormat = 'Premium';
let deckPlayFormat = 'Premium';
let galleryOwnedFilter = 'ALL';
let gallerySortBy = 'rarity';
let gallerySortDir = 'desc';
let deckShowAllCards = false;
let deckSortBy = 'rarity';
let deckSortDir = 'desc';

let galleryFiltersOpen = false;
function toggleGalleryFilters() {
  galleryFiltersOpen = !galleryFiltersOpen;
  document.getElementById('gallery-filter-panel').classList.toggle('open', galleryFiltersOpen);
  document.getElementById('gallery-filter-toggle').classList.toggle('active', galleryFiltersOpen);
}
function openGallery() {
  try {
    updateFormatTabUI('gal-fmt-', galleryFormat);
    updatePlayFormatTabUI('gal-pf-', galleryPlayFormat);
    buildGalleryFilters();
    renderGallery();
    document.getElementById('gallery-overlay').classList.add('active');
  } catch (e) {
    console.error('openGallery failed', e);
    showToast({ icon: '❌', name: 'Gallery failed to open — check console', rarity: 'C' });
  }
}
function closeGallery() { document.getElementById('gallery-overlay').classList.remove('active'); }

function buildGalleryFilters() {
  const btn = filterChipBtn;
  const allCards = getAllSetCards();
  const EXTRA_CLANS = ['Angel Feather','Dimension Police','Gear Chronicle','Genesis','Link Joker','Neo Nectar','Pale Moon'];
  const clans = ['ALL', ...new Set([...allCards.map(c => c.clan), ...EXTRA_CLANS])].sort((a,b) => a==='ALL'?-1:a.localeCompare(b));
  const RARITY_ORDER_ALL = ['ALL','TD','C','R','H','RR','RRR','ORR','SP','DSR','LR','SCR','GR','SGR'];
  const presentRarities = new Set(allCards.map(c=>c.rarity));
  const rarities = RARITY_ORDER_ALL.filter(r => r==='ALL'||r==='TD'||presentRarities.has(r));
  const _galInFmt = s => galleryFormat === 'ALL' || setMatchesFormat(s, galleryFormat);
  const sets = ['ALL',...SETS.filter(s=>s.packSize!==50&&_galInFmt(s)).map(s=>s.id).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),...SETS.filter(s=>s.packSize===50&&_galInFmt(s)).map(s=>s.id).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))];
  document.getElementById('gallery-set-filters').innerHTML = sets.map(s =>
    btn(s==='ALL'?'All Sets':s, s===gallerySetFilter, `setGallerySet('${s}')`)
  ).join('');
  document.getElementById('gallery-rarity-filters').innerHTML = rarities.map(r =>
    btn(r==='ALL'?'All':r, r===galleryRarityFilter, `setGalleryRarity('${r}')`)
  ).join('');
  document.getElementById('gallery-clan-filters').innerHTML = clans.map(c =>
    btn(c==='ALL'?'All Clans/Nations':c, c===galleryClanFilter, `setGalleryClan('${c}')`)
  ).join('');

  const hasD = SETS.some(s => s.format === 'D');
  const baseTypes = ['ALL','Normal','Trigger','🗡 Critical','🃏 Draw','🔄 Stand','💚 Heal','🔵 Front','⚡ Overtrigger','Sentinel'];
  const dTypes = hasD ? ['📋 Normal Order','⚡ Blitz Order','📌 Set Order','Persona Ride','Token'] : [];
  const types = [...baseTypes, ...dTypes, 'Wishlist'];
  document.getElementById('gallery-type-filters').innerHTML = types.map(t =>
    btn(t==='ALL'?'All Types':t, t===galleryTypeFilter, `setGalleryType('${t}')`)
  ).join('');

  const maxGrade = Math.max(0, ...allCards.map(c=>c.grade));
  const grades = ['ALL',...Array.from({length:maxGrade+1},(_,i)=>String(i))];
  const gradeButtons = grades.map(g =>
    btn(g==='ALL'?'All Grades':'G'+g, g===galleryGradeFilter, `setGalleryGrade('${g}')`)
  );
  const hasGUnits = allCards.some(c=>isGUnit(c));
  const gUnitBtn = hasGUnits ? btn('✨ G Units', 'GUNITS'===galleryGradeFilter, `setGalleryGrade('GUNITS')`) : '';
  document.getElementById('gallery-grade-filters').innerHTML = gradeButtons.join('') + gUnitBtn;
  const ownedEl = document.getElementById('gallery-owned-filters');
  if (ownedEl) {
    ownedEl.innerHTML = [
      btn('All Cards', galleryOwnedFilter === 'ALL', `setGalleryOwnedFilter('ALL')`),
      btn('Owned Only', galleryOwnedFilter === 'OWNED', `setGalleryOwnedFilter('OWNED')`),
    ].join('');
  }
  const sortByEl = document.getElementById('gallery-sort-by-filters');
  if (sortByEl) {
    sortByEl.innerHTML = [
      ['rarity','Rarity'],['grade','Grade'],['setno','Set No.'],['name','Name'],
    ].map(([k, lab]) => btn(lab, gallerySortBy === k, `setGallerySort('${k}','${gallerySortDir}')`)).join('');
  }
  const sortDirEl = document.getElementById('gallery-sort-dir-filters');
  if (sortDirEl) {
    sortDirEl.innerHTML = [
      btn('↑ Asc', gallerySortDir === 'asc', `setGallerySort('${gallerySortBy}','asc')`),
      btn('↓ Desc', gallerySortDir === 'desc', `setGallerySort('${gallerySortBy}','desc')`),
    ].join('');
  }
}

function setGallerySort(by, dir) {
  gallerySortBy = by;
  gallerySortDir = dir;
  buildGalleryFilters();
  renderGallery();
}

function setGalleryPlayFormat(pf) {
  galleryPlayFormat = pf;
  updatePlayFormatTabUI('gal-pf-', pf);
  buildGalleryFilters();
  renderGallery();
}

function setGalleryOwnedFilter(mode) {
  galleryOwnedFilter = mode;
  const chk = document.getElementById('gallery-owned-only');
  if (chk) chk.checked = mode === 'OWNED';
  buildGalleryFilters();
  renderGallery();
}

function setGalleryFormat(fmt) {
  galleryFormat = fmt;
  gallerySetFilter = 'ALL';
  updateFormatTabUI('gal-fmt-', fmt);
  buildGalleryFilters(); renderGallery();
}
function setGalleryRarity(r) { galleryRarityFilter=r; buildGalleryFilters(); renderGallery(); }
function setGalleryClan(c) { galleryClanFilter=c; buildGalleryFilters(); renderGallery(); }
function setGalleryType(t) { galleryTypeFilter=t; buildGalleryFilters(); renderGallery(); }
function setGalleryGrade(g) { galleryGradeFilter=g; buildGalleryFilters(); renderGallery(); }
function setGallerySet(s) { gallerySetFilter=s; buildGalleryFilters(); renderGallery(); }

// ── Debounced search triggers ──
let _galSearchTimer = null, _dpSearchTimer = null, _collSearchTimer = null;
function _renderGalleryDebounced() {
  clearTimeout(_galSearchTimer);
  _galSearchTimer = setTimeout(renderGallery, 120);
}
function _renderDeckPoolDebounced() {
  clearTimeout(_dpSearchTimer);
  _dpSearchTimer = setTimeout(renderDeckPool, 120);
}
function _renderCollDebounced() {
  clearTimeout(_collSearchTimer);
  _collSearchTimer = setTimeout(updateCollection, 120);
}

function renderGallery() {
  const search = (document.getElementById('gallery-search')?.value || '').toLowerCase();
  const ownedOnly = galleryOwnedFilter === 'OWNED';

  const setFilterIds = gallerySetFilter === 'ALL' ? null
    : new Set((SETS.find(s => s.id === gallerySetFilter)?.cards || []).map(c => c.id));

  const filtered = getAllSetCards().filter(card => {
    if (!cardIdMatchesSeries(card.id, galleryFormat)) return false;
    if (!cardMatchesPlayFormat(card.id, galleryPlayFormat)) return false;
    if (ownedOnly && !(collection[card.id]?.count > 0)) return false;
    if (setFilterIds && !setFilterIds.has(card.id)) return false;
    if (galleryRarityFilter !== 'ALL') {
      const r = galleryRarityFilter;
      const match = r === 'RRR' ? (card.rarity === 'RRR' || card.rarity === 'OR')
                  : r === 'H'   ? card.rarity === 'H'
                  : r === 'ORR' ? card.rarity === 'ORR'
                  : r === 'DSR' ? card.rarity === 'DSR'
                  : card.rarity === r;
      if (!match) return false;
    }
    if (galleryClanFilter !== 'ALL' && card.clan !== galleryClanFilter) return false;
    if (galleryTypeFilter === 'Wishlist') return wishlist.has(card.id);
    if (galleryTypeFilter !== 'ALL') {
      const tf = galleryTypeFilter;
      if      (tf === 'Token')           { if (!card.token) return false; }
      else if (tf === 'Persona Ride')    { if (!card.personaRide) return false; }
      else if (tf === '📋 Normal Order') { if (card.order !== 'Normal Order') return false; }
      else if (tf === '⚡ Blitz Order')  { if (card.order !== 'Blitz Order') return false; }
      else if (tf === '📌 Set Order')    { if (card.order !== 'Set Order') return false; }
      else if (tf === 'Sentinel')        { if (!isSentinel(card)) return false; }
      else if (tf === '🔵 Front')        { if (getTriggerType(card) !== 'Front') return false; }
      else if (tf === '⚡ Overtrigger')  { if (getTriggerType(card) !== 'Overtrigger') return false; }
      else if (tf === 'Trigger')         { if (!isTrigger(card)) return false; }
      else if (tf === '🗡 Critical' || tf === 'Critical') { if (getTriggerType(card) !== 'Critical') return false; }
      else if (tf === '🃏 Draw'     || tf === 'Draw')     { if (getTriggerType(card) !== 'Draw') return false; }
      else if (tf === '🔄 Stand'    || tf === 'Stand')    { if (getTriggerType(card) !== 'Stand') return false; }
      else if (tf === '💚 Heal'     || tf === 'Heal')     { if (!isHeal(card)) return false; }
      else if (tf === 'Normal') { if (isTrigger(card) || isSentinel(card) || isGUnit(card) || card.token || card.order || card.personaRide) return false; }
    }
    if (galleryGradeFilter === 'GUNITS') { if (!isGUnit(card)) return false; }
    else if (galleryGradeFilter !== 'ALL' && card.grade !== parseInt(galleryGradeFilter)) return false;
    if (search && !card.name.toLowerCase().includes(search) && !card.clan.toLowerCase().includes(search)) return false;
    return true;
  });

  const missingFirst = document.getElementById('gallery-missing-sort')?.checked;
  const sorted = sortCardList(filtered, gallerySortBy, gallerySortDir, missingFirst);
  // Float FV card to the very top
  if (fvCard) {
    const fvIdx = sorted.findIndex(c => c.id === fvCard.id);
    if (fvIdx > 0) { sorted.unshift(sorted.splice(fvIdx, 1)[0]); }
  }
  const grid = document.getElementById('gallery-grid');

  function makeGalleryCard(card) {
    const owned = collection[card.id];
    const count = owned ? owned.count : 0;
    return `<div class="gallery-card rarity-card-${card.rarity} ${count===0?'not-owned':''} ${fvCard&&fvCard.id===card.id?'gallery-fv-card':''}" onclick="openZoom(getAllCardById('${card.id}'))">
      ${seriesTagHtml(card.id)}
      <img class="gc-img" data-id="${card.id}" alt="${card.name}"
           loading="lazy" onerror="(function(el){if(!el._cands){el._cands=cardImgCandidates(el.dataset.id);el._ci=1;}if(el._ci<el._cands.length){el.src=el._cands[el._ci++];}else{el.style.display='none';el.nextElementSibling&&(el.nextElementSibling.style.display='flex');}})(this)"
           src="${cardImgPath(card.id)}">
      <div class="gc-fallback" style="display:none"><span style="font-size:32px">${card.icon}</span><span style="font-size:9px;color:var(--text-muted);text-align:center;padding:0 4px">${card.name}</span></div>
      ${count>0?`<span class="gc-count">${count}x</span>`:''}
      <span class="gc-rarity rarity-badge ${card.rarity}">${card.rarity}</span>
      <span style="position:absolute;bottom:5px;left:5px;background:rgba(0,0,0,0.72);color:rgba(255,255,255,0.85);font-size:8px;font-weight:700;padding:2px 5px;border-radius:3px;z-index:4;pointer-events:none">G${card.grade}</span>
      <span style="position:absolute;bottom:20px;right:3px;background:rgba(0,0,0,0.65);color:rgba(255,255,255,0.75);font-size:7px;font-family:monospace;padding:1px 3px;border-radius:2px;z-index:4;pointer-events:none">${getCardNum(card.id)}</span>
      ${(()=>{
        if(card.token)   return '<div style="position:absolute;top:22px;left:3px;background:rgba(100,100,100,0.85);color:#fff;font-size:7px;font-weight:700;padding:1px 5px;border-radius:3px;z-index:6;pointer-events:none">TOKEN</div>';
        if(card.order)   { const ol={['Normal Order']:'N.ORD',['Blitz Order']:'BLITZ',['Set Order']:'S.ORD'}; return `<div style="position:absolute;top:22px;left:3px;background:rgba(59,130,246,0.85);color:#fff;font-size:7px;font-weight:700;padding:1px 5px;border-radius:3px;z-index:6;pointer-events:none">${ol[card.order]||'ORDER'}</div>`; }
        if(isSentinel(card)) return '<div style="position:absolute;top:22px;left:3px;background:rgba(240,180,41,0.9);color:#000;font-size:7px;font-weight:700;padding:1px 5px;border-radius:3px;z-index:6;pointer-events:none">🛡 SENT</div>';
        const tt=getTriggerType(card);
        if(!tt) return '';
        const tLabels={Critical:'CRIT',Draw:'DRAW',Stand:'STND',Heal:'HEAL',Front:'FRNT',Overtrigger:'OT'};
        return `<div style="position:absolute;top:22px;left:3px;background:${getTriggerColor(tt)};color:#fff;font-size:7px;font-weight:700;padding:1px 5px;border-radius:3px;z-index:6;pointer-events:none">${tLabels[tt]||tt}</div>`;
      })()}
    </div>`;
  }

  const CHUNK = 80;
  const _myGalEpoch = ++_galRenderEpoch;
  grid.innerHTML = sorted.slice(0, CHUNK).map(makeGalleryCard).join('');
  let idx = CHUNK;
  function appendChunk() {
    if (_myGalEpoch !== _galRenderEpoch) return;
    if (idx >= sorted.length) return;
    const frag = document.createDocumentFragment();
    const div = document.createElement('div');
    div.innerHTML = sorted.slice(idx, idx + CHUNK).map(makeGalleryCard).join('');
    while (div.firstChild) frag.appendChild(div.firstChild);
    grid.appendChild(frag);
    idx += CHUNK;
    requestIdleCallback ? requestIdleCallback(appendChunk) : setTimeout(appendChunk, 16);
  }
  requestIdleCallback ? requestIdleCallback(appendChunk) : setTimeout(appendChunk, 16);
}

let deck = {};

const DECK_MAX = 50;
const CARD_MAX_COPIES = 4;

const SENTINEL_IDS = new Set([
  // BT01-05
  'BT01_011EN','BT01_015EN','BT01_019EN',
  'BT02_010EN','BT02_014EN','BT02_019EN',
  'BT03_011EN','BT03_016EN','BT03_017EN',
  'BT04_011EN','BT04_014EN','BT04_017EN',
  'BT05_011EN','BT05_013EN',
  // BT06-17
  'BT06_012EN','BT06_017EN','BT06_020EN',
  'BT07_012EN',
  'BT08_019EN',
  'BT09_014EN','BT09_016EN',
  'BT10_010EN','BT10_011EN','BT10_015EN','BT10_017EN','BT10_020EN',
  'BT11_009EN','BT11_011EN','BT11_015EN','BT11_020EN',
  'BT12_011EN','BT12_014EN','BT12_017EN','BT12_020EN',
  'BT13_011EN','BT13_013EN','BT13_014EN',
  'BT14_011EN','BT14_012EN','BT14_013EN','BT14_016EN','BT14_020EN',
  'BT15_010EN','BT15_015EN','BT15_017EN','BT15_020EN',
  'BT16_014EN','BT16_015EN','BT16_017EN','BT16_021EN','BT16_022EN','BT16_025EN','BT16_026EN',
  'BT17_013EN','BT17_014EN','BT17_016EN','BT17_018EN','BT17_020EN','BT17_022EN','BT17_024EN','BT17_026EN',
  // EB sets (incl. SP versions)
  'EB02_007EN',
  'EB04_007EN','EB05_007EN','EB06_007EN','EB07_007EN',
  'EB08_008EN','EB08_S04EN',
  'EB09_008EN',
  'EB10_007EN-B','EB10_007EN-W','EB10_008EN-B','EB10_008EN-W',
  'EB10_S07EN-B','EB10_S07EN-W','EB10_S08EN-B','EB10_S08EN-W',
  // old-style IDs (legacy saves)
  'EB10_007B','EB10_007W','EB10_008B','EB10_008W',
  'EB11_008EN','EB11_S04EN',
  'EB12_007EN','EB12_008EN',
  // G Trial Decks
  'GTD01_013EN','GTD02_013EN','GTD03_012EN',
  'GTD04_012EN','GTD05_011EN','GTD06_012EN',
  // G Boosters / G Extra
  'GBT01_011EN','GBT01_013EN','GBT01_016EN','GBT01_018EN','GBT01_021EN',
  'GBT02_014EN','GBT02_018EN','GBT02_020EN','GBT02_021EN',
  'GEB01_007EN',
  'GCB01_011EN',
]);

function _getCardTrigger(card) {
  if (card.trigger) return card.trigger;
  if (card.rarity === 'SP' || card.rarity === 'TD') {
    const base = resolveBaseCard(card);
    if (base && base.trigger) return base.trigger;
  }
  return null;
}

function getTriggerType(card) {
  if (card.grade !== 0) return null;
  const t = _getCardTrigger(card);
  if (t === 'Heal')        return 'Heal';
  if (t === 'Critical')    return 'Critical';
  if (t === 'Draw')        return 'Draw';
  if (t === 'Stand')       return 'Stand';
  if (t === 'Front')       return 'Front';
  if (t === 'Overtrigger' || t === 'Over') return 'Overtrigger';
  return null;
}

function getUnitType(card) {
  if (card.token)  return 'Token';
  if (card.order)  return card.order; // "Normal Order", "Blitz Order", "Set Order"
  if (card.grade === 0) {
    const t = getTriggerType(card);
    if (t === 'Overtrigger') return 'Overtrigger';
    return t ? t + ' Trigger' : 'G0 Unit';
  }
  return 'Normal Unit';
}

function getTriggerColor(type) {
  return {
    'Critical':    'rgba(240,180,41,0.85)',
    'Draw':        'rgba(230,120,40,0.85)',
    'Stand':       'rgba(59,130,246,0.85)',
    'Heal':        'rgba(61,191,127,0.85)',
    'Front':       'rgba(220,60,180,0.85)',
    'Overtrigger': 'rgba(167,139,250,0.85)',
  }[type] || 'rgba(0,0,0,0.65)';
}

function getCardNum(id) {
  // e.g. "BT01_011EN" → "011EN", "GBT01_021EN" → "021EN", "EB10_007EN-B" → "007EN-B"
  const m = id.match(/_(\d+[A-Z]*(?:-[A-Z])?)$/);
  return m ? m[1] : id;
}

function getCardSetLabel(id) {
  const setId = id.split('_')[0] || '';
  const num = getCardNum(id);
  return setId ? `${setId} · ${num}` : num;
}

const FOIL_RARITIES = new Set(['RRR','SP','GR','LR','SCR','SGR','OR','H','ORR','DSR']);

function isToken(card) { return !!(card && card.token); }
function isOrder(card) { return !!(card && card.order); }
function isOvertrigger(card) { return !!(card && (card.overtrigger || getTriggerType(card) === 'Overtrigger')); }

function isFirstVanguard(card) { return card.grade === 0; }

function isTrigger(card) {
  if (card.grade !== 0) return false;
  const t = getTriggerType(card);
  return !!t && t !== 'Overtrigger'; // Overtrigger is a special G0, not a normal trigger
}

function isHeal(card) {
  return getTriggerType(card) === 'Heal';
}

function isSentinel(card) {
  if (_getCardTrigger(card) === 'Sentinel') return true;
  if (SENTINEL_IDS.has(card.id)) return true;
  if (card.rarity === 'SP') {
    const base = resolveBaseCard(card);
    if (base && (_getCardTrigger(base) === 'Sentinel' || SENTINEL_IDS.has(base.id))) return true;
  }
  return false;
}
function isSentinelResolved(card) {
  if (SENTINEL_IDS.has(card.id)) return true;
  if (card.rarity === 'SP') {
    const base = resolveBaseCard(card);
    if (base && SENTINEL_IDS.has(base.id)) return true;
  }
  return false;
}
function resolveBaseCard(card) {
  const baseName = card.name.replace(/ \(SP\)$/, '');
  return getAllSetCards().find(c => c.name === baseName && c.grade === card.grade && c.rarity !== 'SP') || null;
}

function getDeckClan() {
  for (const {card} of Object.values(deck)) {
    if (card.grade >= 1 && !isGUnit(card)) return card.clan;
  }
  for (const {card} of Object.values(deck)) {
    if (!isGUnit(card)) return card.clan;
  }
  if (fvCard) return fvCard.clan;
  return null;
}

function openDeckBuilder() {

  updatePlayFormatTabUI('dp-pf-', deckPlayFormat);
  buildDeckPoolFilters();
  renderDeckPool();
  renderDeckPanel();
  document.getElementById('deck-overlay').classList.add('active');
}
function closeDeckBuilder() { document.getElementById('deck-overlay').classList.remove('active'); }

function toggleDeckListDrawer() {
  const drawer = document.getElementById('deck-list-drawer');
  if (drawer) drawer.classList.toggle('open');
}

function toggleDeckFilters() {
  const panel = document.getElementById('dp-filter-panel');
  const btn = document.getElementById('dp-filter-toggle');
  if (!panel) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'flex';
  if (btn) btn.classList.toggle('active', !open);
}

// ── Floating card hover tooltip ──
let _chtTimer = null;
function previewCard(id) {
  clearTimeout(_chtTimer);
  const card = getAllCardById(id);
  if (!card) return;
  const tip = document.getElementById('card-hover-tip');
  if (!tip) return;
  const imgEl = document.getElementById('cht-img');
  const fbEl  = document.getElementById('cht-fallback');
  if (imgEl) {
    imgEl.style.display = 'block';
    imgEl.src = cardImgPath(card.id);
    imgEl.dataset.id = card.id;
    imgEl.onerror = function() {
      imgEl.style.display = 'none';
      if (fbEl) { fbEl.style.display = 'flex'; fbEl.textContent = card.icon; }
    };
    if (fbEl) fbEl.style.display = 'none';
  }
  tip.classList.add('visible');
}
function clearPreview() {
  _chtTimer = setTimeout(() => {
    const tip = document.getElementById('card-hover-tip');
    if (tip) tip.classList.remove('visible');
  }, 60);
}
// Follow the mouse
document.addEventListener('mousemove', e => {
  const tip = document.getElementById('card-hover-tip');
  if (!tip || !tip.classList.contains('visible')) return;
  const tw = 130, th = 190;
  let x = e.clientX + 14, y = e.clientY - th / 2;
  if (x + tw > window.innerWidth  - 8) x = e.clientX - tw - 14;
  if (y < 8) y = 8;
  if (y + th > window.innerHeight - 8) y = window.innerHeight - th - 8;
  tip.style.left = x + 'px';
  tip.style.top  = y + 'px';
}, { passive: true });

let deckPoolClanFilter = 'ALL';
let _dpRenderEpoch = 0;
let deckPoolTypeFilter = 'ALL';
let deckPoolGradeFilter = 'ALL';
let deckPoolSetFilter = 'ALL';
let deckPoolRarityFilter = 'ALL';
function buildDeckPoolFilters() {

  const lockedClan = getDeckClan();
  const EXTRA_CLANS = ['Angel Feather','Dimension Police','Gear Chronicle','Genesis','Link Joker','Neo Nectar','Pale Moon'];
  let clans = ['ALL', ...new Set([...getAllSetCards().map(c=>c.clan), ...EXTRA_CLANS])].sort((a,b)=>a==='ALL'?-1:a.localeCompare(b));
  if (lockedClan) clans = [lockedClan];
  const _dpInFmt = s => deckPoolFormat === 'ALL' || setMatchesFormat(s, deckPoolFormat);
  const sets = ['ALL', ...SETS.filter(s => _dpInFmt(s)).map(s => s.id)];
  const RARITY_ORDER_ALL2 = ['ALL','C','R','H','RR','RRR','ORR','SP','DSR','LR','SCR','GR','SGR'];
  const presentRarities2 = new Set(getAllSetCards().map(c=>c.rarity));
  const rarities = RARITY_ORDER_ALL2.filter(r => r==='ALL'||presentRarities2.has(r));
  const hasD = SETS.some(s => s.format === 'D');
  const basePoolTypes = ['ALL','Normal','Trigger','🗡 Critical','🃏 Draw','🔄 Stand','💚 Heal','🔵 Front','⚡ Overtrigger','Sentinel'];
  const dPoolTypes = hasD ? ['📋 Normal Order','⚡ Blitz Order','📌 Set Order','Persona Ride'] : [];
  const types = [...basePoolTypes, ...dPoolTypes];
  const maxGrade2 = Math.max(...getAllSetCards().map(c=>c.grade));
  const grades = ['ALL',...Array.from({length:maxGrade2+1},(_,i)=>String(i))];
  const btn = filterChipBtn;
  document.getElementById('dp-set-filters').innerHTML = sets.map(s => btn(s==='ALL'?'All Sets':s, s===deckPoolSetFilter, `setDeckPoolSet('${s}')`)).join('');
  document.getElementById('dp-clan-filters').innerHTML = lockedClan
    ? `<span class="filter-btn active filter-locked" style="font-size:10px;padding:4px 10px;cursor:default">🔒 ${lockedClan}</span>`
    : clans.map(c => btn(c==='ALL'?'All Clans':c, c===deckPoolClanFilter, `setDeckPoolClan('${c}')`)).join('');
  document.getElementById('dp-rarity-filters').innerHTML = rarities.map(r => btn(r==='ALL'?'All Rarity':r, r===deckPoolRarityFilter, `setDeckPoolRarity('${r}')`)).join('');
  document.getElementById('dp-type-filters').innerHTML = types.map(t => btn(t==='ALL'?'All Types':t, t===deckPoolTypeFilter, `setDeckPoolType('${t}')`)).join('');
  const hasGUnitsDP = getAllSetCards().some(c=>isGUnit(c));
  const gUnitBtnDP = hasGUnitsDP ? btn('✨ G Units','GUNITS'===deckPoolGradeFilter,"setDeckPoolGrade('GUNITS')") : '';
  document.getElementById('dp-grade-filters').innerHTML =
    grades.map(g => btn(g==='ALL'?'All Grades':'Grade '+g, g===deckPoolGradeFilter, `setDeckPoolGrade('${g}')`)).join('') + gUnitBtnDP;
  const poolEl = document.getElementById('dp-pool-filters');
  if (poolEl) {
    poolEl.innerHTML = [
      btn('Owned Only', !deckShowAllCards, `setDeckShowAllCards(false)`),
      btn('All Cards', deckShowAllCards, `setDeckShowAllCards(true)`),
    ].join('');
  }
  const playFmtEl = document.getElementById('dp-play-format-filters');
  if (playFmtEl) {
    playFmtEl.innerHTML = PLAY_FORMATS.map(pf =>
      btn(pf, deckPlayFormat === pf, `setDeckPlayFormat('${pf}')`)
    ).join('');
  }
  const sortByEl = document.getElementById('dp-sort-by-filters');
  if (sortByEl) {
    sortByEl.innerHTML = [
      ['rarity','Rarity'],['grade','Grade'],['setno','Set No.'],['name','Name'],['owned','Owned'],
    ].map(([k, lab]) => btn(lab, deckSortBy === k, `setDeckSort('${k}','${deckSortDir}')`)).join('');
  }
  const sortDirEl = document.getElementById('dp-sort-dir-filters');
  if (sortDirEl) {
    sortDirEl.innerHTML = [
      btn('↑ Asc', deckSortDir === 'asc', `setDeckSort('${deckSortBy}','asc')`),
      btn('↓ Desc', deckSortDir === 'desc', `setDeckSort('${deckSortBy}','desc')`),
    ].join('');
  }
}

function setDeckSort(by, dir) {
  deckSortBy = by;
  deckSortDir = dir;
  const ownedChk = document.getElementById('deck-sort-owned');
  if (ownedChk) ownedChk.checked = by === 'owned';
  buildDeckPoolFilters();
  renderDeckPool();
}

function setDeckPlayFormat(pf) {
  deckPlayFormat = pf;
  updatePlayFormatTabUI('dp-pf-', pf);
  buildDeckPoolFilters();
  renderDeckPool();
  renderDeckPanel();
}
function setDeckPoolFormat(fmt) {
  deckPoolFormat = fmt;
  deckPoolSetFilter = 'ALL';
  updateFormatTabUI('dp-fmt-', fmt);
  buildDeckPoolFilters(); renderDeckPool();
}

function setDeckShowAllCards(on) {
  deckShowAllCards = !!on;
  const chk = document.getElementById('deck-show-all-cards');
  if (chk) chk.checked = deckShowAllCards;
  buildDeckPoolFilters();
  renderDeckPool();
}
function setDeckPoolClan(c) {
  const locked = getDeckClan();
  if (locked && c !== locked) {
    showToast({icon:'🔒',name:`Clan locked to ${locked}`,rarity:'C'});
    return;
  }
  deckPoolClanFilter=c;
  buildDeckPoolFilters();
  renderDeckPool();
}
function setDeckPoolType(t) { deckPoolTypeFilter=t; buildDeckPoolFilters(); renderDeckPool(); }
function setDeckPoolGrade(g) { deckPoolGradeFilter=g; buildDeckPoolFilters(); renderDeckPool(); }
function setDeckPoolSet(s) { deckPoolSetFilter=s; buildDeckPoolFilters(); renderDeckPool(); }
function setDeckPoolRarity(r) { deckPoolRarityFilter=r; buildDeckPoolFilters(); renderDeckPool(); }

function renderDeckPool() {

  const deckSearch = (document.getElementById('deck-search')?.value||'').toLowerCase();
  const lockedClan = getDeckClan();
  const dpSetFilterIds = deckPoolSetFilter === 'ALL' ? null
    : new Set((SETS.find(s => s.id === deckPoolSetFilter)?.cards || []).map(c => c.id));

  // Cards currently in deck or set as FV always bypass filters so they're never hidden
  const alwaysShow = new Set(Object.keys(deck));
  if (fvCard) alwaysShow.add(fvCard.id);

  const allCards = getAllSetCards().filter(card => {
    // Tokens are gallery-only — never in deck building
    if (card.token) return false;
    const pinned = alwaysShow.has(card.id);
    if (!pinned) {
      if (!deckShowAllCards && !(collection[card.id]?.count > 0)) return false;
      if (lockedClan && !isClanAllowed(card, lockedClan)) return false;
      if (!cardIdMatchesSeries(card.id, deckPoolFormat)) return false;
      if (!cardMatchesPlayFormat(card.id, deckPlayFormat)) return false;
      if (dpSetFilterIds && !dpSetFilterIds.has(card.id)) return false;
      if (deckPoolRarityFilter !== 'ALL') { const rMatch = deckPoolRarityFilter === 'RRR' ? (card.rarity === 'RRR' || card.rarity === 'OR') : card.rarity === deckPoolRarityFilter; if (!rMatch) return false; }
      if (deckPoolTypeFilter !== 'ALL') {
        const tf = deckPoolTypeFilter;
        if      (tf === 'Persona Ride')    { if (!card.personaRide) return false; }
        else if (tf === '📋 Normal Order') { if (card.order !== 'Normal Order') return false; }
        else if (tf === '⚡ Blitz Order')  { if (card.order !== 'Blitz Order') return false; }
        else if (tf === '📌 Set Order')    { if (card.order !== 'Set Order') return false; }
        else if (tf === 'Sentinel')        { if (!isSentinel(card)) return false; }
        else if (tf === '🔵 Front')        { if (getTriggerType(card) !== 'Front') return false; }
        else if (tf === '⚡ Overtrigger')  { if (getTriggerType(card) !== 'Overtrigger') return false; }
        else if (tf === 'Trigger')         { if (!isTrigger(card)) return false; }
        else if (tf === '🗡 Critical' || tf === 'Critical') { if (getTriggerType(card) !== 'Critical') return false; }
        else if (tf === '🃏 Draw'     || tf === 'Draw')     { if (getTriggerType(card) !== 'Draw') return false; }
        else if (tf === '🔄 Stand'    || tf === 'Stand')    { if (getTriggerType(card) !== 'Stand') return false; }
        else if (tf === '💚 Heal'     || tf === 'Heal')     { if (!isHeal(card)) return false; }
        else if (tf === 'Normal') { if (isTrigger(card) || isSentinel(card) || isGUnit(card) || card.order || card.personaRide) return false; }
      }
      if (deckPoolGradeFilter === 'GUNITS') { if (!isGUnit(card)) return false; }
      else if (deckPoolGradeFilter !== 'ALL' && card.grade !== parseInt(deckPoolGradeFilter)) return false;
      if (deckSearch && !card.name.toLowerCase().includes(deckSearch) && !card.clan.toLowerCase().includes(deckSearch)) return false;
    }
    return true;
  });

  if (document.getElementById('deck-sort-owned')?.checked) {
    deckSortBy = 'owned';
    deckSortDir = 'desc';
  }
  const sortedCards = sortCardList(allCards, deckSortBy, deckSortDir, false);
  const deckCounts = {};
  for (const [id, {count}] of Object.entries(deck)) deckCounts[id] = count;

  // Grade-order comparator: FV → G Units → G3→G1 → G0 normal → G0 triggers
  function gradeOrder(card) {
    if (fvCard && fvCard.id === card.id) return -1;
    if (isGUnit(card)) return 0;
    if (card.grade > 0) return card.grade === 3 ? 1 : card.grade === 2 ? 2 : 3; // G3, G2, G1
    return isTrigger(card) ? 5 : 4; // G0 normal then G0 trigger
  }

  sortedCards.sort((a, b) => {
    const aIn = alwaysShow.has(a.id) ? 0 : 1;
    const bIn = alwaysShow.has(b.id) ? 0 : 1;
    if (aIn !== bIn) return aIn - bIn;       // In-deck group first
    const go = gradeOrder(a) - gradeOrder(b);
    if (go !== 0) return go;                 // Within group: grade order
    return a.name.localeCompare(b.name);     // Alphabetical tiebreak
  });

  document.getElementById('deck-pool-grid').innerHTML = '';
  const dpGrid = document.getElementById('deck-pool-grid');

  function makeDeckCard(card) {
    const owned = collection[card.id]?.count || 0;
    const unowned = owned < 1;
    const inDeck = deckCounts[card.id] || 0;
    const isTheFV = fvCard && fvCard.id === card.id;
    const deckFull = isGUnit(card) ? getGZoneTotal() >= 16 : getDeckTotal() >= DECK_MAX;
    const nameCopies = countByName(getDeckName(card));
    const nameMaxed = nameCopies >= CARD_MAX_COPIES;
    const fvUsesThisId = isTheFV ? 1 : 0;
    const noMoreCopies = (inDeck + fvUsesThisId) >= owned;
    const deckClanNow = getDeckClan();
    const wrongClan = !isClanAllowed(card, deckClanNow);
    if (wrongClan && deckClanNow) return null;
    const addBlocked = unowned || deckFull || nameMaxed || noMoreCopies;
    let dimReason = unowned ? 'Not in collection' : nameMaxed ? `Max 4 copies of "${card.name}"` : noMoreCopies ? 'No spare copies' : deckFull ? 'Deck full' : '';
    const svgHandler = '';
    const titleTip = `${card.name}${dimReason?' — '+dimReason:''}`;
    return `<div class="pool-card rarity-card-${card.rarity} ${addBlocked?'maxed':''} ${unowned?'not-owned':''} ${isTheFV?'svg-selected':''} ${inDeck>0?'pool-in-deck':''}"
      onclick="if(!this.classList.contains('maxed'))addToDeck(getAllCardById('${card.id}'))" title="${titleTip}"
      onmouseenter="previewCard('${card.id}')" onmouseleave="clearPreview()">
      ${seriesTagHtml(card.id)}
      <img data-id="${card.id}" alt="${card.name}" src="${cardImgPath(card.id)}"
           loading="lazy" onerror="(function(el){if(!el._cands){el._cands=cardImgCandidates(el.dataset.id);el._ci=1;}if(el._ci<el._cands.length){el.src=el._cands[el._ci++];}else{el.style.display='none';el.nextElementSibling&&(el.nextElementSibling.style.display=\'flex\');}})(this)">
      <div class="pc-fallback" style="display:none"><span>${card.icon}</span><span style="font-size:8px;text-align:center;padding:0 4px;color:var(--text-muted)">${card.name}</span></div>
      <span class="pc-count-badge">${owned}x</span>
      <span style="position:absolute;bottom:18px;left:3px;background:rgba(0,0,0,0.72);color:rgba(255,255,255,0.85);font-size:7px;font-weight:700;padding:1px 4px;border-radius:3px;z-index:5;pointer-events:none">G${card.grade}</span>
      ${isTheFV?'<div data-fv-badge style="position:absolute;top:20px;right:3px;background:rgba(79,142,247,0.9);color:white;font-size:7px;font-weight:700;padding:1px 4px;border-radius:3px;z-index:6;pointer-events:none">★FV</div>':''}
      <button class="wishlist-btn ${wishlist.has(card.id)?'active':''}" onclick="event.stopPropagation();toggleWishlist('${card.id}')" title="${wishlist.has(card.id)?'Remove from wishlist':'Add to wishlist'}">⭐</button>
      ${(()=>{
        if(card.token)   return '<div style="position:absolute;top:3px;left:3px;background:rgba(100,100,100,0.85);color:#fff;font-size:7px;font-weight:700;padding:1px 5px;border-radius:3px;z-index:6;pointer-events:none">TOKEN</div>';
        if(card.order)   { const ol={['Normal Order']:'N.ORD',['Blitz Order']:'BLITZ',['Set Order']:'S.ORD'}; return `<div style="position:absolute;top:3px;left:3px;background:rgba(59,130,246,0.85);color:#fff;font-size:7px;font-weight:700;padding:1px 5px;border-radius:3px;z-index:6;pointer-events:none">${ol[card.order]||'ORDER'}</div>`; }
        if(isSentinel(card)) return '<div style="position:absolute;top:3px;left:3px;background:rgba(240,180,41,0.9);color:#000;font-size:7px;font-weight:700;padding:1px 5px;border-radius:3px;z-index:6;pointer-events:none">🛡</div>';
        const tt=getTriggerType(card);
        if(!tt) return '';
        const tLabels={Critical:'CRIT',Draw:'DRAW',Stand:'STND',Heal:'HEAL',Front:'FRNT',Overtrigger:'OT'};
        return `<div style="position:absolute;top:3px;left:3px;background:${getTriggerColor(tt)};color:#fff;font-size:7px;font-weight:700;padding:1px 5px;border-radius:3px;z-index:6;pointer-events:none">${tLabels[tt]||tt}</div>`;
      })()}
      <div class="pc-deck-btns">
        ${card.grade===0 ? `<button class="pc-fv-btn ${isTheFV?'active':''}" onclick="event.stopPropagation();${isTheFV?`clearFV()`:`setFirstVanguard(getAllCardById('${card.id}'))`}" title="${isTheFV?'Remove as First Vanguard':'Set as First Vanguard'}">★FV</button>` : ''}
        <button class="pc-remove-btn" onclick="event.stopPropagation();removeFromDeck('${card.id}')" title="Remove one from deck">−</button>
        <span class="pc-deck-count">${inDeck>0?inDeck:''}</span>
        <button class="pc-add-btn" onclick="event.stopPropagation();addToDeck(getAllCardById('${card.id}'))" title="Add to deck">+</button>
      </div>
      <span style="position:absolute;bottom:3px;right:3px;background:rgba(0,0,0,0.6);color:rgba(255,255,255,0.7);font-size:6px;font-family:monospace;padding:1px 3px;border-radius:2px;pointer-events:none">${getCardNum(card.id)}</span>
    </div>`;
  }

  const DP_CHUNK = 80;
  const _myEpoch = ++_dpRenderEpoch;
  dpGrid.innerHTML = sortedCards.slice(0, DP_CHUNK).map(makeDeckCard).filter(Boolean).join('') || '<div style="color:var(--text-muted);font-size:13px;padding:20px">Open packs to get cards first!</div>';
  let dpIdx = DP_CHUNK;
  function appendDpChunk() {
    if (_myEpoch !== _dpRenderEpoch) return;
    if (dpIdx >= sortedCards.length) return;
    const frag = document.createDocumentFragment();
    const div = document.createElement('div');
    div.innerHTML = sortedCards.slice(dpIdx, dpIdx + DP_CHUNK).map(makeDeckCard).filter(Boolean).join('');
    while (div.firstChild) frag.appendChild(div.firstChild);
    dpGrid.appendChild(frag);
    dpIdx += DP_CHUNK;
    requestIdleCallback ? requestIdleCallback(appendDpChunk) : setTimeout(appendDpChunk, 16);
  }
  if (allCards.length > DP_CHUNK) requestIdleCallback ? requestIdleCallback(appendDpChunk) : setTimeout(appendDpChunk, 16);
}

let fvCard = null;

const CROSS_CLAN_ALLOW = {
  'Blaster Dark': ['Royal Paladin'],
};

function isClanAllowed(card, deckClan) {
  if (card.crayElemental) return true;
  if (!deckClan || card.clan === deckClan) return true;
  const exceptions = CROSS_CLAN_ALLOW[card.name];
  return exceptions && exceptions.includes(deckClan);
}

function isGUnit(card) {
  return !!(card && card.gUnit);
}

function getDeckName(card) {
  if (!card) return "";
  return card.name.replace(/ \(Noir\)$/, '').replace(/ \(Blanc\)$/, '');
}
function countByName(name) {
  let n = fvCard && getDeckName(fvCard) === name ? 1 : 0;
  for (const {card, count} of Object.values(deck)) {
    if (getDeckName(card) === name) n += count;
  }
  return n;
}

function getDeckTotal() {
  const svgCount = fvCard ? 1 : 0;
  return svgCount + Object.values(deck).reduce((s, x) => s + (isGUnit(x.card) ? 0 : x.count), 0);
}
function getGZoneTotal() {
  return Object.values(deck).reduce((s, x) => s + (isGUnit(x.card) ? x.count : 0), 0);
}

function addToDeck(card) {
  if (!card) return;
  const owned = collection[card.id]?.count || 0;
  if (!owned) { showToast({icon:'⚠️',name:'You don\'t own this card — enable All Cards to browse',rarity:'C'}); return; }

  if (!cardMatchesPlayFormat(card.id, deckPlayFormat)) {
    showToast({icon:'⚠️',name:`Not legal in ${deckPlayFormat} (card is ${getCardPlayFormat(card)} era)`,rarity:'C'});
    return;
  }

  const deckClan = getDeckClan();
  if (!isClanAllowed(card, deckClan)) {
    showToast({icon:'⚠️',name:`Deck must be 1 clan only (${deckClan})`,rarity:'C'}); return;
  }

  if (isGUnit(card)) {
    if (getGZoneTotal() >= 16) { showToast({icon:'⚠️',name:'G Zone is full (max 16 G Units)',rarity:'C'}); return; }
  } else {
    if (getDeckTotal() >= DECK_MAX) { showToast({icon:'⚠️',name:'Deck is full (50 cards incl. FV)',rarity:'C'}); return; }
  }

  const deckNameKey = getDeckName(card);
  const nameTotal = countByName(deckNameKey);
  if (nameTotal >= CARD_MAX_COPIES) {
    showToast({icon:'⚠️',name:`Max 4 copies of "${deckNameKey}" across all rarities`,rarity:'C'}); return;
  }

  const inDeck = deck[card.id]?.count || 0;
  const fvUsesThisId = fvCard && fvCard.id === card.id ? 1 : 0;
  if (inDeck + fvUsesThisId >= owned) {
    showToast({icon:'⚠️',name:`No more copies of ${card.id} available`,rarity:'C'}); return;
  }

  if (isSentinel(card)) {
    const sentinelCount = Object.values(deck).filter(x=>isSentinel(x.card)).reduce((s,x)=>s+x.count,0);
    if (sentinelCount >= 4) { showToast({icon:'⚠️',name:'Max 4 sentinels in a deck',rarity:'C'}); return; }
  }

  if (isHeal(card)) {
    const healCount = Object.values(deck).filter(x=>isHeal(x.card)).reduce((s,x)=>s+x.count,0);
    if (healCount >= 4) { showToast({icon:'⚠️',name:'Max 4 heal triggers in a deck',rarity:'C'}); return; }
  }

  if (isTrigger(card)) {
    const triggerCount = Object.values(deck).filter(x=>isTrigger(x.card)).reduce((s,x)=>s+x.count,0);
    const fvTrigger = (fvCard && isTrigger(fvCard)) ? 1 : 0;
    if (triggerCount + fvTrigger >= 16) { showToast({icon:'⚠️',name:'Max 16 triggers in a deck',rarity:'C'}); return; }
  }

  const clanBefore = getDeckClan();

  if (!deck[card.id]) deck[card.id] = { card, count: 0 };
  deck[card.id].count++;

  const clanAfter = getDeckClan();
  if (clanBefore !== clanAfter) buildDeckPoolFilters();
  renderDeckPool();
  renderDeckPanel();
}

function _refreshPoolCard(cardId) {
  const affected = new Set();
  affected.add(cardId);
  const card = getAllCardById(cardId);
  if (card) {
    const baseName = getDeckName(card);
    for (const {card:c} of Object.values(deck)) {
      if (getDeckName(c) === baseName) affected.add(c.id);
    }
    for (const c of getAllSetCards()) {
      if (getDeckName(c) === baseName && collection[c.id]) affected.add(c.id);
    }
  }
  const deckClanNow = getDeckClan();
  for (const id of affected) {
    const el = document.querySelector(`.pool-card img[data-id="${id}"]`)?.closest('.pool-card');
    if (!el) continue;
    const c = getAllCardById(id);
    if (!c) continue;
    const owned = collection[id]?.count || 0;
    const inDeck = deck[id]?.count || 0;
    const isTheFV = fvCard && fvCard.id === id;
    const gUnit = isGUnit(c);
    const deckFull = gUnit ? getGZoneTotal() >= 16 : getDeckTotal() >= DECK_MAX;
    const nameMaxed = countByName(getDeckName(c)) >= CARD_MAX_COPIES;
    const noMoreCopies = (inDeck + (isTheFV?1:0)) >= owned;
    const addBlocked = deckFull || nameMaxed || noMoreCopies;
    el.classList.toggle('maxed', addBlocked);
    el.classList.toggle('pool-in-deck', inDeck > 0);
    const badge = el.querySelector('.pc-count-badge');
    if (badge) badge.textContent = owned + 'x';
    // Live-update the deck count shown between +/− buttons
    const deckCountEl = el.querySelector('.pc-deck-count');
    if (deckCountEl) deckCountEl.textContent = inDeck > 0 ? inDeck : '';
    // Update FV badge (top-right second row)
    const fvBadge = el.querySelector('[data-fv-badge]');
    if (isTheFV && !fvBadge) {
      const d = document.createElement('div');
      d.setAttribute('data-fv-badge','');
      d.style.cssText = 'position:absolute;top:20px;right:3px;background:rgba(79,142,247,0.9);color:white;font-size:7px;font-weight:700;padding:1px 4px;border-radius:3px;z-index:6;pointer-events:none';
      d.textContent = '★FV';
      el.appendChild(d);
    } else if (!isTheFV && fvBadge) {
      fvBadge.remove();
    }
    // Update FV button active state and toggle action
    const fvBtn = el.querySelector('.pc-fv-btn');
    if (fvBtn) {
      fvBtn.classList.toggle('active', isTheFV);
      fvBtn.title = isTheFV ? 'Remove as First Vanguard' : 'Set as First Vanguard';
      fvBtn.onclick = (e) => { e.stopPropagation(); isTheFV ? clearFV() : setFirstVanguard(getAllCardById(id)); };
    }
    // Remove old pc-in-deck if present (legacy)
    const inDeckEl = el.querySelector('.pc-in-deck');
    if (inDeckEl) inDeckEl.remove();
  }
}

function setFirstVanguard(card) {
  if (!card) return;
  if (card.grade !== 0) { showToast({icon:'⚠️',name:'Only Grade 0 cards can be the First Vanguard (FV)',rarity:'C'}); return; }

  const owned = collection[card.id]?.count || 0;
  if (!owned) { showToast({icon:'⚠️',name:'You don\'t own this card',rarity:'C'}); return; }

  const deckClan = getDeckClan();
  if (!isClanAllowed(card, deckClan)) {
    showToast({icon:'⚠️',name:`First Vanguard must be ${deckClan} clan`,rarity:'C'}); return;
  }

  const oldFV = fvCard;

  const nameCountExFV = countByName(getDeckName(card)) - (oldFV && getDeckName(oldFV) === getDeckName(card) ? 1 : 0);
  if (nameCountExFV >= CARD_MAX_COPIES) {
    showToast({icon:'⚠️',name:`Already have 4 copies of "${card.name}" in deck`,rarity:'C'}); return;
  }

  const inDeckMain = deck[card.id]?.count || 0;
  const oldFVUsesThisId = oldFV && oldFV.id === card.id ? 1 : 0;
  if (inDeckMain + 1 - oldFVUsesThisId > owned) {
    showToast({icon:'⚠️',name:`Not enough copies of ${card.name} (need 1 spare for FV)`,rarity:'C'}); return;
  }

  if (!oldFV && getDeckTotal() >= DECK_MAX) {
    showToast({icon:'⚠️',name:'Deck is at 50 — remove a card before setting FV',rarity:'C'}); return;
  }

  fvCard = card;

  buildDeckPoolFilters();
  renderDeckPool();
  renderDeckPanel();
}

function clearFV() {
  fvCard = null;

  buildDeckPoolFilters();
  renderDeckPool();
  renderDeckPanel();
}

function removeFromDeck(cardId) {
  if (!deck[cardId]) return;
  const clanBefore = getDeckClan();
  deck[cardId].count--;
  if (deck[cardId].count <= 0) delete deck[cardId];
  const clanAfter = getDeckClan();
  if (clanBefore !== clanAfter) {
    buildDeckPoolFilters();
  }
  renderDeckPool();
  renderDeckPanel();
}

function clearDeck() {
  if (!confirm('Clear the entire deck?')) return;
  deck = {};
  fvCard = null;

  buildDeckPoolFilters();
  renderDeckPool();
  renderDeckPanel();
}

function renderDeckPanel() {
  const total = getDeckTotal();
  const pct = Math.min(100, (total/DECK_MAX)*100);
  const barColor = total > DECK_MAX ? 'var(--red)' : total === DECK_MAX ? 'var(--green)' : 'var(--accent)';
  document.getElementById('ds-total').textContent = total;
  document.getElementById('ds-bar').style.width = pct+'%';
  document.getElementById('ds-bar').style.background = barColor;

  const grades = {};
  let triggers=0, heals=0, crits=0, draws=0, stands=0, sentinels=0, gUnits=0;
  if (fvCard) {
    grades[0] = (grades[0]||0) + 1;
    if (isTrigger(fvCard))  triggers++;
    if (isHeal(fvCard))     heals++;
    if (isSentinel(fvCard)) sentinels++;
    const fvt = getTriggerType(fvCard);
    if (fvt === 'Critical') crits++;
    else if (fvt === 'Draw') draws++;
    else if (fvt === 'Stand') stands++;
  }
  for (const {card,count} of Object.values(deck)) {
    grades[card.grade] = (grades[card.grade]||0) + count;
    if (isTrigger(card))   triggers  += count;
    if (isHeal(card))      heals     += count;
    if (isSentinel(card))  sentinels += count;
    if (isGUnit(card))     gUnits    += count;
    const tt = getTriggerType(card);
    if (tt === 'Critical') crits  += count;
    else if (tt === 'Draw')  draws  += count;
    else if (tt === 'Stand') stands += count;
  }

  document.getElementById('ds-g0').textContent = grades[0]||0;
  document.getElementById('ds-g1').textContent = grades[1]||0;
  document.getElementById('ds-g2').textContent = grades[2]||0;
  document.getElementById('ds-g3').textContent = grades[3]||0;
  const g4el = document.getElementById('ds-g4');
  if (g4el) g4el.textContent = gUnits||0;
  const trigTotalEl = document.getElementById('ds-trig-total');
  if (trigTotalEl) trigTotalEl.textContent = triggers;
  const trigCritEl = document.getElementById('ds-trig-crit');
  if (trigCritEl) trigCritEl.textContent = crits;
  const trigDrawEl = document.getElementById('ds-trig-draw');
  if (trigDrawEl) trigDrawEl.textContent = draws;
  const trigStandEl = document.getElementById('ds-trig-stand');
  if (trigStandEl) trigStandEl.textContent = stands;
  const trigHealEl = document.getElementById('ds-trig-heal');
  if (trigHealEl) trigHealEl.textContent = heals;
  const sentinelEl = document.getElementById('ds-sentinel');
  if (sentinelEl) sentinelEl.textContent = sentinels;

  const checks = [
    { ok: total === DECK_MAX,        warn: total > 0 && total < DECK_MAX,  msg: 'Main ' + total + '/50' },
    { ok: !!fvCard,                  warn: false,                           msg: 'FV: ' + (fvCard ? '★ ' + fvCard.name : 'Not set — click ★FV on a G0 card') },
    { ok: !!getDeckClan(),           warn: false,                           msg: 'Clan: ' + (getDeckClan()||'None yet') },
    { ok: triggers === 16,           warn: triggers > 0 && triggers < 16,  msg: 'Triggers ' + triggers + '/16' },
    { ok: heals <= 4,                warn: heals > 0 && heals < 4,         msg: 'Heal ' + heals + '/4 max' },
    { ok: sentinels <= 4,            warn: sentinels > 0 && sentinels < 4, msg: 'Sentinel ' + sentinels + '/4 max' },
    { ok: gUnits === 16,             warn: gUnits > 0 && gUnits < 16,      msg: 'G Zone ' + gUnits + '/16' },
  ];
  document.getElementById('deck-validation').innerHTML = checks.map(c => {
    const cls = c.ok ? 'ok' : c.warn ? 'warn' : 'err';
    return '<div class="val-row" title="' + c.msg + '"><div class="val-dot ' + cls + '"></div><span style="color:' + (c.ok?'var(--text)':'var(--text-muted)') + '">' + c.msg + '</span></div>';
  }).join('');

  // ── Era mismatch indicator ──
  const contentsEra = detectDeckEraFromCards();
  const hasCards = fvCard || Object.keys(deck).length > 0;
  const mismatch = hasCards && (
    (deckPlayFormat === 'Standard' && contentsEra !== 'Standard') ||
    (deckPlayFormat === 'V-Premium' && contentsEra !== 'V-Premium') ||
    (deckPlayFormat === 'Premium' && contentsEra !== 'Premium')
  );
  const eraHtml = `<span style="color:var(--accent);font-weight:600">Format pool: ${deckPlayFormat}</span>` +
    (hasCards ? ` · <span style="color:${mismatch ? 'var(--gold)' : 'var(--text)'};font-weight:600">Deck era: ${contentsEra}${mismatch ? ' ⚠ mismatch' : ''}</span>` : '');
  const eraEl = document.getElementById('deck-era-display');
  if (eraEl) eraEl.innerHTML = eraHtml;
  const eraPanel = document.getElementById('deck-era-panel');
  if (eraPanel) eraPanel.innerHTML = eraHtml;

  const fvDisplay = document.getElementById('fv-display');
  if (fvDisplay) {
    if (fvCard) {
      fvDisplay.innerHTML =
        '<span style="font-weight:600;color:var(--text)">' + fvCard.icon + ' ' + fvCard.name + '</span>' +
        '<span style="display:block;margin-top:2px">' + fvCard.clan + ' · G' + fvCard.grade + ' · ' + fvCard.rarity + '</span>';
    } else {
      fvDisplay.textContent = 'Click ★FV on a G0 card in the pool';
    }
  }

  // ── Deck list ──
  const dclBody = document.getElementById('deck-list-col-body');
  const dclCount = document.getElementById('dcl-count');
  if (dclCount) dclCount.textContent = total + '/50';
  if (dclBody) {
    let dclHtml = '';
    // FV first
    if (fvCard) {
      dclHtml += '<div class="dcl-section-header" style="color:var(--accent)">Ride Deck</div>';
      dclHtml += `<div class="dcl-row" onclick="openZoom(getAllCardById('${fvCard.id}'))">
        <span style="font-size:10px">${fvCard.icon}</span>
        <span class="dcl-name">${fvCard.name}</span>
        <span class="dcl-badge">FV</span>
        <button class="dcl-remove" onclick="event.stopPropagation();clearFV()" title="Remove FV">✕</button>
      </div>`;
    }
    // G Zone
    const gZoneCards = Object.values(deck).filter(x => isGUnit(x.card));
    if (gZoneCards.length) {
      dclHtml += `<div class="dcl-section-header" style="color:#a78bfa">G Zone (${gUnits}/16)</div>`;
      gZoneCards.sort((a,b)=>a.card.name.localeCompare(b.card.name)).forEach(({card,count}) => {
        dclHtml += `<div class="dcl-row" onclick="openZoom(getAllCardById('${card.id}'))">
          <span style="font-size:10px">${card.icon}</span>
          <span class="dcl-name">${card.name}</span>
          <span class="dcl-cnt">${count}×</span>
          <button class="dcl-add" onclick="event.stopPropagation();addToDeck(getAllCardById('${card.id}'))" title="Add one">+</button>
          <button class="dcl-remove" onclick="event.stopPropagation();removeFromDeck('${card.id}')" title="Remove one">−</button>
        </div>`;
      });
    }
    // Main deck by grade descending
    const gradeColors = {0:'var(--rarity-c)',1:'var(--rarity-r)',2:'var(--rarity-rr)',3:'var(--rarity-rrr)'};
    for (let g = 3; g >= 0; g--) {
      const cards = Object.values(deck).filter(x => x.card.grade === g && !isGUnit(x.card));
      if (!cards.length) continue;
      const gc = gradeColors[g] || 'var(--text-muted)';
      const gTotal = cards.reduce((s,x)=>s+x.count,0);
      dclHtml += `<div class="dcl-section-header"><span style="color:${gc}">G${g}</span> <span style="font-weight:400">(${gTotal})</span></div>`;
      cards.sort((a,b)=>a.card.name.localeCompare(b.card.name)).forEach(({card,count}) => {
        const trigType = getTriggerType(card);
        const trigLabels = {Critical:'CRIT',Draw:'DRAW',Stand:'STND',Heal:'HEAL',Front:'FRNT',Overtrigger:'OT'};
        const trigBgColors = {Critical:'rgba(240,180,41,0.85)',Draw:'rgba(230,120,40,0.85)',Stand:'rgba(59,130,246,0.85)',Heal:'rgba(61,191,127,0.85)'};
        const tag = isSentinel(card)
          ? '<span class="dcl-badge" style="background:rgba(240,180,41,0.2);color:var(--gold)">🛡 Sent</span>'
          : trigType
            ? `<span class="dcl-badge" style="background:${trigBgColors[trigType]};color:#fff;font-weight:700">${trigLabels[trigType]||trigType}</span>`
            : '';
        dclHtml += `<div class="dcl-row" onclick="openZoom(getAllCardById('${card.id}'))">
          <span style="font-size:10px">${card.icon}</span>
          <span class="dcl-name">${card.name}</span>
          ${tag}
          <span class="dcl-cnt">${count}×</span>
          <button class="dcl-add" onclick="event.stopPropagation();addToDeck(getAllCardById('${card.id}'))" title="Add one">+</button>
          <button class="dcl-remove" onclick="event.stopPropagation();removeFromDeck('${card.id}')" title="Remove one">−</button>
        </div>`;
      });
    }
    dclBody.innerHTML = dclHtml || '<div style="color:var(--text-muted);font-size:10px;padding:12px 8px">No cards yet</div>';
  }
}






function exportDeck() {
  const name = document.getElementById('deck-name-input').value || 'My Deck';
  const total = getDeckTotal();
  const deckClan = getDeckClan();

  const maxGex = Math.max(4, ...Object.values(deck).map(x=>x.card.grade));
  const byGrade = {};
  for (let g=0; g<=maxGex; g++) byGrade[g]=[];
  for (const {card,count} of Object.values(deck)) byGrade[card.grade].push({card,count});
  for (let g=0; g<=maxGex; g++) byGrade[g].sort((a,b)=>a.card.name.localeCompare(b.card.name));

  let text = `===== ${name} =====\n`;
  text += `Clan: ${deckClan||'N/A'} | Total: ${total}/50\n\n`;

  if (fvCard) {
    const fvTag = isHeal(fvCard)?' [Heal]':isSentinel(fvCard)?' [Sentinel]':isTrigger(fvCard)?' [Trigger]':'';
    text += `── First Vanguard ──\n`;
    text += `1x ${fvCard.name} (${fvCard.id}) [${fvCard.rarity}]${fvTag}\n\n`;
  }
  for (const g of Array.from({length:maxGex+1},(_,i)=>maxGex-i)) {
    if (!byGrade[g].length) continue;
    const allGUnitsEx = byGrade[g].every(x=>isGUnit(x.card));
    const glabel = allGUnitsEx?`G Units (Grade ${g})`:`Grade ${g}`;
    text += `── ${glabel} ──\n`;
    for (const {card,count} of byGrade[g]) {
      const tag = isHeal(card)?' [Heal]':isSentinel(card)?' [Sentinel]':isTrigger(card)?' [Trigger]':isGUnit(card)?' [G Unit]':'';
      text += `${count}x ${card.name} (${card.id}) [${card.rarity}]${tag}\n`;
    }
    text += '\n';
  }
  text += `Generated by Vanguard Pack Simulator`;
  const promptedName = prompt('Save deck list as:', name + '_decklist') || name + '_decklist';
  const blob = new Blob([text], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = promptedName.replace(/[^a-z0-9_\u002D\s]/gi,'_') + '.txt';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast({icon:'📋',name:'Deck list downloaded!',rarity:'C'});
}
function closeExport() { document.getElementById('export-overlay').classList.remove('active'); }

// ==================== DECK IMPORT ====================
function openImportDeck() {
  document.getElementById('import-textarea').value = '';
  document.getElementById('import-preview').textContent = '';
  document.getElementById('import-overlay').classList.add('active');
}
function closeImportDeck() { document.getElementById('import-overlay').classList.remove('active'); }

function doImportDeck() {
  const raw = document.getElementById('import-textarea').value.trim();
  if (!raw) return;

  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  let importedName = null;
  let newDeck = {};
  let newFV = null;
  let isFVSection = false;
  let skipped = [], added = [], noOwn = [];

  // Parse format: "Nx Card Name (SET_NUM) [RRR] [tag]"
  // Also handle "──...──" section headers and "===== name =====" title lines
  const lineRe = /^(\d+)x\s+(.+?)\s+\(([A-Z0-9_]+)\)\s+\[([A-Z]+)\]/i;

  for (const line of lines) {
    // Deck name
    if (/^={3,}/.test(line)) {
      const m = line.match(/={3,}\s+(.+?)\s+={3,}/);
      if (m) importedName = m[1];
      continue;
    }
    // Section headers
    if (/^──/.test(line) || /^─{2,}/.test(line)) {
      isFVSection = line.toLowerCase().includes('vanguard');
      continue;
    }
    // Card lines
    const m = line.match(lineRe);
    if (!m) continue;

    const count = parseInt(m[1]);
    const cardId = m[3];
    const card = getAllCardById(cardId);

    if (!card) { skipped.push(cardId); continue; }

    const owned = collection[cardId]?.count || 0;
    if (!owned) { noOwn.push(card.name); continue; }

    if (isFVSection && card.grade === 0) {
      newFV = card;
      isFVSection = false;
      added.push(card.name + ' (FV)');
      continue;
    }

    const safeCount = Math.min(count, owned, CARD_MAX_COPIES);
    if (safeCount > 0) {
      newDeck[cardId] = { card, count: safeCount };
      added.push(`${safeCount}x ${card.name}`);
    }
  }

  if (!added.length && !newFV) {
    document.getElementById('import-preview').innerHTML =
      `<span style="color:var(--red)">⚠️ Nothing could be imported. Check your collection or paste format.</span>`;
    return;
  }

  // Confirm and apply
  const msg = [
    added.length ? `✅ ${added.length} entries imported` : '',
    noOwn.length ? `⚠️ ${noOwn.length} cards skipped (not owned)` : '',
    skipped.length ? `❌ ${skipped.length} IDs not recognised` : '',
  ].filter(Boolean).join(' · ');

  if (!confirm(`${msg}\n\nThis will replace your current deck. Continue?`)) return;

  deck = newDeck;
  fvCard = newFV;
  if (importedName) {
    const dn = document.getElementById('deck-name-input');
    if (dn) dn.value = importedName;
  }
  buildDeckPoolFilters();
  renderDeckPool();
  renderDeckPanel();
  closeImportDeck();
  showToast({ icon: '📥', name: `Deck imported! ${msg}`, rarity: 'RR' });
}

async function exportDeckImage() {
  const deckName = document.getElementById('deck-name-input').value || 'My Deck';
  const deckClan = getDeckClan() || 'N/A';
  const total    = getDeckTotal();

  const maxGimg = Math.max(4, ...Object.values(deck).map(x=>x.card.grade));
  const byGrade = {};
  for (let g=0; g<=maxGimg; g++) byGrade[g]=[];
  for (const {card,count} of Object.values(deck)) byGrade[card.grade].push({card,count});
  for (let g=0; g<=maxGimg; g++) byGrade[g].sort((a,b)=>a.card.name.localeCompare(b.card.name));

  const SCALE = 2;
  const CARD_W = 120, CARD_H = 175, GAP = 10, COLS = 10;
  const SECTION_HEADER_H = 36, TOP_H = 160, BOTTOM_PAD = 32;
  const COL_W = CARD_W + GAP;

  function gradeRows(g) {
    const cards = byGrade[g];
    if (!cards.length) return 0;
    const items = g === 0 && fvCard
      ? [{card:fvCard,count:1,isFV:true}, ...cards]
      : cards;
    return Math.ceil(items.length / COLS);
  }

  const sections = Array.from({length:maxGimg+1},(_,i)=>maxGimg-i);
  let totalHeight = TOP_H;
  for (const g of sections) {
    const rows = gradeRows(g);
    if (rows > 0) totalHeight += SECTION_HEADER_H + rows * (CARD_H + GAP) + GAP;
  }
  totalHeight += BOTTOM_PAD;

  const WIDTH = COLS * COL_W + GAP * 2;
  const canvas = document.createElement('canvas');
  canvas.width  = WIDTH  * SCALE;
  canvas.height = totalHeight * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = '#14171f';
  ctx.fillRect(0, 0, WIDTH, totalHeight);
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let x = 0; x < WIDTH; x += 20) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,totalHeight); ctx.stroke(); }
  for (let y2 = 0; y2 < totalHeight; y2 += 20) { ctx.beginPath(); ctx.moveTo(0,y2); ctx.lineTo(WIDTH,y2); ctx.stroke(); }

  const grad = ctx.createLinearGradient(0,0,WIDTH,0);
  grad.addColorStop(0,'#4f8ef7'); grad.addColorStop(1,'#7c3aed');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, 5);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px Arial';
  ctx.fillText(deckName, GAP*2, 44);

  // Clan · total · era pill — row 2
  ctx.fillStyle = 'rgba(79,142,247,0.18)';
  const deckEra = detectDeckEraFromCards();
  const subtitleText = `${deckClan}  ·  ${total} / 50  ·  ${deckEra}`;
  ctx.font = '14px Arial';
  const subtitleW = ctx.measureText(subtitleText).width + 24;
  roundRect(ctx, GAP*2, 54, subtitleW, 28, 6); ctx.fill();
  ctx.fillStyle = '#4f8ef7';
  ctx.fillText(subtitleText, GAP*2+12, 72);

  // Trigger counts — row 3, full width, no overlap
  const trigCounts = {Critical:0,Draw:0,Stand:0,Heal:0};
  let sentinelCount = 0, gUnitCount = getGZoneTotal();
  if (fvCard) { const t=getTriggerType(fvCard); if(t&&trigCounts[t]!==undefined) trigCounts[t]++; if(isSentinel(fvCard)) sentinelCount++; }
  for (const {card,count} of Object.values(deck)) { const t=getTriggerType(card); if(t&&trigCounts[t]!==undefined) trigCounts[t]+=count; if(isSentinel(card)) sentinelCount+=count; }
  const trigColors = {Critical:'#f0b429',Draw:'#e67820',Stand:'#3b82f6',Heal:'#3dbf7f'};
  let tx = GAP*2;
  const TRIG_Y = 92, TRIG_H = 26;
  ctx.font = 'bold 12px Arial';
  for (const [t,cnt] of Object.entries(trigCounts)) {
    if (!cnt) continue;
    const lbl = `${t}  ${cnt}x`;
    const tw = ctx.measureText(lbl).width + 20;
    ctx.fillStyle = trigColors[t]+'33'; roundRect(ctx,tx,TRIG_Y,tw,TRIG_H,6); ctx.fill();
    ctx.fillStyle = trigColors[t];
    ctx.fillText(lbl, tx+10, TRIG_Y+17); tx += tw + 6;
  }
  if (sentinelCount > 0) {
    const lbl = `🛡 Sentinel  ${sentinelCount}x`;
    const tw = ctx.measureText(lbl).width + 20;
    ctx.fillStyle = 'rgba(240,180,41,0.18)'; roundRect(ctx,tx,TRIG_Y,tw,TRIG_H,6); ctx.fill();
    ctx.fillStyle = '#f0b429';
    ctx.fillText(lbl, tx+10, TRIG_Y+17); tx += tw + 6;
  }
  if (gUnitCount > 0) {
    const lbl = `✨ G Zone  ${gUnitCount}/16`;
    const tw = ctx.measureText(lbl).width + 20;
    ctx.fillStyle = 'rgba(167,139,250,0.18)'; roundRect(ctx,tx,TRIG_Y,tw,TRIG_H,6); ctx.fill();
    ctx.fillStyle = '#a78bfa';
    ctx.fillText(lbl, tx+10, TRIG_Y+17);
  }

  let y = TOP_H;
  async function loadImg(src) {
    return new Promise(res => { const img=new Image(); img.crossOrigin='anonymous'; img.onload=()=>res(img); img.onerror=()=>res(null); img.src=src; });
  }
  const RARITY_COLORS = {RRR:'#f0b429',RR:'#a78bfa',R:'#60a5fa',C:'#6b7280',SP:'#f472b6',TD:'#9ca3af'};
  async function drawCardSlot(card, count, cx, cy, isFV=false) {
    const img = await loadImg(cardImgPath(card.id));
    if (img) { ctx.drawImage(img, cx, cy, CARD_W, CARD_H); }
    else {
      ctx.fillStyle = RARITY_COLORS[card.rarity]||'#374151'; roundRect(ctx,cx,cy,CARD_W,CARD_H,6); ctx.fill();
      ctx.fillStyle='#fff'; ctx.font='bold 9px Arial'; ctx.textAlign='center';
      const words=card.name.split(' '); let line='',lineY=cy+CARD_H/2-10;
      for(const w of words){const test=line+(line?` ${w}`:w);if(ctx.measureText(test).width>CARD_W-8){ctx.fillText(line,cx+CARD_W/2,lineY);lineY+=12;line=w;}else{line=test;}}
      if(line) ctx.fillText(line,cx+CARD_W/2,lineY); ctx.textAlign='left';
    }
    ctx.strokeStyle=isFV?'#4f8ef7':'rgba(255,255,255,0.15)'; ctx.lineWidth=isFV?2.5:1;
    roundRect(ctx,cx,cy,CARD_W,CARD_H,6); ctx.stroke();
    // Count badge — bottom-right, above set label, so it doesn't cover trigger tag
    if(count>1){ctx.fillStyle='rgba(0,0,0,0.82)';roundRect(ctx,cx+CARD_W-28,cy+CARD_H-36,25,18,4);ctx.fill();ctx.fillStyle='#fff';ctx.font='bold 11px Arial';ctx.textAlign='center';ctx.fillText(`${count}x`,cx+CARD_W-15,cy+CARD_H-23);ctx.textAlign='left';}
    // FV badge — top-left
    if(isFV){ctx.fillStyle='#4f8ef7';roundRect(ctx,cx+3,cy+3,34,16,4);ctx.fill();ctx.fillStyle='#fff';ctx.font='bold 9px Arial';ctx.textAlign='center';ctx.fillText('★ FV',cx+20,cy+14);ctx.textAlign='left';}
    // Trigger / Sentinel tag — top-right
    const trigType = getTriggerType(card);
    const isSent   = isSentinel(card);
    if (isSent || trigType) {
      const TRIG_COLORS = {Critical:'#f0b429',Draw:'#e67820',Stand:'#3b82f6',Heal:'#3dbf7f'};
      const TRIG_LABELS = {Critical:'CRIT',Draw:'DRAW',Stand:'STAND',Heal:'HEAL',Front:'FRONT',Overtrigger:'OT'};
      const tagBg  = isSent ? '#f0b429' : (TRIG_COLORS[trigType] || '#888');
      const tagFg  = isSent ? '#000'    : '#fff';
      const tagTxt = isSent ? '🛡'       : (TRIG_LABELS[trigType] || trigType.slice(0,4).toUpperCase());
      ctx.font = 'bold 8px Arial';
      const tw = ctx.measureText(tagTxt).width + 8;
      ctx.fillStyle = tagBg;
      roundRect(ctx, cx + CARD_W - tw - 3, cy + 3, tw, 15, 3);
      ctx.fill();
      ctx.fillStyle = tagFg;
      ctx.textAlign = 'center';
      ctx.fillText(tagTxt, cx + CARD_W - tw/2 - 3, cy + 13);
      ctx.textAlign = 'left';
    }
    const setLabel = getCardSetLabel(card.id);
    ctx.fillStyle='rgba(0,0,0,0.82)';roundRect(ctx,cx+3,cy+CARD_H-18,CARD_W-6,15,3);ctx.fill();
    ctx.fillStyle='#e8ecf4';ctx.font='bold 8px Consolas,monospace';ctx.textAlign='center';
    ctx.fillText(setLabel,cx+CARD_W/2,cy+CARD_H-7);ctx.textAlign='left';

  }

  for (const g of sections) {
    const items = g===0&&fvCard ? [{card:fvCard,count:1,isFV:true},...byGrade[g]] : byGrade[g].map(x=>({...x,isFV:false}));
    if (!items.length) continue;
    ctx.fillStyle='rgba(255,255,255,0.06)'; ctx.fillRect(0,y,WIDTH,SECTION_HEADER_H);
    const sectionIsGZone = byGrade[g].length > 0 && byGrade[g].every(x=>isGUnit(x.card));
    ctx.fillStyle='#4f8ef7'; ctx.font='bold 15px Arial'; ctx.fillText(sectionIsGZone ? 'G ZONE' : `GRADE ${g}`,GAP*2,y+23);
    ctx.fillStyle='#6b7280'; ctx.font='12px Arial';
    ctx.fillText(`${items.reduce((s,x)=>s+x.count,0)} cards`,GAP*2+110,y+23);
    y += SECTION_HEADER_H + GAP;
    for(let i=0;i<items.length;i++){const col=i%COLS,row=Math.floor(i/COLS);await drawCardSlot(items[i].card,items[i].count,GAP+col*COL_W,y+row*(CARD_H+GAP),items[i].isFV);}
    y += Math.ceil(items.length/COLS)*(CARD_H+GAP)+GAP;
  }

  ctx.fillStyle='#374151'; ctx.font='11px Arial'; ctx.textAlign='right';
  ctx.fillText('Generated by Vanguard Pack Simulator', WIDTH - GAP*2, totalHeight-10);
  ctx.textAlign='left';

  const defaultImgName = `${deckName.replace(/[^a-z0-9]/gi,'_')}_deck`;
  const promptedImgName = prompt('Save deck image as:', defaultImgName);
  if (promptedImgName === null) { showToast({icon:'❌',name:'Export cancelled',rarity:'C'}); return; }
  const finalImgName = (promptedImgName.trim() || defaultImgName).replace(/\.png$/i,'') + '.png';
  const link = document.createElement('a');
  link.download = finalImgName;
  link.href = canvas.toDataURL('image/png');
  link.click();
  showToast({icon:'🖼',name:'Deck image exported!',rarity:'C'});
}




function roundRect(ctx, x, y, w, h, r) {
  if (typeof r === 'object') {
    const {tl=0,tr=0,br=0,bl=0} = r;
    ctx.beginPath();
    ctx.moveTo(x+tl, y);
    ctx.lineTo(x+w-tr, y); ctx.quadraticCurveTo(x+w,y,x+w,y+tr);
    ctx.lineTo(x+w, y+h-br); ctx.quadraticCurveTo(x+w,y+h,x+w-br,y+h);
    ctx.lineTo(x+bl, y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-bl);
    ctx.lineTo(x, y+tl); ctx.quadraticCurveTo(x,y,x+tl,y);
    ctx.closePath();
  } else {
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x,y,x+r,y);
    ctx.closePath();
  }
}
function copyExport() {
  navigator.clipboard.writeText(document.getElementById('export-textarea').value);
  showToast({icon:'📋',name:'Deck list copied!',rarity:'R'});
}


function showToast(card) {
  const isSystem = ['✅','❌','⚠️','🗑️','📋'].includes(card.icon);
  const msgs = { RRR: '🌟 RRR Pull!', SP: '✨ SP Parallel!' };
  const classes = { RRR: 'rrr', SP: 'sp' };
  const toast = document.createElement('div');
  if (card._wishlistHit) { toast.className = 'toast rrr'; toast.textContent = `⭐ Wishlist Hit! ${card.name}`; document.getElementById('toast-container').appendChild(toast); setTimeout(() => toast.remove(), 4000); return; }
  toast.className = `toast ${classes[card.rarity]||''}`;
  if (isSystem) {
    toast.textContent = `${card.icon} ${card.name}`;
  } else {
    toast.textContent = `${card.icon} ${msgs[card.rarity]||''} ${card.name}`.trim();
  }
  const container = document.getElementById('toast-container');
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}


document.addEventListener('wheel', function(e) {
  const row = e.target.closest('.gallery-filter-row, .deck-filter-row, .filter-chip-row');
  if (row) { e.preventDefault(); row.scrollLeft += e.deltaY + e.deltaX; }
}, { passive: false });


function updatePityDisplay() {
  const el = document.getElementById('pity-count');
  const wrap = document.getElementById('pity-display');
  if (!el || !wrap) return;
  el.textContent = packsSinceLastRRR;
  const hot = packsSinceLastRRR >= 8;
  el.style.color = hot ? 'var(--gold)' : packsSinceLastRRR >= 5 ? 'var(--rarity-rr)' : 'var(--accent)';
  document.querySelectorAll('.open-btns .btn:not([data-no-pity])').forEach(b => b.classList.toggle('pity-hot', hot));
}

function toggleWishlist(cardId) {
  if (!cardId) return;
  if (wishlist.has(cardId)) {
    wishlist.delete(cardId);
    showToast({icon:'☆', name:'Removed from wishlist', rarity:'C'});
  } else {
    wishlist.add(cardId);
    showToast({icon:'⭐', name:'Added to wishlist!', rarity:'R'});
  }
  renderGallery();
  renderDeckPool();
}

function quickAddFromReveal(cardId) {
  const card = getAllCardById(cardId);
  if (!card) return;
  const overlay = document.getElementById('deck-overlay');
  if (!overlay.classList.contains('active')) openDeckBuilder();
  addToDeck(card);
}

function openStats() {
  renderStats();
  document.getElementById('stats-overlay').classList.add('active');
}
function closeStats() {
  document.getElementById('stats-overlay').classList.remove('active');
}
function renderStats() {
  const el = document.getElementById('stats-content');
  if (!el) return;
  const totalCards = sessionStats.totalPulled;
  const price = sessionStats.packPrice || 350;
  const packs = Math.round(totalPacks);
  const spent = packs * price;
  const byR = sessionStats.byRarity;
  const rarityOrder = ["SP","RRR","RR","R","C","LR","GR","SCR","SGR"];
  const rarityColors = {SP:'var(--rarity-sp)',RRR:'var(--rarity-rrr)',RR:'var(--rarity-rr)',R:'var(--rarity-r)',C:'var(--rarity-c)',LR:'var(--rarity-lr)',GR:'#9b4dca',SCR:'var(--rarity-scr)',SGR:'var(--rarity-sgr)'};

  // Per-set pack counts from history
  const setPackCounts = {};
  const setRRRCounts = {};
  for (const entry of history) {
    const setId = entry.set;
    if (!setId) continue;
    setPackCounts[setId] = (setPackCounts[setId]||0) + 1;
    const rrrInPack = entry.cards.filter(c=>['RRR','SP','LR','GR','SCR','SGR'].includes(c.rarity)).length;
    setRRRCounts[setId] = (setRRRCounts[setId]||0) + rrrInPack;
  }

  // Completion for all booster sets
  const boosterSets = SETS.filter(s => !s.id.startsWith('TD'));
  const setRows = boosterSets.map(s => {
    const cards = s.cards.filter(c=>c.rarity!=='TD'&&c.rarity!=='SP');
    const uniqueNames = [...new Set(cards.map(c=>c.name))];
    const ownedNames = uniqueNames.filter(name => cards.some(c=>c.name===name && collection[c.id]?.count>0));
    const pct = uniqueNames.length ? Math.round((ownedNames.length/uniqueNames.length)*100) : 0;
    const barColor = pct===100?'var(--green)':pct>=50?'var(--gold)':'var(--accent)';
    const packsThisSet = setPackCounts[s.label] || 0;
    const rrrThisSet = setRRRCounts[s.label] || 0;
    const rrrRate = packsThisSet > 0 ? (rrrThisSet / packsThisSet * 100).toFixed(1) : null;
    return `<div style="margin-bottom:8px;background:var(--surface2);border-radius:6px;padding:7px 10px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
        <span style="font-size:11px;font-weight:600;color:var(--text)">${s.label} <span style="font-weight:400;color:var(--text-muted)">– ${s.name}</span></span>
        <span style="font-size:10px;color:${barColor};font-weight:700">${ownedNames.length}/${uniqueNames.length} (${pct}%)</span>
      </div>
      <div style="height:4px;background:rgba(255,255,255,0.07);border-radius:2px;margin-bottom:5px">
        <div style="height:4px;width:${pct}%;background:${barColor};border-radius:2px;transition:width 0.4s"></div>
      </div>
      ${packsThisSet > 0 ? `<div style="display:flex;gap:10px;font-size:10px;color:var(--text-muted)">
        <span>📦 <b style="color:var(--text)">${packsThisSet}</b> packs opened</span>
        <span>🌟 <b style="color:var(--rarity-rrr)">${rrrThisSet}</b> rares (${rrrRate}%/pack)</span>
      </div>` : ''}
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
      <div style="background:var(--surface2);border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:var(--accent)">${packs}</div>
        <div style="font-size:10px;color:var(--text-muted)">Packs Opened</div>
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:var(--gold)">¥${spent.toLocaleString()}</div>
        <div style="font-size:10px;color:var(--text-muted)">Estimated Spent</div>
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:var(--rarity-rrr)">${byR['RRR']||0}</div>
        <div style="font-size:10px;color:var(--text-muted)">RRR Pulled</div>
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:var(--rarity-sp)">${byR['SP']||0}</div>
        <div style="font-size:10px;color:var(--text-muted)">SP Pulled</div>
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:22px;font-weight:700;color:var(--green)">${sessionStats.wishlistHits}</div>
        <div style="font-size:10px;color:var(--text-muted)">Wishlist Hits</div>
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:18px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${sessionStats.bestPull?.name||'—'}">${sessionStats.bestPull?.icon||'—'} ${sessionStats.bestPull?.name||'—'}</div>
        <div style="font-size:10px;color:var(--text-muted)">Best Pull</div>
      </div>
    </div>

    <div style="margin-bottom:14px">
      <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">Pull Rate Breakdown</div>
      ${rarityOrder.filter(r=>byR[r]).map(r=>{
        const pct2 = totalCards ? ((byR[r]/totalCards)*100).toFixed(1) : 0;
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span class="rarity-badge ${r}" style="font-size:9px;width:28px;text-align:center">${r}</span>
          <div style="flex:1;height:6px;background:var(--surface2);border-radius:3px">
            <div style="height:6px;width:${pct2}%;background:${rarityColors[r]||'var(--accent)'};border-radius:3px"></div>
          </div>
          <span style="font-size:10px;color:var(--text-muted);width:60px;text-align:right">${byR[r]} (${pct2}%)</span>
        </div>`;
      }).join('')}
    </div>

    <div>
      <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">Per-Set Pull Stats & Completion</div>
      ${setRows || '<div style="font-size:12px;color:var(--text-muted)">Open some packs to see per-set stats!</div>'}
    </div>
  `;
}

document.addEventListener('keydown', e => {
  if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
  const key = e.key;
  const anyOverlay = document.querySelector('.zoom-overlay.active, .gallery-overlay.active, .deck-overlay.active, .export-overlay.active');
  if (key === 'Escape') {
    if (document.getElementById('stats-overlay')?.classList.contains('active')) { closeStats(); return; }
    if (document.getElementById('import-overlay')?.classList.contains('active')) { closeImportDeck(); return; }
    if (document.getElementById('zoom-overlay')?.classList.contains('active')) { document.getElementById('zoom-overlay').classList.remove('active'); return; }
    if (document.getElementById('gallery-overlay')?.classList.contains('active')) { closeGallery(); return; }
    if (document.getElementById('deck-overlay')?.classList.contains('active')) { closeDeckBuilder(); return; }
    if (document.getElementById('export-overlay')?.classList.contains('active')) { closeExport(); return; }
  }
  if (anyOverlay) return;
  if (key === ' ' || key === 'Enter') { e.preventDefault(); stagePack(1); }
  if (key === 'r' || key === 'R') { const btn = document.getElementById('reveal-btn'); if (btn && btn.style.display !== 'none') revealCards(); }
  if (key === 'a' || key === 'A') { const btn = document.getElementById('flip-all-btn'); if (btn && btn.style.display !== 'none') flipAll(); }
});

const _origBuildSaveData = buildSaveData;
buildSaveData = function() {
  const data = _origBuildSaveData();
  data.wishlist = [...wishlist];
  data.packsSinceLastRRR = packsSinceLastRRR;
  data.packsSinceLastLR = packsSinceLastLR;
  data.totalPacksOpened = totalPacksOpened;
  data.sessionStats = sessionStats;
  return data;
};
const _origApplySaveData = applySaveData;
applySaveData = function(data) {
  _origApplySaveData(data);
  wishlist = new Set(data.wishlist || []);
  packsSinceLastRRR = data.packsSinceLastRRR || 0;
  packsSinceLastLR = data.packsSinceLastLR || 0;
  totalPacksOpened = data.totalPacksOpened || 0;
  if (data.sessionStats) sessionStats = {...sessionStats, ...data.sessionStats};
  updatePityDisplay();
};


function renderMissing() {
  const setFilter = document.getElementById('missing-set-filter')?.value || 'ALL';
  const container = document.getElementById('missing-list-container');
  if (!container) return;

  const sel = document.getElementById('missing-set-filter');
  if (sel && sel.options.length <= 1) {
    const boosterSets = SETS.filter(s => !s.id.startsWith('TD'));
    boosterSets.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id; opt.textContent = `${s.label} – ${s.name}`;
      sel.appendChild(opt);
    });
  }

  const setsToCheck = setFilter === 'ALL'
    ? SETS.filter(s => !s.id.startsWith('TD'))
    : SETS.filter(s => s.id === setFilter);

  const rarityOrder = ['SGR','SCR','GR','OR','LR','SP','RRR','RR','R','C'];
  let missing = [];
  for (const set of setsToCheck) {
    for (const card of set.cards) {
      if (card.rarity === 'TD') continue;
      if (card.rarity === 'SP') continue;
      if (!collection[card.id] || collection[card.id].count === 0) {
        missing.push(card);
      }
    }
  }

  if (!missing.length) {
    container.innerHTML = '<div class="empty-state"><div class="icon">✅</div><p>You own every card in this set!</p></div>';
    return;
  }

  missing.sort((a,b) => {
    const si = rarityOrder.indexOf(a.rarity), sj = rarityOrder.indexOf(b.rarity);
    if (si !== sj) return si - sj;
    return a.id.localeCompare(b.id);
  });

  let html = `<div style="font-size:10px;color:var(--text-muted);padding:2px 0 8px">${missing.length} card${missing.length!==1?'s':''} missing</div>`;
  let lastSet = null;
  for (const card of missing) {
    const setId = card.id.split('_')[0];
    if (setId !== lastSet) {
      html += `<div class="section-title" style="margin-top:6px">${setId}</div>`;
      lastSet = setId;
    }
    html += `<div class="missing-card-row" onclick="openZoom(getAllCardById('${card.id}'))">
      <span class="rarity-badge ${card.rarity} missing-rarity">${card.rarity}</span>
      <span style="margin-right:4px">${card.icon}</span>
      <span style="flex:1">${card.name}</span>
      <span style="font-size:9px;color:var(--text-muted)">G${card.grade}</span>
    </div>`;
  }
  container.innerHTML = html;
}

function copyMissingList() {
  const setFilter = document.getElementById('missing-set-filter')?.value || 'ALL';
  const setsToCheck = setFilter === 'ALL'
    ? SETS.filter(s => !s.id.startsWith('TD'))
    : SETS.filter(s => s.id === setFilter);
  const lines = ['=== Missing Cards ==='];
  for (const set of setsToCheck) {
    const missing = set.cards.filter(c => c.rarity !== 'TD' && c.rarity !== 'SP' && (!collection[c.id] || collection[c.id].count === 0));
    if (!missing.length) continue;
    lines.push(`\n${set.label} – ${set.name}`);
    for (const c of missing) lines.push(`  ${c.rarity.padEnd(3)} ${c.name} (${c.id})`);
  }
  navigator.clipboard.writeText(lines.join('\n'));
  showToast({icon:'📋', name:'Missing list copied!', rarity:'R'});
}

let soundEnabled = true;
function toggleSound(el) {
  soundEnabled = el.checked;
  const lbl = el.closest('.toggle-wrap')?.querySelector('.toggle-label');
  if (lbl) lbl.textContent = soundEnabled ? '🔊 Sound' : '🔇 Sound';
}

const SFX = (() => {
  let ctx = null;
  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }
  function tone(freq, type, duration, vol, startTime) {
    if (!soundEnabled) return;
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain); gain.connect(c.destination);
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.start(startTime); osc.stop(startTime + duration);
  }
  return {
    cardFlip() {
      if (!soundEnabled) return;
      try {
        const c = getCtx(), t = c.currentTime;
        tone(800, 'sine', 0.04, 0.08, t);
        tone(1200, 'sine', 0.03, 0.05, t + 0.02);
      } catch(e) {}
    },
    packRip() {
      if (!soundEnabled) return;
      try {
        const c = getCtx(), t = c.currentTime;
        const buf = c.createBuffer(1, c.sampleRate * 0.15, c.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i/data.length);
        const src = c.createBufferSource();
        const gain = c.createGain();
        src.buffer = buf; src.connect(gain); gain.connect(c.destination);
        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        src.start(t);
      } catch(e) {}
    },
    rrrHit() {
      if (!soundEnabled) return;
      try {
        const c = getCtx(), t = c.currentTime;
        [523, 659, 784, 1047].forEach((f, i) => tone(f, 'sine', 0.25, 0.12, t + i * 0.07));
      } catch(e) {}
    },
    spHit() {
      if (!soundEnabled) return;
      try {
        const c = getCtx(), t = c.currentTime;
        [659, 831, 988, 1319].forEach((f, i) => tone(f, 'triangle', 0.3, 0.14, t + i * 0.06));
        tone(1760, 'sine', 0.4, 0.1, t + 0.28);
      } catch(e) {}
    },
  };
})();

function playPackRip(icon, setLabel, boxSrc, callback) {
  const overlay = document.getElementById('pack-rip-overlay');
  const top     = document.getElementById('pack-rip-top');
  const bot     = document.getElementById('pack-rip-bot');
  const flash   = document.getElementById('rip-flash');
  if (!overlay) { callback(); return; }

  const H = 232;
  const cy = window.innerHeight / 2;

  function setupRipImg(imgId, fbId, iconId) {
    const img = document.getElementById(imgId);
    const fb  = document.getElementById(fbId);
    const ic  = document.getElementById(iconId);
    img.style.display = 'block';
    fb.style.display  = 'none';
    const exts = ['webp'];
    (function tryExt(i) {
      if (i >= exts.length) {
        img.style.display = 'none'; fb.style.display = 'flex';
        if (ic) ic.innerHTML = `<div style="text-align:center;padding:8px"><div style="font-size:36px">${icon}</div><div style="font-size:12px;margin-top:4px;opacity:0.8">${setLabel}</div></div>`;
        return;
      }
      img.onerror = () => tryExt(i + 1);
      img.onload  = () => { fb.style.display = 'none'; };
      img.src = `${boxSrc}.${exts[i]}`;
    })(0);
  }
  setupRipImg('rip-img-top','rip-fallback-top','rip-icon-top');
  setupRipImg('rip-img-bot','rip-fallback-bot','rip-icon-bot');

  top.style.top = (cy - H) + 'px';
  bot.style.top = cy + 'px';

  top.style.transition = 'none';
  bot.style.transition = 'none';
  top.style.transform = 'translateX(-50%) translateY(0)';
  bot.style.transform = 'translateX(-50%) translateY(0)';

  overlay.style.display = 'block';
  overlay.style.pointerEvents = 'auto';

  SFX.packRip();

  requestAnimationFrame(() => requestAnimationFrame(() => {
    top.style.transition = 'transform 0.42s cubic-bezier(0.4,0,0.2,1)';
    bot.style.transition = 'transform 0.42s cubic-bezier(0.4,0,0.2,1)';
    top.style.transform = 'translateX(-50%) translateY(-55%)';
    bot.style.transform = 'translateX(-50%) translateY(55%)';

    setTimeout(() => {
        flash.style.opacity = '1';
        setTimeout(() => {
          flash.style.opacity = '0';
          overlay.style.display = 'none';
          overlay.style.pointerEvents = 'none';
          callback();
        }, 150);
    }, 420);
  }));
}

// ==================== GET WHOLE SET ====================
function getWholeSet() {
  const set = SETS[currentSetIdx];
  if (!set) return;
  if (set.packSize === 50) { showToast({icon:'⚠️',name:'Cannot get whole TD set this way',rarity:'C'}); return; }
  let added = 0;
  for (const card of set.cards) {
    const current = collection[card.id]?.count || 0;
    const toAdd = 4 - current;
    if (toAdd > 0) {
      if (!collection[card.id]) collection[card.id] = { card, count: 0 };
      collection[card.id].count += toAdd;
      added += toAdd;
    }
  }
  collectionDirty = true;
  SET_COMPLETION_CACHE.clear();
  updateStats();
  renderSetButtons();
  showToast({icon:'📦',name:`Added ${added} cards from ${set.label}`,rarity:'RR'});
}

// ==================== HAND SAMPLE ====================
let handDeck = [];
let handCards = [];
let handMulliganed = false;
let handTurnDrawn = false;

function buildHandDeck() {
  const cards = [];
  if (fvCard) cards.push(fvCard);
  for (const { card, count } of Object.values(deck)) {
    if (isGUnit(card)) continue;
    for (let i = 0; i < count; i++) cards.push(card);
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function openHandSample() {
  const total = getDeckTotal();
  if (total < 5) { showToast({icon:'⚠️',name:'Need at least 5 cards in deck',rarity:'C'}); return; }
  handDeck = buildHandDeck();
  handCards = [];
  handMulliganed = false;
  handTurnDrawn = false;
  const info = document.getElementById('hand-deck-info');
  if (info) info.textContent = `${document.getElementById('deck-name-input')?.value||'My Deck'} — ${total} cards (excl. G Zone)`;
  document.getElementById('mulligan-section').style.display = 'none';
  document.getElementById('turn-section').style.display = 'none';
  document.getElementById('hand-status').textContent = 'Draw your opening hand to begin.';
  document.getElementById('hand-cards').innerHTML = '';
  document.getElementById('hand-phase-btns').innerHTML =
    '<button class="btn btn-primary" style="font-size:12px;padding:7px 14px" onclick="drawOpeningHand()">🔀 Draw Opening Hand</button>';
  document.getElementById('hand-overlay').classList.add('active');
}

function closeHandSample() {
  document.getElementById('hand-overlay').classList.remove('active');
}

function drawOpeningHand() {
  handDeck = buildHandDeck();
  handCards = handDeck.splice(0, 5);
  handMulliganed = false;
  handTurnDrawn = false;
  renderHandCards(handCards, []);
  document.getElementById('hand-status').textContent = 'Opening hand drawn. Select cards to mulligan, or keep.';
  document.getElementById('mulligan-section').style.display = 'flex';
  document.getElementById('turn-section').style.display = 'none';
  document.getElementById('hand-phase-btns').innerHTML =
    '<button class="btn btn-secondary" style="font-size:12px;padding:7px 14px" onclick="drawOpeningHand()">🔀 Redraw Fresh</button>';
}

function renderHandCards(cards, newIdxs) {
  const grid = document.getElementById('hand-cards');
  if (!grid) return;
  grid.innerHTML = cards.map((card, i) => {
    const isNew = newIdxs.includes(i);
    return `<div class="hand-card ${isNew?'new-card':''}" id="hand-card-${i}" onclick="toggleMulliganCard(${i})">
      <img data-id="${card.id}" alt="${card.name}" src="${cardImgPath(card.id)}" loading="lazy"
           onerror="(function(el){if(!el._cands){el._cands=cardImgCandidates(el.dataset.id);el._ci=1;}if(el._ci<el._cands.length){el.src=el._cands[el._ci++];}else{el.style.display='none';}})(this)">
      <div class="hand-card-label">G${card.grade} · ${card.name}</div>
    </div>`;
  }).join('');
}

function toggleMulliganCard(idx) {
  if (handMulliganed) return;
  document.getElementById('hand-card-' + idx)?.classList.toggle('selected');
}

function doMulligan() {
  if (handMulliganed) return;
  const selected = [], kept = [];
  handCards.forEach((card, i) => {
    (document.getElementById('hand-card-' + i)?.classList.contains('selected') ? selected : kept).push(card);
  });
  if (!selected.length) { keepHand(); return; }
  handDeck.push(...selected);
  const newCards = handDeck.splice(0, selected.length);
  handCards = [...kept, ...newCards];
  const newIdxs = handCards.map((_, i) => i >= kept.length ? i : -1).filter(i => i >= 0);
  handMulliganed = true;
  renderHandCards(handCards, newIdxs);
  document.getElementById('hand-status').textContent =
    'Mulligan: put ' + selected.length + ' card' + (selected.length > 1 ? 's' : '') + ' to bottom, drew ' + newCards.length + ' new.';
  document.getElementById('mulligan-section').style.display = 'none';
  document.getElementById('turn-section').style.display = 'flex';
}

function keepHand() {
  handMulliganed = true;
  renderHandCards(handCards, []);
  document.getElementById('mulligan-section').style.display = 'none';
  document.getElementById('turn-section').style.display = 'flex';
  document.getElementById('hand-status').textContent = 'Hand kept!';
}

function drawForTurn() {
  if (handTurnDrawn || !handDeck.length) return;
  const drawn = handDeck.splice(0, 1);
  handCards = [...handCards, ...drawn];
  handTurnDrawn = true;
  renderHandCards(handCards, [handCards.length - 1]);
  document.getElementById('hand-status').textContent =
    handCards.length + ' cards in hand · ' + handDeck.length + ' remaining in deck.';
  document.getElementById('turn-section').style.display = 'none';
}


// ==================== REAL FOIL CARD EFFECT ====================
// Tracks mouse over RRR/SP/GR/LR cards and shifts the holo pattern
// like physical foil cards do under light
(function initFoilEffect() {
  function getFoilEl(target) {
    // Walk up to find card-front or gallery-card with a foil rarity
    let el = target;
    for (let i = 0; i < 6; i++) {
      if (!el) return null;
      for (const r of FOIL_RARITIES) {
        if (el.classList?.contains('card-front') && el.classList?.contains(r)) return el;
        if (el.classList?.contains(`rarity-card-${r}`) &&
            (el.classList.contains('gallery-card') || el.classList.contains('pool-card') || el.classList.contains('card-front'))) return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function applyFoil(card, mx, my) {
    const rect = card.getBoundingClientRect();
    const x = (mx - rect.left) / rect.width;   // 0..1
    const y = (my - rect.top) / rect.height;    // 0..1
    const cx = (x - 0.5) * 2;   // -1..1
    const cy = (y - 0.5) * 2;

    // Tilt (subtle perspective)
    const tiltX = cy * 8;
    const tiltY = cx * -8;

    // Holo position (maps mouse to gradient offset)
    const hx = Math.round(x * 100);
    const hy = Math.round(y * 100);

    // Shine intensity based on distance from centre
    const dist = Math.sqrt(cx*cx + cy*cy);
    const shine = Math.max(0, 1 - dist * 0.6);

    card.style.setProperty('--foil-x', `${hx}%`);
    card.style.setProperty('--foil-y', `${hy}%`);
    card.style.setProperty('--foil-shine', shine);
    card.style.setProperty('--foil-tilt-x', `${tiltX}deg`);
    card.style.setProperty('--foil-tilt-y', `${tiltY}deg`);
    card.classList.add('foil-active');
  }

  function resetFoil(card) {
    card.style.removeProperty('--foil-x');
    card.style.removeProperty('--foil-y');
    card.style.removeProperty('--foil-shine');
    card.style.removeProperty('--foil-tilt-x');
    card.style.removeProperty('--foil-tilt-y');
    card.classList.remove('foil-active');
  }

  let _lastFoil = null;
  document.addEventListener('mousemove', e => {
    const card = getFoilEl(e.target);
    if (card) {
      if (_lastFoil && _lastFoil !== card) resetFoil(_lastFoil);
      applyFoil(card, e.clientX, e.clientY);
      _lastFoil = card;
    } else if (_lastFoil) {
      resetFoil(_lastFoil);
      _lastFoil = null;
    }
  }, { passive: true });

  document.addEventListener('mouseleave', () => {
    if (_lastFoil) { resetFoil(_lastFoil); _lastFoil = null; }
  }, { passive: true });
})();
init();
