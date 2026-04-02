
// ==================== STATE ====================
let currentSetIdx = -1;    // -1 = no set selected / panel closed
let currentFormat = 'OG';  // 'OG' | 'G'
let packPanelOpen = false;  // whether the pack area is showing
let collection = {}; // cardId -> { card, count }
let history = [];
let totalPacks = 0;
let packsSinceLastRRR = 0;   // pity tracker
let wishlist = new Set();    // card IDs on wishlist
let sessionStats = {         // lifetime stats
  totalPulled: 0,
  byRarity: {},
  bestPull: null,            // rarest card ever pulled
  packPrice: 350,            // configurable (yen)
  wishlistHits: 0,
};

// ==================== SETUP ====================
// ==================== SESSION SAVE / LOAD (JSON file) ====================
// localStorage doesn't work reliably with file:// protocol.
// Instead we save to a .json file (download) and load by picking that file.

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
  const _isG = c => { const s = SETS.find(x=>x.id===c.id.split('_')[0]); return !!(s && s.format==='G'); };
  const allCards = getAllSetCards().filter(c => galleryFormat === 'G' ? _isG(c) : !_isG(c));
  const cardMap = {};
  for (const c of allCards) cardMap[c.id] = c;

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
    a.download = `vanguard-save-${new Date().toISOString().slice(0,10)}.json`;
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
      // Ensure TDs always present after load
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

// ==================== TD AUTO-COLLECTION ====================
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
  _buildCardMap(); // build O(1) lookup map once
  // Pre-load trial deck cards into collection
  addTDsToCollection();

  // Start with everything closed — user clicks a set to open
  document.getElementById('pack-area').style.display = 'none';
  document.getElementById('td-decklist-panel').style.display = 'none';
  // Pack sim panel itself also starts collapsed
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

// TD deck counts (official): cardId -> count in the 50-card deck
const TD_COUNTS = {
  // GTD01
  'GTD01_001':2,'GTD01_002':2,'GTD01_003':4,'GTD01_004':2,'GTD01_005':4,
  'GTD01_006':2,'GTD01_007':2,'GTD01_008':2,'GTD01_009':4,'GTD01_010':4,
  'GTD01_011':3,'GTD01_012':2,'GTD01_013':2,'GTD01_014':1,'GTD01_015':4,
  'GTD01_016':2,'GTD01_017':4,'GTD01_018':4,'GTD01_019':2,
  // GTD02
  'GTD02_001':2,'GTD02_002':2,'GTD02_003':2,'GTD02_004':4,'GTD02_005':4,
  'GTD02_006':2,'GTD02_007':2,'GTD02_008':2,'GTD02_009':4,'GTD02_010':4,
  'GTD02_011':3,'GTD02_012':2,'GTD02_013':2,'GTD02_014':1,'GTD02_015':4,
  'GTD02_016':2,'GTD02_017':4,'GTD02_018':4,'GTD02_019':2,
  // GTD03
  'GTD03_001':2,'GTD03_002':2,'GTD03_003':4,'GTD03_004':2,'GTD03_005':4,
  'GTD03_006':2,'GTD03_007':2,'GTD03_008':2,'GTD03_009':4,'GTD03_010':4,
  'GTD03_011':2,'GTD03_012':2,'GTD03_013':3,'GTD03_014':1,'GTD03_015':4,
  'GTD03_016':4,'GTD03_017':2,'GTD03_018':4,'GTD03_019':2,
  'TD01_001':4,
  'TD01_002':1,
  'TD01_003':2,
  'TD01_004':4,
  'TD01_005':1,
  'TD01_006':3,
  'TD01_007':4,
  'TD01_008':4,
  'TD01_009':2,
  'TD01_010':4,
  'TD01_011':4,
  'TD01_012':1,
  'TD01_013':4,
  'TD01_014':4,
  'TD01_015':4,
  'TD01_016':4,
  'TD02_001':2,
  'TD02_002':1,
  'TD02_003':4,
  'TD02_004':4,
  'TD02_005':4,
  'TD02_006':4,
  'TD02_007':4,
  'TD02_008':2,
  'TD02_009':4,
  'TD02_010':2,
  'TD02_011':2,
  'TD02_012':1,
  'TD02_013':4,
  'TD02_014':4,
  'TD02_015':4,
  'TD02_016':4,
  'TD03_001':1,
  'TD03_002':2,
  'TD03_003':4,
  'TD03_004':4,
  'TD03_005':2,
  'TD03_006':4,
  'TD03_007':4,
  'TD03_008':4,
  'TD03_009':4,
  'TD03_010':3,
  'TD03_011':2,
  'TD03_012':4,
  'TD03_013':4,
  'TD03_014':4,
  'TD03_015':4,
  'TD04_001':4,
  'TD04_002':1,
  'TD04_003':2,
  'TD04_004':4,
  'TD04_005':4,
  'TD04_006':2,
  'TD04_007':4,
  'TD04_008':4,
  'TD04_009':4,
  'TD04_010':2,
  'TD04_011':3,
  'TD04_012':4,
  'TD04_013':4,
  'TD04_014':4,
  'TD04_015':4,
  // new sets
  'TD05_001':1,
  'TD05_002':2,
  'TD05_003':4,
  'TD05_004':4,
  'TD05_005':1,
  'TD05_006':4,
  'TD05_007':2,
  'TD05_008':4,
  'TD05_009':4,
  'TD05_010':2,
  'TD05_011':2,
  'TD05_012':2,
  'TD05_013':1,
  'TD05_014':1,
  'TD05_015':4,
  'TD05_016':4,
  'TD05_017':4,
  'TD05_018':4,
  'TD06_001':1,
  'TD06_002':2,
  'TD06_003':4,
  'TD06_004':4,
  'TD06_005':4,
  'TD06_006':1,
  'TD06_007':2,
  'TD06_008':4,
  'TD06_009':4,
  'TD06_010':2,
  'TD06_011':1,
  'TD06_012':2,
  'TD06_013':2,
  'TD06_014':1,
  'TD06_015':4,
  'TD06_016':4,
  'TD06_017':4,
  'TD06_018':4,
  'TD07_001':1,
  'TD07_002':2,
  'TD07_003':4,
  'TD07_004':4,
  'TD07_005':1,
  'TD07_006':2,
  'TD07_007':4,
  'TD07_008':4,
  'TD07_009':4,
  'TD07_010':2,
  'TD07_011':1,
  'TD07_012':2,
  'TD07_013':2,
  'TD07_014':1,
  'TD07_015':4,
  'TD07_016':4,
  'TD07_017':4,
  'TD07_018':4,
  'TD08_001':1,
  'TD08_002':2,
  'TD08_003':4,
  'TD08_004':4,
  'TD08_005':1,
  'TD08_006':1,
  'TD08_007':2,
  'TD08_008':4,
  'TD08_009':4,
  'TD08_010':4,
  'TD08_011':4,
  'TD08_012':2,
  'TD08_013':1,
  'TD08_014':4,
  'TD08_015':4,
  'TD08_016':4,
  'TD08_017':4,
  'TD09_001':1,
  'TD09_002':4,
  'TD09_003':2,
  'TD09_004':4,
  'TD09_005':1,
  'TD09_006':1,
  'TD09_007':2,
  'TD09_008':4,
  'TD09_009':4,
  'TD09_010':4,
  'TD09_011':4,
  'TD09_012':2,
  'TD09_013':1,
  'TD09_014':4,
  'TD09_015':4,
  'TD09_016':4,
  'TD09_017':4,
  'TD10_001':1,
  'TD10_002':2,
  'TD10_003':4,
  'TD10_004':4,
  'TD10_005':1,
  'TD10_006':1,
  'TD10_007':4,
  'TD10_008':2,
  'TD10_009':4,
  'TD10_010':4,
  'TD10_011':4,
  'TD10_012':2,
  'TD10_013':1,
  'TD10_014':4,
  'TD10_015':4,
  'TD10_016':4,
  'TD10_017':4,
  'TD11_001':1,
  'TD11_002':4,
  'TD11_003':2,
  'TD11_004':4,
  'TD11_005':1,
  'TD11_006':1,
  'TD11_007':4,
  'TD11_008':2,
  'TD11_009':4,
  'TD11_010':4,
  'TD11_011':4,
  'TD11_012':2,
  'TD11_013':1,
  'TD11_014':4,
  'TD11_015':4,
  'TD11_016':4,
  'TD11_017':4,
  'TD12_001':1,
  'TD12_002':2,
  'TD12_003':4,
  'TD12_004':4,
  'TD12_005':1,
  'TD12_006':1,
  'TD12_007':4,
  'TD12_008':2,
  'TD12_009':4,
  'TD12_010':4,
  'TD12_011':2,
  'TD12_012':4,
  'TD12_013':1,
  'TD12_014':4,
  'TD12_015':4,
  'TD12_016':4,
  'TD12_017':4,
  'TD13_001':1,
  'TD13_002':2,
  'TD13_003':4,
  'TD13_004':4,
  'TD13_005':2,
  'TD13_006':1,
  'TD13_007':4,
  'TD13_008':4,
  'TD13_009':2,
  'TD13_010':1,
  'TD13_011':4,
  'TD13_012':4,
  'TD13_013':1,
  'TD13_014':4,
  'TD13_015':4,
  'TD13_016':4,
  'TD13_017':4,
  'TD14_001':1,
  'TD14_002':2,
  'TD14_003':4,
  'TD14_004':4,
  'TD14_005':1,
  'TD14_006':1,
  'TD14_007':4,
  'TD14_008':2,
  'TD14_009':4,
  'TD14_010':4,
  'TD14_011':4,
  'TD14_012':2,
  'TD14_013':1,
  'TD14_014':4,
  'TD14_015':4,
  'TD14_016':4,
  'TD14_017':4,
  'TD16_001':1,
  'TD16_002':4,
  'TD16_003':2,
  'TD16_004':4,
  'TD16_005':1,
  'TD16_006':1,
  'TD16_007':4,
  'TD16_008':2,
  'TD16_009':4,
  'TD16_010':4,
  'TD16_011':4,
  'TD16_012':2,
  'TD16_013':1,
  'TD16_014':4,
  'TD16_015':4,
  'TD16_016':4,
  'TD16_017':4,
  'TD17_001':1,
  'TD17_002':4,
  'TD17_003':2,
  'TD17_004':4,
  'TD17_005':1,
  'TD17_006':1,
  'TD17_007':2,
  'TD17_008':4,
  'TD17_009':4,
  'TD17_010':4,
  'TD17_011':4,
  'TD17_012':2,
  'TD17_013':1,
  'TD17_014':4,
  'TD17_015':4,
  'TD17_016':4,
  'TD17_017':4,
};
let setGroupCollapsed = {};
function toggleSetGroup(key) {
  const opening = setGroupCollapsed[key]; // true = was collapsed, now opening
  for (const k of ['td','bt','eb','gbt','geb']) setGroupCollapsed[k] = true;
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
  document.getElementById('fmt-og').classList.toggle('active', fmt==='OG');
  document.getElementById('fmt-g').classList.toggle('active', fmt==='G');
  // Close pack panel when switching formats
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
  const isGFormat = s => s.format === 'G';
  const inFmt = s => currentFormat === 'G' ? isGFormat(s) : !isGFormat(s);
  const btSets  = SETS.map((s,i)=>({s,i})).filter(({s})=>/^BT/.test(s.id)&&inFmt(s)).sort(numSort);
  const ebSets  = SETS.map((s,i)=>({s,i})).filter(({s})=>/^EB/.test(s.id)&&inFmt(s)).sort(numSort);
  const gbtSets = SETS.map((s,i)=>({s,i})).filter(({s})=>s.id.startsWith('GBT')&&inFmt(s)).sort(numSort);
  const gebSets = SETS.map((s,i)=>({s,i})).filter(({s})=>s.id.startsWith('GEB')&&inFmt(s)).sort(numSort);
  const tdSets  = SETS.filter(s=>s.packSize===50&&inFmt(s)).sort((a,b)=>parseInt(a.id.replace(/\D/g,''))-parseInt(b.id.replace(/\D/g,'')));
  // Ensure all groups start collapsed by default
  if (setGroupCollapsed['td'] === undefined) setGroupCollapsed['td'] = true;
  if (setGroupCollapsed['bt'] === undefined) setGroupCollapsed['bt'] = true;
  if (setGroupCollapsed['eb']  === undefined) setGroupCollapsed['eb']  = true;
  if (setGroupCollapsed['gbt'] === undefined) setGroupCollapsed['gbt'] = true;
  if (setGroupCollapsed['geb'] === undefined) setGroupCollapsed['geb'] = true;
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
    // label goes into the headers row; cards go into the body row below
    return {
      header: `<div class="set-group-label" onclick="toggleSetGroup('${key}')">${arrow} ${label}</div>`,
      body:   `<div class="set-group-cards ${collapsed?'collapsed':''}" id="set-group-cards-${key}">${btns}</div>`
    };
  }

  // TD section — same collapsible group style as BT/EB, but each "button" expands an inline decklist
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
    el.innerHTML = `
      <div class="set-group-headers">
        ${tdG.header}${gbtG.header}${gebG.header}
      </div>
      ${tdG.body}${gbtG.body}${gebG.body}
    `;
  } else {
    const btG  = groupHtml('bt','Booster Sets (BT)',btSets);
    const ebG  = groupHtml('eb','Extra Boosters (EB)',ebSets);
    el.innerHTML = `
      <div class="set-group-headers">
        ${tdG.header}${btG.header}${ebG.header}
      </div>
      ${tdG.body}${btG.body}${ebG.body}
    `;
  }
}

let selectedTD = null;

function selectTD(tdId) {
  // Toggle closed if clicking the already-active TD
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
  // Hide pack area, show decklist panel
  document.getElementById('pack-area').style.display = 'none';
  document.getElementById('reveal-section').classList.remove('active');
  const td = SETS.find(s => s.id === tdId);
  if (!td) return;
  // Build decklist HTML
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
  // Probe box art with multi-format fallback
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

  // Toggle closed if clicking the already-active set
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

  // Show pack area, hide decklist panel
  document.getElementById('pack-area').style.display = '';
  document.getElementById('td-decklist-panel').style.display = 'none';

  document.getElementById('pack-icon').textContent = set.icon;
  document.getElementById('pack-label').textContent = set.label;
  document.getElementById('set-title').textContent = set.name;
  document.getElementById('set-desc').textContent = set.desc;
  // Show LR tag only for sets that contain LR cards
  const lrTag = document.getElementById('lr-legend-tag');
  if (lrTag) lrTag.style.display = set.cards.some(c => c.rarity === 'LR') ? '' : 'none';
  document.getElementById('reveal-section').classList.remove('active');
  const boxImg = document.getElementById('box-img');
  const boxFallback = document.getElementById('box-fallback');
  // Start hidden; probe each extension with a fresh Image() to avoid cached 404s
  boxImg.style.display = 'none'; boxImg.src = '';
  boxFallback.style.display = 'flex';
  // Try both padded (box-BT016.webp) and unpadded (box-BT01.webp) — webp only
  const _m = set.id.match(/^([A-Z]+)(\d+)$/);
  const _padId = _m ? `${_m[1]}${_m[2].padStart(3,'0')}` : set.id;
  const _bNames = _padId !== set.id
    ? [`box-${_padId}.webp`, `box-${set.id}.webp`]
    : [`box-${set.id}.webp`];
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

// ==================== IMAGE PRELOADER ====================
// When a set is selected, quietly preload all its card images in the background.
// Uses a small concurrency limit so it doesn't compete with the UI or box art load.
let _preloadQueue = [];
let _preloadActive = 0;
const _PRELOAD_CONCURRENCY = 4;
let _preloadSetId = null; // track which set is currently preloading

function preloadSetImages(set) {
  if (!set || !set.cards) return;
  if (_preloadSetId === set.id) return; // already preloading this set
  _preloadSetId = set.id;

  // Cancel any previous queue
  _preloadQueue = [];
  _preloadActive = 0;

  // Build list of unique image URLs for this set
  const urls = [];
  for (const card of set.cards) {
    const candidates = cardImgCandidates(card.id);
    if (candidates.length) urls.push({ id: card.id, candidates, ci: 0 });
  }

  _preloadQueue = urls;
  // Start up to CONCURRENCY workers
  for (let i = 0; i < _PRELOAD_CONCURRENCY; i++) _preloadNext();
}

function _preloadNext() {
  if (!_preloadQueue.length) { _preloadActive = Math.max(0, _preloadActive - 1); return; }
  const item = _preloadQueue.shift();
  _preloadActive++;
  const img = new Image();
  img.onload = () => { _preloadActive--; _preloadNext(); };
  img.onerror = () => {
    // Try next candidate for this card
    if (item.ci < item.candidates.length - 1) {
      item.ci++;
      _preloadQueue.unshift(item); // retry with next candidate
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
    // fallback: step down through rarity order
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
  const isTwoSlot = sub === 'clan' || sub === 'technical' || sub === 'character'
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
  if (isEB && id.match(/EB1[012]/))       return generatePack5(set.cards, RPLUS_EB_LR);
  if (isEB)                               return generatePack5(set.cards, RPLUS_EB);
  if (isBT && id.match(/BT1[67]/))        return generatePack5(set.cards, RPLUS_BT_LR);
  return generatePack5(set.cards, RPLUS_BT);
}

// ==================== OPEN PACK ====================
let stagedCards = [];
let autoReveal = true;

function toggleAutoReveal(el) {
  autoReveal = el.checked;
}

function stageBox() {
  const set = SETS[currentSetIdx];
  if (!set) return;
  const sub = set.subtype || '';
  const isGBT11plus = set.id.startsWith('GBT') && parseInt(set.id.replace('GBT','')) >= 11;
  const isClanStyle = sub==='clan'||sub==='technical'||sub==='character';
  const isGEBOld    = set.id.startsWith('GEB') && (sub==='geb_old'||parseInt(set.id.replace('GEB',''))<=1);
  const boxPacks = isClanStyle ? 12
                 : isGBT11plus ? 16
                 : isGEBOld    ? 15
                 : set.id.startsWith('GEB') ? 12
                 : set.id.startsWith('EB')  ? 15 : 30;

  // 5-card sets: use fixed box rates instead of random per-pack
  const is5card = (set.packSize || 5) === 5;
  if (is5card) {
    const id = set.id;
    const isEB = id.startsWith('EB') || isGEBOld;
    const rplusPool = id.match(/BT1[67]/) || id.match(/EB1[012]/)
      ? (isEB ? RPLUS_EB_LR : RPLUS_BT_LR)
      : (isEB ? RPLUS_EB : RPLUS_BT);
    const allCards = generateBox5(set.cards, rplusPool, boxPacks, isEB);
    stagedCards = allCards;
    _presentStagedCards(boxPacks);
  } else {
    _doStagePack(boxPacks);
  }
}
function stagePack(count) {
  const set = SETS[currentSetIdx];
  if (!set) return;
  // Play rip animation only for single pack opens (multi-pack skips for speed)
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

  renderReveal(allCards, newCardIds, false); // render then flip
  updateStats();
  updateCollection();
  updateHistory();

  document.getElementById('reveal-title').textContent =
    packCount === 1 ? `Pack Results – ${set.label}` : `Results – ${packCount} Packs (${allCards.length} cards)`;
  document.getElementById('reveal-btn').style.display = 'none';
  document.getElementById('flip-all-btn').style.display = '';
  document.getElementById('flip-all-btn').textContent = 'Show All';
  flippedAll = false;

  // flip cards one by one with a stagger + flip sound
  // For large reveals (box = 150 cards) only play flip sound once per pack to avoid noise spam
  const isBox = allCards.length > packSize;
  const inners = document.querySelectorAll('.card-inner');
  inners.forEach((el, i) => setTimeout(() => {
    el.classList.add('flipped');
    if (!isBox || i % packSize === 0) SFX.cardFlip();
  }, i * 80));

  // toasts for hype pulls + wishlist hits
  const notable = allCards.filter(c => ["RRR","LR","SP"].includes(c.rarity));
  notable.slice(0, 3).forEach((c, i) => {
    setTimeout(() => showToast(c), 500 + i * 400);
    if (i === 0) setTimeout(() => (c.rarity === 'SP') ? SFX.spHit() : SFX.rrrHit(), 300 + i * 400);
  });

  // Session stats
  for (const c of allCards) {
    sessionStats.totalPulled++;
    sessionStats.byRarity[c.rarity] = (sessionStats.byRarity[c.rarity]||0) + 1;
    const rarityOrder = ["C","R","RR","RRR","SP","LR","SCR","GR","SGR","OR"];
    if (!sessionStats.bestPull || rarityOrder.indexOf(c.rarity) > rarityOrder.indexOf(sessionStats.bestPull.rarity))
      sessionStats.bestPull = c;
    if (wishlist.has(c.id)) {
      sessionStats.wishlistHits++;
      setTimeout(() => showToast({...c, _wishlistHit: true}), 800);
    }
  }

  // Pity tracker — evaluate per-pack so a hit in one pack doesn't
  // retroactively clear the dry-streak counter for the packs before it
  for (let pi = 0; pi < packCount; pi++) {
    const packCards = allCards.slice(pi * packSize, (pi + 1) * packSize);
    const hitRRR = packCards.some(c => ["RRR","LR","SP","OR","GR","SCR","SGR"].includes(c.rarity));
    if (hitRRR) { packsSinceLastRRR = 0; }
    else { packsSinceLastRRR++; }
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
  // Always re-add TD cards after clearing
  addTDsToCollection();
  updateCollection();
  updateHistory();
  updateStats();
  showToast({ icon: '🗑️', name: 'Collection cleared (TDs kept)', rarity: 'C' });
}

// ==================== RENDER CARDS ====================
// Card image path: id format is already "BT01_001" → images/cards/BT01/BT01_001EN.png
function cardImgPath(id, ext) {
  ext = ext || 'webp';
  const setId = id.split('_')[0];
  const isGSeries = /^G(BT|EB|TD)/.test(setId);
  const base = isGSeries ? IMG_CARDS_G : IMG_CARDS_OG;

  // GTD sets: GTD01_001 → 2 G/GTD01/GTD01_001EN.png
  if (setId.startsWith('GTD')) {
    return `${base}${setId}/${id}EN.${ext}`;
  }

  // GBT sets: GBT01_001 → GBT01_001EN.png | GBT01_S001 → GBT01_S01EN.png
  if (setId.startsWith('GBT')) {
    const fileId = id.replace(/_S0(\d+)$/, '_S$1');
    return `${base}${setId}/${fileId}EN.${ext}`;
  }

  // GEB sets: geb01_001.png | geb01_s01.png
  if (setId.startsWith('GEB')) {
    const fileId = id.replace(/_S0(\d+)$/, '_S$1').toLowerCase();
    return `${base}${setId}/${fileId}.${ext}`;
  }

  // EB10 Noir/Blanc
  if (setId === 'EB10') {
    const m = id.match(/^(EB10_(?:S0?\d+|\d+))([BW])$/);
    if (m) {
      const baseId = m[1].replace(/_S0(\d+)$/, '_S$1');
      return `${IMG_CARDS}${setId}/${baseId}EN-${m[2]}.${ext}`;
    }
  }

  // Legion Rare cards (EB11, EB12, BT16, BT17)
  {
    const lr = id.match(/^([A-Z0-9]+)_LR0*(\d+)$/);
    if (lr) return `${IMG_CARDS}${setId}/${lr[1]}_L${lr[2].padStart(2,'0')}EN.${ext}`;
  }

  // SP cards: strip one leading zero from SP number
  const fileId = id.replace(/_S0(\d+)$/, '_S$1');
  // TD and BT/EB: try with EN suffix first (handled by fallback chain in setImgSrcWithFallback)
  return `${base}${setId}/${fileId}EN.${ext}`;
}

// Returns all candidate paths to try for a card id (EN and non-EN variants)
function cardImgCandidates(id) {
  const setId = id.split('_')[0];
  const isGSeries = /^G(BT|EB|TD)/.test(setId);
  const base = isGSeries ? IMG_CARDS_G : IMG_CARDS_OG;
  const fileId = id.replace(/_S0(\d+)$/, '_S$1');
  const fileIdLower = fileId.toLowerCase();
  // webp only — try EN suffix, no suffix, lowercase no suffix
  return [
    `${base}${setId}/${fileId}EN.webp`,
    `${base}${setId}/${fileId}.webp`,
    `${base}${setId}/${fileIdLower}.webp`,
    `${base}${setId}/${fileIdLower}EN.webp`,
  ];
}

// Attach onerror fallback that tries all extension/EN variants
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
// Separate asset folder paths
const IMG_CARDS_OG = 'images/cards/1 OG/';  // OG series: BT, EB, TD
const IMG_CARDS_G  = 'images/cards/2 G/';   // G series: GBT, GEB, GTD
const IMG_CARDS    = IMG_CARDS_OG;           // legacy default (OG sets)
const IMG_ASSETS  = 'images/assets/';  // card-back.png, VGE-logo.png etc.
const IMG_BOXES   = 'images/boxes/';   // box-BT01.png etc.

function renderReveal(cards, newCardIds, faceDown) {
  const grid = document.getElementById('cards-grid');
  const set = SETS[currentSetIdx];
  const packSize = set ? (set.packSize || 5) : 5;
  grid.className = packSize === 7 ? 'cards-grid pack-7' : 'cards-grid';
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
              <span class="card-grade">G${card.grade} · ${card.clan}</span>
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

// ==================== STATS ====================
function updateStats() {
  // Exclude TD cards from header stats — only count pulled booster cards
  const allCards = Object.values(collection).filter(x => !x.card.id.startsWith('TD') && !x.card.id.startsWith('GTD'));
  const totalCards = allCards.reduce((s,x) => s+x.count, 0);
  const rrrPlus = allCards.filter(x => ["RRR","SP"].includes(x.card.rarity)).reduce((s,x)=>s+x.count,0);
  document.getElementById('total-cards-stat').textContent = totalCards;
  document.getElementById('rrr-count').textContent = rrrPlus;
}

// ==================== COLLECTION ====================
function renderCollection() { updateCollection(); }
function updateCollection() {
  const search = (document.getElementById('coll-search')?.value||'').toLowerCase();
  let allCards = Object.values(collection);

  // Exclude TDs from stats
  const boosterCards = allCards.filter(x => !x.card.id.startsWith('TD') && !x.card.id.startsWith('GTD'));
  const total = boosterCards.reduce((s,x) => s+x.count, 0);
  const unique = boosterCards.length;
  const dupes = boosterCards.filter(x => x.count > 1).reduce((s,x) => s+(x.count-1), 0);

  document.getElementById('coll-total').textContent = total;
  document.getElementById('coll-unique').textContent = unique;
  document.getElementById('coll-dupes').textContent = dupes;

  const rarityCounts = {};
  const rarityOrder = ["TD","C","R","RR","RRR","SP","LR","SCR","GR","SGR","OR"];
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

  // Exclude TD cards from the collection list
  allCards = allCards.filter(({card}) => !card.id.startsWith('TD'));
  if (search) allCards = allCards.filter(({card}) => card.name.toLowerCase().includes(search) || card.clan.toLowerCase().includes(search));

  const sortMode = document.getElementById('coll-sort')?.value || 'rarity';

  // Build a shared card row renderer
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
          <span>${card.clan} · G${card.grade}</span>${badge}
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

// ==================== HISTORY ====================
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
  const rarityOrder = ["SGR","SCR","GR","OR","LR","SP","RRR","RR","R","C"];
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

// ==================== TABS ====================
function switchTab(name) {
  const tabs = ['collection','history','missing'];
  document.querySelectorAll('.tab-btn').forEach((b,i) => b.classList.toggle('active', tabs[i]===name));
  document.getElementById('tab-collection').classList.toggle('active', name==='collection');
  document.getElementById('tab-history').classList.toggle('active', name==='history');
  document.getElementById('tab-missing').classList.toggle('active', name==='missing');
  if (name === 'missing') renderMissing();
}

// ==================== ZOOM MODAL ====================
let zoomCard = null;
function openZoom(card) {
  zoomCard = card;
  const img = document.getElementById('zoom-img');
  const fallback = document.getElementById('zoom-fallback');
  img.dataset.tried = '0';
  img.dataset.id = card.id;
  img.src = cardImgPath(card.id);
  img.style.display = 'block';
  fallback.style.display = 'none';
  img.onerror = () => {
    const tried = parseInt(img.dataset.tried || '0') + 1;
    img.dataset.tried = tried;
    const exts = ['png','jpg','jpeg'];
    if (tried < exts.length) {
      img.onerror = img.onerror;
      img.src = cardImgPath(card.id, exts[tried]);
    } else {
      img.style.display = 'none';
      fallback.style.display = 'flex';
      document.getElementById('zoom-icon').textContent = card.icon;
    }
  };
  document.getElementById('zoom-name').textContent = card.name;
  document.getElementById('zoom-sub').textContent = `${card.clan} · Grade ${card.grade} · ${card.rarity}`;
  document.getElementById('zoom-sub').style.color = `var(--rarity-${card.rarity.toLowerCase()})`;
  // Extra info row
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
  // Wishlist btn
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
  if (zoomCard) { addToDeck(zoomCard); document.getElementById('zoom-overlay').classList.remove('active'); }
}

// ── Wire up card grid clicks to zoom ──
function attachZoomToGrid() {
  document.querySelectorAll('.card-slot').forEach((slot, i) => {
    slot.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const inner = slot.querySelector('.card-inner');
      if (!inner.classList.contains('flipped')) return; // only zoom revealed cards
      // find card data from rendered order
      if (window._lastRevealedCards && window._lastRevealedCards[i]) {
        openZoom(window._lastRevealedCards[i]);
      }
    });
  });
}

// ==================== GALLERY ====================
let galleryRarityFilter = 'ALL';
let galleryClanFilter = 'ALL';
let galleryTypeFilter = 'ALL';
let galleryGradeFilter = 'ALL';
let gallerySetFilter = 'ALL';
let _galRenderEpoch = 0;
let galleryFormat = 'OG';   // 'OG' | 'G'
let deckPoolFormat = 'OG';  // 'OG' | 'G'

let galleryFiltersOpen = false;
function toggleGalleryFilters() {
  galleryFiltersOpen = !galleryFiltersOpen;
  document.getElementById('gallery-filter-panel').classList.toggle('open', galleryFiltersOpen);
  document.getElementById('gallery-filter-toggle').classList.toggle('active', galleryFiltersOpen);
}
function openGallery() {
  buildGalleryFilters();
  renderGallery();
  document.getElementById('gallery-overlay').classList.add('active');
}
function closeGallery() { document.getElementById('gallery-overlay').classList.remove('active'); }

function buildGalleryFilters() {
  const allCards = getAllSetCards();
  const EXTRA_CLANS = ['Angel Feather','Dimension Police','Gear Chronicle','Genesis','Link Joker','Neo Nectar','Pale Moon'];
  const clans = ['ALL', ...new Set([...allCards.map(c => c.clan), ...EXTRA_CLANS])].sort((a,b) => a==='ALL'?-1:a.localeCompare(b));
  document.getElementById('gallery-set-filters') && (document.getElementById('gallery-set-filters').innerHTML = ['ALL',...SETS.map(s=>s.id)].map(s => `<button class="filter-btn ${s===gallerySetFilter?'active':''}" onclick="setGallerySet('${s}')">${s==='ALL'?'All Sets':s}</button>`).join(''));
  const RARITY_ORDER_ALL = ['ALL','TD','C','R','RR','RRR','SP','LR','SCR','GR','SGR'];
  const presentRarities = new Set(getAllSetCards().map(c=>c.rarity));
  const rarities = RARITY_ORDER_ALL.filter(r => r==='ALL'||r==='TD'||presentRarities.has(r));
  const _galIsG = s => s.format === 'G';
  const _galInFmt = s => galleryFormat === 'G' ? _galIsG(s) : !_galIsG(s);
  const sets = ['ALL',...SETS.filter(s=>s.packSize!==50&&_galInFmt(s)).map(s=>s.id).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),...SETS.filter(s=>s.packSize===50&&_galInFmt(s)).map(s=>s.id).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))];
  document.getElementById('gallery-set-filters').innerHTML = sets.map(s =>
    `<button class="filter-btn ${s===gallerySetFilter?'active':''}" onclick="setGallerySet('${s}')">${s==='ALL'?'All Sets':s}</button>`
  ).join('');
  document.getElementById('gallery-rarity-filters').innerHTML = rarities.map(r =>
    `<button class="filter-btn ${r===galleryRarityFilter?'active':''}" onclick="setGalleryRarity('${r}')">${r==='ALL'?'All':r}</button>`
  ).join('');
  document.getElementById('gallery-clan-filters').innerHTML = clans.map(c =>
    `<button class="filter-btn ${c===galleryClanFilter?'active':''}" onclick="setGalleryClan('${c}')">${c==='ALL'?'All Clans':c}</button>`
  ).join('');
  const types = ['ALL','Normal','Trigger','🗡 Critical','🃏 Draw','🔄 Stand','💚 Heal','Sentinel','Wishlist'];
  document.getElementById('gallery-type-filters').innerHTML = types.map(t =>
    `<button class="filter-btn ${t===galleryTypeFilter?'active':''}" onclick="setGalleryType('${t}')">${t==='ALL'?'All Types':t}</button>`
  ).join('');
  const maxGrade = Math.max(...getAllSetCards().map(c=>c.grade));
  const grades = ['ALL',...Array.from({length:maxGrade+1},(_,i)=>String(i))];
  // Add a G Units shortcut if G4+ cards exist
  // Always show Grade N label; G Units get a separate toggle via type filter
  const gradeButtons = grades.map(g =>
    `<button class="filter-btn ${g===galleryGradeFilter?'active':''}" onclick="setGalleryGrade('${g}')">${g==='ALL'?'All Grades':'G'+g}</button>`
  );
  // Add a G Units shortcut if any gUnit cards exist in collection
  const hasGUnits = getAllSetCards().some(c=>isGUnit(c));
  const gUnitBtn = hasGUnits
    ? `<button class="filter-btn ${'GUNITS'===galleryGradeFilter?'active':''}" onclick="setGalleryGrade('GUNITS')">✨ G Units</button>`
    : '';
  document.getElementById('gallery-grade-filters').innerHTML = gradeButtons.join('') + gUnitBtn;
}

function setGalleryFormat(fmt) {
  galleryFormat = fmt;
  gallerySetFilter = 'ALL';
  document.getElementById('gal-fmt-og').classList.toggle('active', fmt==='OG');
  document.getElementById('gal-fmt-g').classList.toggle('active', fmt==='G');
  buildGalleryFilters(); renderGallery();
}
function setGalleryRarity(r) { galleryRarityFilter=r; buildGalleryFilters(); renderGallery(); }
function setGalleryClan(c) { galleryClanFilter=c; buildGalleryFilters(); renderGallery(); }
function setGalleryType(t) { galleryTypeFilter=t; buildGalleryFilters(); renderGallery(); }
function setGalleryGrade(g) { galleryGradeFilter=g; buildGalleryFilters(); renderGallery(); }
function setGallerySet(s) { gallerySetFilter=s; buildGalleryFilters(); renderGallery(); }

// getAllSetCards() → see CARD_MAP section above

function renderGallery() {
  const search = document.getElementById('gallery-search').value.toLowerCase();
  const ownedOnly = document.getElementById('gallery-owned-only').checked;

  // Pre-build set lookup for the active set filter (O(1) instead of O(n) per card)
  const setFilterIds = gallerySetFilter === 'ALL' ? null
    : new Set((SETS.find(s => s.id === gallerySetFilter)?.cards || []).map(c => c.id));

  // Format filter: only show cards belonging to the active OG/G tab
  const _galIsG = id => { const s = SETS.find(x => x.id === id.split('_')[0]); return !!(s && s.format === 'G'); };

  const filtered = getAllSetCards().filter(card => {
    // Format must match active tab
    if (galleryFormat === 'G' ? !_galIsG(card.id) : _galIsG(card.id)) return false;
    // Owned-only: strictly hide unowned cards
    if (ownedOnly && !(collection[card.id]?.count > 0)) return false;
    // Set filter
    if (setFilterIds && !setFilterIds.has(card.id)) return false;
    if (galleryRarityFilter !== 'ALL' && card.rarity !== galleryRarityFilter) return false;
    if (galleryClanFilter !== 'ALL' && card.clan !== galleryClanFilter) return false;
    if (galleryTypeFilter === 'Wishlist') return wishlist.has(card.id);
    if (galleryTypeFilter !== 'ALL') {
      if (galleryTypeFilter === 'Trigger' && !isTrigger(card)) return false;
      else if (galleryTypeFilter === 'Sentinel' && !isSentinel(card)) return false;
      else if (galleryTypeFilter === 'Heal' && !isHeal(card)) return false;
      else if (galleryTypeFilter === 'Critical' || galleryTypeFilter === '🗡 Critical') { if (getTriggerType(card) !== 'Critical') return false; }
      else if (galleryTypeFilter === 'Draw' || galleryTypeFilter === '🃏 Draw') { if (getTriggerType(card) !== 'Draw') return false; }
      else if (galleryTypeFilter === 'Stand' || galleryTypeFilter === '🔄 Stand') { if (getTriggerType(card) !== 'Stand') return false; }
      else if (galleryTypeFilter === '💚 Heal') { if (!isHeal(card)) return false; }
      else if (galleryTypeFilter === 'Normal' && (card.grade === 0 || isSentinel(card))) return false;
    }
    if (galleryGradeFilter === 'GUNITS') { if (!isGUnit(card)) return false; }
    else if (galleryGradeFilter !== 'ALL' && card.grade !== parseInt(galleryGradeFilter)) return false;
    if (search && !card.name.toLowerCase().includes(search) && !card.clan.toLowerCase().includes(search)) return false;
    return true;
  });

  const missingFirst = document.getElementById('gallery-missing-sort')?.checked;
  if (missingFirst) filtered.sort((a,b) => { const ao=collection[a.id]?.count>0?1:0,bo=collection[b.id]?.count>0?1:0; return ao-bo; });
  const grid = document.getElementById('gallery-grid');

  function makeGalleryCard(card) {
    const owned = collection[card.id];
    const count = owned ? owned.count : 0;
    return `<div class="gallery-card rarity-card-${card.rarity} ${count===0?'not-owned':''}" onclick="openZoom(getAllCardById('${card.id}'))">
      <img class="gc-img" data-id="${card.id}" alt="${card.name}"
           loading="lazy" onerror="(function(el){if(!el._cands){el._cands=cardImgCandidates(el.dataset.id);el._ci=1;}if(el._ci<el._cands.length){el.src=el._cands[el._ci++];}else{el.style.display='none';el.nextElementSibling&&(el.nextElementSibling.style.display='flex');}})(this)"
           src="${cardImgPath(card.id)}">
      <div class="gc-fallback" style="display:none"><span style="font-size:32px">${card.icon}</span><span style="font-size:9px;color:var(--text-muted);text-align:center;padding:0 4px">${card.name}</span></div>
      ${count>0?`<span class="gc-count">${count}x</span>`:''}
      <span class="gc-rarity rarity-badge ${card.rarity}">${card.rarity}</span>
      ${isSentinel(card)?'<div style="position:absolute;bottom:22px;left:0;right:0;background:rgba(240,180,41,0.85);color:#000;font-size:7px;font-weight:700;text-align:center;padding:1px">🛡 Sentinel</div>':card.grade===0&&isTrigger(card)?`<div style="position:absolute;bottom:22px;left:0;right:0;background:${getTriggerColor(getTriggerType(card))};color:#fff;font-size:7px;font-weight:700;text-align:center;padding:1px">${getTriggerType(card)==='Heal'?'💚 Heal':getTriggerType(card)||''}</div>`:''}
      <button class="gc-add-deck" onclick="event.stopPropagation();addToDeck(getAllCardById('${card.id}'))" title="Add to deck">+</button>
    </div>`;
  }

  // Render first 80 immediately, then append the rest in idle chunks
  const CHUNK = 80;
  const _myGalEpoch = ++_galRenderEpoch;
  grid.innerHTML = filtered.slice(0, CHUNK).map(makeGalleryCard).join('');
  let idx = CHUNK;
  function appendChunk() {
    if (_myGalEpoch !== _galRenderEpoch) return; // stale render, abort
    if (idx >= filtered.length) return;
    const frag = document.createDocumentFragment();
    const div = document.createElement('div');
    div.innerHTML = filtered.slice(idx, idx + CHUNK).map(makeGalleryCard).join('');
    while (div.firstChild) frag.appendChild(div.firstChild);
    grid.appendChild(frag);
    idx += CHUNK;
    requestIdleCallback ? requestIdleCallback(appendChunk) : setTimeout(appendChunk, 16);
  }
  requestIdleCallback ? requestIdleCallback(appendChunk) : setTimeout(appendChunk, 16);
}

// getAllCardById() → see CARD_MAP section above

// ==================== DECK BUILDER ====================
let deck = {}; // cardId -> { card, count }

const DECK_MAX = 50;
const CARD_MAX_COPIES = 4;

// ── Card type helpers ──
// ── Sentinels: Grade 1 with [CONT] Sentinel (max 4 per deck total) ──
const CRITICAL_IDS = new Set([
  // BT01
  'BT01_012','BT01_024','BT01_056','BT01_063',
  // BT02
  'BT02_045','BT02_048','BT02_052','BT02_055','BT02_068','BT02_074',
  // BT03
  'BT03_046','BT03_053','BT03_063','BT03_069','BT03_078',
  // BT04
  'BT04_050','BT04_058','BT04_066','BT04_079',
  // BT05
  'BT05_052','BT05_059','BT05_068','BT05_071',
  // EB01
  'EB01_032',
  // EB02
  'EB02_027','EB02_032',
  // TD01
  'TD01_013',
  // TD02
  'TD02_016',
  // TD03
  'TD03_012',
  // TD04
  'TD04_012',
  // TD10_014 has non-breaking space in spreadsheet trigger field
  'TD10_014',
  // GTD01/02/03
  'GTD01_015','GTD02_015','GTD03_015',
  // EB03–EB12, TD05–TD17
  'EB04_029', 'EB04_033', 'EB05_029', 'EB05_034', 'EB06_029', 'EB06_030', 'EB07_029', 'EB07_034', 'EB08_029', 'EB08_030', 'EB09_029', 'EB09_030', 'EB10_029B', 'EB10_029W', 'EB10_030B', 'EB10_030W', 'EB11_029', 'EB11_030', 'EB12_029', 'EB12_033', 'TD05_015', 'TD06_015', 'TD07_015', 'TD08_014', 'TD09_014', 'TD11_014', 'TD12_014', 'TD13_014', 'TD14_014', 'TD16_014', 'TD17_014',
]);
const DRAW_IDS = new Set([
  // BT01
  'BT01_045','BT01_051','BT01_057','BT01_058',
  // BT02
  'BT02_046','BT02_059','BT02_064','BT02_073',
  // BT03
  'BT03_054','BT03_056','BT03_060','BT03_075',
  // BT04
  'BT04_051','BT04_059','BT04_067','BT04_073',
  // BT05
  'BT05_053','BT05_060','BT05_075','BT05_079',
  // EB02
  'EB02_028','EB02_033',
  // TD01
  'TD01_015',
  // TD02
  'TD02_013',
  // TD04
  'TD04_013','TD04_014',
  // GTD01/02/03
  'GTD01_016','GTD01_019','GTD02_016','GTD02_019','GTD03_016',
  // EB03–EB12, TD05–TD17
  'EB03_036', 'EB04_030', 'EB04_031', 'EB05_030', 'EB05_031', 'EB06_031', 'EB06_034', 'EB07_030', 'EB07_031', 'EB08_031', 'EB08_032', 'EB09_031', 'EB09_034', 'EB10_031B', 'EB10_031W', 'EB10_032B', 'EB10_032W', 'EB11_031', 'EB11_032', 'EB12_030', 'EB12_034', 'TD05_016', 'TD06_016', 'TD07_016', 'TD08_015', 'TD09_015', 'TD10_015', 'TD11_015', 'TD12_015', 'TD13_015', 'TD14_015', 'TD16_015', 'TD17_015',
]);
const STAND_IDS = new Set([
  // BT01
  'BT01_032','BT01_046','BT01_052','BT01_064','BT01_S012',
  // BT02
  'BT02_053','BT02_058','BT02_063','BT02_067',
  // BT03
  'BT03_047','BT03_049','BT03_061','BT03_079',
  // BT04
  'BT04_052','BT04_060','BT04_068','BT04_074','BT04_080',
  // BT05
  'BT05_055','BT05_062','BT05_065','BT05_077','BT05_082',
  // EB01
  'EB01_020','EB01_024',
  // EB02
  'EB02_029','EB02_030',
  // TD01
  'TD01_016',
  // TD02
  'TD02_014',
  // TD03
  'TD03_013','TD03_015',
  // GTD01/02/03
  'GTD01_017','GTD02_017','GTD03_017','GTD03_019',
  // EB03–EB12, TD05–TD17
  'EB03_023', 'EB03_031', 'EB04_034', 'EB04_035', 'EB05_032', 'EB06_032', 'EB06_035', 'EB07_032', 'EB08_034', 'EB08_035', 'EB09_032', 'EB09_035', 'EB10_033B', 'EB10_033W', 'EB10_035B', 'EB10_035W', 'EB11_033', 'EB11_035', 'EB12_031', 'EB12_035', 'TD05_017', 'TD06_017', 'TD07_017', 'TD08_016', 'TD09_016', 'TD10_016', 'TD11_016', 'TD12_016', 'TD13_016', 'TD14_016', 'TD16_016', 'TD17_016',
]);
const HEAL_IDS = new Set([
  // BT01
  'BT01_027','BT01_047','BT01_053','BT01_065','BT01_S011',
  // BT02
  'BT02_047','BT02_054',
  // BT03
  'BT03_048','BT03_055','BT03_062',
  // BT04
  'BT04_053','BT04_061','BT04_069',
  // BT05
  'BT05_054','BT05_061',
  // EB01
  'EB01_018','EB01_033',
  // EB02
  'EB02_031',
  // TD01
  'TD01_014',
  // TD02
  'TD02_015',
  // TD03
  'TD03_014',
  // TD04
  'TD04_015',
  // GTD01/02/03
  'GTD01_018','GTD02_018','GTD03_018',
  // EB03–EB12, TD05–TD17
  'EB04_032', 'EB05_033', 'EB05_035', 'EB06_033', 'EB07_033', 'EB07_035', 'EB08_033', 'EB09_033', 'EB10_034B', 'EB10_034W', 'EB11_034', 'EB12_032', 'TD05_018', 'TD06_018', 'TD07_018', 'TD08_017', 'TD09_017', 'TD10_017', 'TD11_017', 'TD12_017', 'TD13_017', 'TD14_017', 'TD16_017', 'TD17_017',
]);
const SENTINEL_IDS = new Set([
  // BT01
  'BT01_011','BT01_015','BT01_019',
  // BT02
  'BT02_010','BT02_014','BT02_019',
  // BT03
  'BT03_011','BT03_016','BT03_017',
  // BT04
  'BT04_011','BT04_014','BT04_017',
  // BT05
  'BT05_011','BT05_013',
  // EB02
  'EB02_007',
  // GTD01/02/03
  'GTD01_013','GTD02_013','GTD03_012',
  // EB04–EB12, TD05–TD17 (from Type=Sentinel in spreadsheet)
  'EB04_007', 'EB05_007', 'EB06_007', 'EB07_007', 'EB08_008', 'EB09_008', 'EB10_007B', 'EB10_007W', 'EB10_008B', 'EB10_008W', 'EB11_008', 'EB12_007', 'EB12_008',
]);
function getTriggerType(card) {
  if (card.grade !== 0) return null;
  const id = resolveBaseCard(card)?.id ?? card.id;
  if (HEAL_IDS.has(id))     return 'Heal';
  if (CRITICAL_IDS.has(id)) return 'Critical';
  if (DRAW_IDS.has(id))     return 'Draw';
  if (STAND_IDS.has(id))    return 'Stand';
  return null; // Grade 0 but not a trigger — it's a First Vanguard (FV) unit
}
function getUnitType(card) {
  if (card.grade === 0) return getTriggerType(card) ? getTriggerType(card)+' Trigger' : 'G0';
  return 'Normal Unit';
}


function getTriggerColor(type) {
  return {
    'Critical': 'rgba(240,180,41,0.85)',   // yellow
    'Draw':     'rgba(230,120,40,0.85)',    // orange
    'Stand':    'rgba(59,130,246,0.85)',    // blue
    'Heal':     'rgba(61,191,127,0.85)',    // green
  }[type] || 'rgba(0,0,0,0.65)';
}

// Any Grade 0 can be a First Vanguard
function isFirstVanguard(card) { return card.grade === 0; }

// A Grade 0 card is a trigger only if it's in one of the trigger ID sets
function isTrigger(card) {
  if (card.grade !== 0) return false;
  const id = resolveBaseCard(card)?.id ?? card.id;
  return HEAL_IDS.has(id) || CRITICAL_IDS.has(id) || DRAW_IDS.has(id) || STAND_IDS.has(id);
}
function isHeal(card) {
  if (HEAL_IDS.has(card.id)) return true;
  // SP parallel: check base card
  if (card.rarity === 'SP' && card.grade === 0) {
    const base = resolveBaseCard(card);
    if (base && HEAL_IDS.has(base.id)) return true;
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
function isSentinel(card) { return SENTINEL_IDS.has(card.id) || (card.rarity === 'SP' && !!resolveBaseCard(card) && SENTINEL_IDS.has((resolveBaseCard(card)||{}).id)); }

// ── Get the single clan currently in the deck ──
function getDeckClan() {
  // Grade 1-3 non-G-Unit cards define the clan (G Units are format-agnostic)
  for (const {card} of Object.values(deck)) {
    if (card.grade >= 1 && !isGUnit(card)) return card.clan;
  }
  // G0 triggers in main deck
  for (const {card} of Object.values(deck)) {
    if (!isGUnit(card)) return card.clan;
  }
  // SVG defines clan if nothing else in deck yet
  if (fvCard) return fvCard.clan;
  return null;
}

function openDeckBuilder() {
  buildDeckPoolFilters();
  renderDeckPool();
  renderDeckPanel();
  document.getElementById('deck-overlay').classList.add('active');
}
function closeDeckBuilder() { document.getElementById('deck-overlay').classList.remove('active'); }

let deckPoolClanFilter = 'ALL';
let _dpRenderEpoch = 0; // incremented each render to cancel stale async chunks
let deckPoolTypeFilter = 'ALL';
let deckPoolGradeFilter = 'ALL';
let deckPoolSetFilter = 'ALL';
let deckPoolRarityFilter = 'ALL';
function buildDeckPoolFilters() {
  const EXTRA_CLANS = ['Angel Feather','Dimension Police','Gear Chronicle','Genesis','Link Joker','Neo Nectar','Pale Moon'];
  const clans = ['ALL', ...new Set([...getAllSetCards().map(c=>c.clan), ...EXTRA_CLANS])].sort((a,b)=>a==='ALL'?-1:a.localeCompare(b));
  const _dpIsG = s => s.format === 'G';
  const _dpInFmt = s => deckPoolFormat === 'G' ? _dpIsG(s) : !_dpIsG(s);
  const sets = ['ALL', ...SETS.filter(s => _dpInFmt(s)).map(s => s.id)];
  const RARITY_ORDER_ALL2 = ['ALL','C','R','RR','RRR','SP','LR','SCR','GR','SGR'];
  const presentRarities2 = new Set(getAllSetCards().map(c=>c.rarity));
  const rarities = RARITY_ORDER_ALL2.filter(r => r==='ALL'||presentRarities2.has(r));
  const types = ['ALL','Normal','Trigger','🗡 Critical','🃏 Draw','🔄 Stand','💚 Heal','Sentinel'];
  const maxGrade2 = Math.max(...getAllSetCards().map(c=>c.grade));
  const grades = ['ALL',...Array.from({length:maxGrade2+1},(_,i)=>String(i))];
  const btn = (label, active, onclick) =>
    `<button class="filter-btn ${active?'active':''}" style="font-size:10px;padding:3px 8px;white-space:nowrap" onclick="${onclick}">${label}</button>`;
  document.getElementById('dp-set-filters').innerHTML = sets.map(s => btn(s==='ALL'?'All Sets':s, s===deckPoolSetFilter, `setDeckPoolSet('${s}')`)).join('');
  document.getElementById('dp-clan-filters').innerHTML = clans.map(c => btn(c==='ALL'?'All Clans':c, c===deckPoolClanFilter, `setDeckPoolClan('${c}')`)).join('');
  document.getElementById('dp-rarity-filters').innerHTML = rarities.map(r => btn(r==='ALL'?'All Rarity':r, r===deckPoolRarityFilter, `setDeckPoolRarity('${r}')`)).join('');
  document.getElementById('dp-type-filters').innerHTML = types.map(t => btn(t==='ALL'?'All Types':t, t===deckPoolTypeFilter, `setDeckPoolType('${t}')`)).join('');
  const hasGUnitsDP = getAllSetCards().some(c=>isGUnit(c));
  const gUnitBtnDP = hasGUnitsDP ? btn('✨ G Units','GUNITS'===deckPoolGradeFilter,"setDeckPoolGrade('GUNITS')") : '';
  document.getElementById('dp-grade-filters').innerHTML =
    grades.map(g => btn(g==='ALL'?'All Grades':'Grade '+g, g===deckPoolGradeFilter, `setDeckPoolGrade('${g}')`)).join('') + gUnitBtnDP;
}
function setDeckPoolFormat(fmt) {
  deckPoolFormat = fmt;
  deckPoolSetFilter = 'ALL';
  document.getElementById('dp-fmt-og').classList.toggle('active', fmt==='OG');
  document.getElementById('dp-fmt-g').classList.toggle('active', fmt==='G');
  buildDeckPoolFilters(); renderDeckPool();
}
function setDeckPoolClan(c) { deckPoolClanFilter=c; buildDeckPoolFilters(); renderDeckPool(); }
function setDeckPoolType(t) { deckPoolTypeFilter=t; buildDeckPoolFilters(); renderDeckPool(); }
function setDeckPoolGrade(g) { deckPoolGradeFilter=g; buildDeckPoolFilters(); renderDeckPool(); }
function setDeckPoolSet(s) { deckPoolSetFilter=s; buildDeckPoolFilters(); renderDeckPool(); }
function setDeckPoolRarity(r) { deckPoolRarityFilter=r; buildDeckPoolFilters(); renderDeckPool(); }

function renderDeckPool() {
  const deckSearch = (document.getElementById('deck-search')?.value||'').toLowerCase();
  // Build set lookup once for O(1) per-card check
  const dpSetFilterIds = deckPoolSetFilter === 'ALL' ? null
    : new Set((SETS.find(s => s.id === deckPoolSetFilter)?.cards || []).map(c => c.id));

  const allCards = getAllSetCards().filter(card => {
    if (!(collection[card.id]?.count > 0)) return false;
    const _cardSet = SETS.find(s=>s.id===card.id.split('_')[0]);
    const _cardIsG = !!(_cardSet && _cardSet.format==='G');
    if (deckPoolFormat === 'G' ? !_cardIsG : _cardIsG) return false;
    if (dpSetFilterIds && !dpSetFilterIds.has(card.id)) return false;
    if (deckPoolRarityFilter !== 'ALL' && card.rarity !== deckPoolRarityFilter) return false;
    if (deckPoolClanFilter !== 'ALL' && card.clan !== deckPoolClanFilter) return false;
    if (deckPoolTypeFilter !== 'ALL') {
      if ((deckPoolTypeFilter === 'Trigger') && !isTrigger(card)) return false;
      else if (deckPoolTypeFilter === 'Sentinel' && !isSentinel(card)) return false;
      else if (deckPoolTypeFilter === 'Heal' || deckPoolTypeFilter === '💚 Heal') { if (!isHeal(card)) return false; }
      else if (deckPoolTypeFilter === 'Normal' && (card.grade === 0 || isSentinel(card))) return false;
      else if (deckPoolTypeFilter === '🗡 Critical') { if (getTriggerType(card) !== 'Critical') return false; }
      else if (deckPoolTypeFilter === '🃏 Draw') { if (getTriggerType(card) !== 'Draw') return false; }
      else if (deckPoolTypeFilter === '🔄 Stand') { if (getTriggerType(card) !== 'Stand') return false; }
      else if (['Critical','Draw','Stand'].includes(deckPoolTypeFilter) && getTriggerType(card) !== deckPoolTypeFilter) return false;
    }
    if (deckPoolGradeFilter === 'GUNITS') { if (!isGUnit(card)) return false; }
    else if (deckPoolGradeFilter !== 'ALL' && card.grade !== parseInt(deckPoolGradeFilter)) return false;
    if (deckSearch && !card.name.toLowerCase().includes(deckSearch) && !card.clan.toLowerCase().includes(deckSearch)) return false;
    return true;
  });

  // Sort by owned count if toggle is on
  if (document.getElementById('deck-sort-owned')?.checked) {
    allCards.sort((a,b) => (collection[b.id]?.count||0) - (collection[a.id]?.count||0));
  }

  const deckCounts = {};
  for (const [id, {count}] of Object.entries(deck)) deckCounts[id] = count;

  document.getElementById('deck-pool-grid').innerHTML = '';
  const dpGrid = document.getElementById('deck-pool-grid');

  function makeDeckCard(card) {
    const owned = collection[card.id]?.count || 0;
    const inDeck = deckCounts[card.id] || 0;
    const isTheFV = fvCard && fvCard.id === card.id;
    const deckFull = getDeckTotal() >= DECK_MAX;
    const nameCopies = countByName(getDeckName(card));
    const nameMaxed = nameCopies >= CARD_MAX_COPIES;
    const fvUsesThisId = isTheFV ? 1 : 0;
    const noMoreCopies = (inDeck + fvUsesThisId) >= owned;
    const deckClanNow = getDeckClan();
    const wrongClan = !isClanAllowed(card, deckClanNow);
    // Hide wrong-clan cards once a clan is established (except G Units which are always shown)
    if (wrongClan && deckClanNow && !isGUnit(card)) return null;
    const addBlocked = deckFull || nameMaxed || noMoreCopies;
    let dimReason = nameMaxed ? `Max 4 copies of "${card.name}"` : noMoreCopies ? 'No spare copies' : deckFull ? 'Deck full' : '';
    const svgHandler = card.grade === 0 ? `oncontextmenu="event.preventDefault();setFirstVanguard(getAllCardById('${card.id}'))"` : '';
    const titleTip = card.grade===0
      ? `${card.name} — Click: add trigger | Right-click: set as SVG${dimReason?' ('+dimReason+')':''}`
      : `${card.name}${dimReason?' — '+dimReason:''}`;
    return `<div class="pool-card rarity-card-${card.rarity} ${addBlocked?'maxed':''} ${isTheFV?'svg-selected':''}"
      onclick="addToDeck(getAllCardById('${card.id}'))" ${svgHandler} title="${titleTip}">
      <img data-id="${card.id}" alt="${card.name}" src="${cardImgPath(card.id)}"
           loading="lazy" onerror="(function(el){if(!el._cands){el._cands=cardImgCandidates(el.dataset.id);el._ci=1;}if(el._ci<el._cands.length){el.src=el._cands[el._ci++];}else{el.style.display='none';el.nextElementSibling&&(el.nextElementSibling.style.display=\'flex\');}})(this)">
      <div class="pc-fallback" style="display:none"><span>${card.icon}</span><span style="font-size:8px;text-align:center;padding:0 4px;color:var(--text-muted)">${card.name}</span></div>
      <span class="pc-count-badge">${owned}x</span>
      ${inDeck>0?`<div class="pc-in-deck">${inDeck} in deck</div>`:''}
      ${isTheFV?'<div style="position:absolute;top:3px;left:3px;background:rgba(79,142,247,0.9);color:white;font-size:8px;font-weight:700;padding:1px 4px;border-radius:3px">★FV</div>':''}
      <button class="wishlist-btn ${wishlist.has(card.id)?'active':''}" onclick="event.stopPropagation();toggleWishlist('${card.id}')" title="${wishlist.has(card.id)?'Remove from wishlist':'Add to wishlist'}">⭐</button>
      ${isSentinel(card)?'<div style="position:absolute;bottom:22px;left:0;right:0;background:rgba(240,180,41,0.85);color:#000;font-size:7px;font-weight:700;text-align:center;padding:1px">🛡 Sentinel</div>':''}
      ${card.grade===0&&isTrigger(card)?`<div style="position:absolute;bottom:18px;left:0;right:0;background:${getTriggerColor(getTriggerType(card))};color:#fff;font-size:7px;font-weight:700;text-align:center;padding:1px">${getTriggerType(card)==='Heal'?'💚 Heal':getTriggerType(card)||''}</div>`:''}
    </div>`;
  }

  const DP_CHUNK = 80;
  const _myEpoch = ++_dpRenderEpoch;
  dpGrid.innerHTML = allCards.slice(0, DP_CHUNK).map(makeDeckCard).filter(Boolean).join('') || '<div style="color:var(--text-muted);font-size:13px;padding:20px">Open packs to get cards first!</div>';
  let dpIdx = DP_CHUNK;
  function appendDpChunk() {
    if (_myEpoch !== _dpRenderEpoch) return; // stale — a newer render started
    if (dpIdx >= allCards.length) return;
    const frag = document.createDocumentFragment();
    const div = document.createElement('div');
    div.innerHTML = allCards.slice(dpIdx, dpIdx + DP_CHUNK).map(makeDeckCard).filter(Boolean).join('');
    while (div.firstChild) frag.appendChild(div.firstChild);
    dpGrid.appendChild(frag);
    dpIdx += DP_CHUNK;
    requestIdleCallback ? requestIdleCallback(appendDpChunk) : setTimeout(appendDpChunk, 16);
  }
  if (allCards.length > DP_CHUNK) requestIdleCallback ? requestIdleCallback(appendDpChunk) : setTimeout(appendDpChunk, 16);
}

// SVG counts as 1 of the 50-card deck (1 SVG + 49 main)
let fvCard = null;

// Cross-clan exceptions:
// Blaster Dark (Shadow Paladin) can be played in a Royal Paladin deck that contains Majesty Lord Blaster.
// Majesty Lord Blaster is itself Royal Paladin, so no exception needed for it.
// We allow Blaster Dark in Royal Paladin unconditionally (trusting the player knows the ruling).
const CROSS_CLAN_ALLOW = {
  'Blaster Dark': ['Royal Paladin'],
  // Majesty Lord Blaster is Royal Paladin — no cross-clan entry needed
};

function isClanAllowed(card, deckClan) {
  if (isGUnit(card)) return true; // G Units go in G Zone, no clan restriction
  if (card.crayElemental) return true; // Cray Elementals are neutral — any clan
  if (!deckClan || card.clan === deckClan) return true;
  const exceptions = CROSS_CLAN_ALLOW[card.name];
  return exceptions && exceptions.includes(deckClan);
}

// Count total copies of a card NAME across the whole deck (SVG + main deck, all rarities)
function isGUnit(card) {
  return !!(card && card.gUnit);
}

function getDeckName(card) {
  if (!card) return "";
  // For EB10 B/W variants: strip the (Noir)/(Blanc) suffix so both variants
  // share the same 4-copy limit (they are the same card in different art).
  return card.name.replace(/ \(Noir\)$/, '').replace(/ \(Blanc\)$/, '');
}
function countByName(name) {
  let n = fvCard && getDeckName(fvCard) === name ? 1 : 0;
  for (const {card, count} of Object.values(deck)) {
    if (getDeckName(card) === name) n += count;
  }
  return n;
}

// Total cards in deck including SVG slot
function getDeckTotal() {
  const svgCount = fvCard ? 1 : 0;
  return svgCount + Object.values(deck).reduce((s, x) => s + (isGUnit(x.card) ? 0 : x.count), 0);
}
function getGZoneTotal() {
  return Object.values(deck).reduce((s, x) => s + (isGUnit(x.card) ? x.count : 0), 0);
}

function addToDeck(card) {
  if (!card) return;
  // SP parallels ARE allowed; the 4-copy-by-name rule below handles deduplication
  const owned = collection[card.id]?.count || 0;
  if (!owned) { showToast({icon:'⚠️',name:'You don\'t own this card',rarity:'C'}); return; }

  // 1-clan rule (with cross-clan exceptions)
  const deckClan = getDeckClan();
  if (!isClanAllowed(card, deckClan)) {
    showToast({icon:'⚠️',name:`Deck must be 1 clan only (${deckClan})`,rarity:'C'}); return;
  }

  // G Zone limit: max 16 G Units (separate from main deck)
  if (isGUnit(card)) {
    if (getGZoneTotal() >= 16) { showToast({icon:'⚠️',name:'G Zone is full (max 16 G Units)',rarity:'C'}); return; }
  } else {
    // Main deck limit: 50 cards (excl. G Units)
    if (getDeckTotal() >= DECK_MAX) { showToast({icon:'⚠️',name:'Deck is full (50 cards incl. FV)',rarity:'C'}); return; }
  }

  // Max 4 copies by name across all rarities + SVG slot
  const deckNameKey = getDeckName(card);
  const nameTotal = countByName(deckNameKey);
  if (nameTotal >= CARD_MAX_COPIES) {
    showToast({icon:'⚠️',name:`Max 4 copies of "${deckNameKey}" across all rarities`,rarity:'C'}); return;
  }

  // Can't use more of this specific ID than you own
  const inDeck = deck[card.id]?.count || 0;
  const fvUsesThisId = fvCard && fvCard.id === card.id ? 1 : 0;
  if (inDeck + fvUsesThisId >= owned) {
    showToast({icon:'⚠️',name:`No more copies of ${card.id} available`,rarity:'C'}); return;
  }

  // Sentinel limit: max 4 total sentinels
  if (isSentinel(card)) {
    const sentinelCount = Object.values(deck).filter(x=>isSentinel(x.card)).reduce((s,x)=>s+x.count,0);
    if (sentinelCount >= 4) { showToast({icon:'⚠️',name:'Max 4 sentinels in a deck',rarity:'C'}); return; }
  }

  // Heal limit: max 4 heals
  if (isHeal(card)) {
    const healCount = Object.values(deck).filter(x=>isHeal(x.card)).reduce((s,x)=>s+x.count,0);
    if (healCount >= 4) { showToast({icon:'⚠️',name:'Max 4 heal triggers in a deck',rarity:'C'}); return; }
  }

  // Trigger limit: max 16 total (main deck + FV)
  if (isTrigger(card)) {
    const triggerCount = Object.values(deck).filter(x=>isTrigger(x.card)).reduce((s,x)=>s+x.count,0);
    const fvTrigger = (fvCard && isTrigger(fvCard)) ? 1 : 0;
    if (triggerCount + fvTrigger >= 16) { showToast({icon:'⚠️',name:'Max 16 triggers in a deck',rarity:'C'}); return; }
  }

  if (!deck[card.id]) deck[card.id] = { card, count: 0 };
  deck[card.id].count++;
  // Refresh only the affected card in the pool (avoid full re-render)
  _refreshPoolCard(card.id);
  renderDeckPanel();
}

// Update a single pool card's badge + blocked state without re-rendering the whole pool
function _refreshPoolCard(cardId) {
  // Find all pool-card elements for this id and nearby cards that share the same name
  // (nameMaxed state may change for cards with the same base name)
  const affected = new Set();
  affected.add(cardId);
  const card = getAllCardById(cardId);
  if (card) {
    const baseName = getDeckName(card);
    // Also refresh cards sharing the same base name (copy-limit affects them all)
    for (const {card:c} of Object.values(deck)) {
      if (getDeckName(c) === baseName) affected.add(c.id);
    }
    for (const c of getAllSetCards()) {
      if (getDeckName(c) === baseName && collection[c.id]) affected.add(c.id);
    }
  }
  // Re-render only those elements
  const deckClanNow = getDeckClan();
  for (const id of affected) {
    const el = document.querySelector(`.pool-card img[data-id="${id}"]`)?.closest('.pool-card');
    if (!el) continue;
    const c = getAllCardById(id);
    if (!c) continue;
    const owned = collection[id]?.count || 0;
    const inDeck = deck[id]?.count || 0;
    const isTheFV = fvCard && fvCard.id === id;
    const deckFull = getDeckTotal() >= DECK_MAX;
    const nameMaxed = countByName(getDeckName(c)) >= CARD_MAX_COPIES;
    const noMoreCopies = (inDeck + (isTheFV?1:0)) >= owned;
    const addBlocked = deckFull || nameMaxed || noMoreCopies;
    el.classList.toggle('maxed', addBlocked);
    const badge = el.querySelector('.pc-count-badge');
    if (badge) badge.textContent = owned + 'x';
    const inDeckEl = el.querySelector('.pc-in-deck');
    if (inDeck > 0) {
      if (inDeckEl) inDeckEl.textContent = inDeck + ' in deck';
      else {
        const d = document.createElement('div');
        d.className = 'pc-in-deck';
        d.textContent = inDeck + ' in deck';
        el.appendChild(d);
      }
    } else if (inDeckEl) inDeckEl.remove();
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

  // If replacing old SVG, first "free" that slot then check
  const oldFV = fvCard;

  // Count how many of this card name are in the deck excluding the current SVG contribution
  const nameCountExSVG = countByName(getDeckName(card)) - (oldFV && getDeckName(oldFV) === getDeckName(card) ? 1 : 0);
  if (nameCountExSVG >= CARD_MAX_COPIES) {
    showToast({icon:'⚠️',name:`Already have 4 copies of "${card.name}" in deck`,rarity:'C'}); return;
  }

  // Check you physically have a spare copy (main deck usage of this id + new SVG <= owned)
  const inDeckMain = deck[card.id]?.count || 0;
  const oldFVUsesThisId = oldFV && oldFV.id === card.id ? 1 : 0;
  if (inDeckMain + 1 - oldFVUsesThisId > owned) {
    showToast({icon:'⚠️',name:`Not enough copies of ${card.name} (need 1 spare for SVG)`,rarity:'C'}); return;
  }

  // If no SVG yet, deck would grow by 1 — check total
  if (!oldFV && getDeckTotal() >= DECK_MAX) {
    showToast({icon:'⚠️',name:'Deck is at 50 — remove a card before setting SVG',rarity:'C'}); return;
  }

  fvCard = card;
  renderDeckPool();
  renderDeckPanel();
}

function clearFV() {
  fvCard = null;
  renderDeckPool();
  renderDeckPanel();
}

function removeFromDeck(cardId) {
  if (!deck[cardId]) return;
  deck[cardId].count--;
  if (deck[cardId].count <= 0) delete deck[cardId];
  renderDeckPool();
  renderDeckPanel();
}

function clearDeck() {
  if (!confirm('Clear the entire deck?')) return;
  deck = {};
  fvCard = null;
  renderDeckPool();
  renderDeckPanel();
}

function renderDeckPanel() {
  const total = getDeckTotal();
  const pct = Math.min(100, (total/DECK_MAX)*100);
  const barColor = total > DECK_MAX ? 'var(--red)' : total === DECK_MAX ? 'var(--green)' : 'var(--accent)';
  document.getElementById('ds-total').textContent = total;  // SVG included in total
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
  if (g4el) {
    g4el.innerHTML = `${gUnits||0}<span style="font-size:11px;opacity:0.6">/16</span>`;
    g4el.style.color = gUnits >= 16 ? 'var(--green)' : gUnits > 0 ? 'var(--rarity-lr)' : 'var(--rarity-lr)';
  }
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

  // Validation checks
  const checks = [
    { ok: total === DECK_MAX,        warn: total > 0 && total < DECK_MAX,  msg: `Main Deck: ${total}/50` },
    { ok: !!fvCard,                 warn: false,                           msg: `First Vanguard (FV): ${fvCard ? '★ '+fvCard.name : 'Not set — right-click a G0'}` },
    { ok: !!getDeckClan(),           warn: false,                           msg: `Clan: ${getDeckClan()||'None yet'}` },
    { ok: triggers === 16, warn: triggers > 0 && triggers < 16, msg: `Triggers: ${triggers}/16 (🗡${crits} 🃏${draws} 🔄${stands} 💚${heals} 🛡${sentinels})` },
    { ok: heals <= 4,                warn: heals > 0 && heals < 4,         msg: `Heal triggers: ${heals}/4 max` },
    { ok: sentinels <= 4,            warn: sentinels > 0 && sentinels < 4, msg: `Sentinels: ${sentinels}/4 max` },
    { ok: gUnits === 16,               warn: gUnits > 0 && gUnits < 16,       msg: `G Zone: ${gUnits}/16` },
  ];
  document.getElementById('deck-validation').innerHTML = checks.map(c => {
    const cls = c.ok ? 'ok' : c.warn ? 'warn' : 'err';
    return `<div class="val-row"><div class="val-dot ${cls}"></div><span style="color:${c.ok?'var(--text)':'var(--text-muted)'}">${c.msg}</span></div>`;
  }).join('');

  // Deck list: SVG first, then grade 3 down to 0
  const maxG = Math.max(4, ...Object.values(deck).map(x=>x.card.grade));
  const byGrade = {};
  for (let g=0; g<=maxG; g++) byGrade[g]=[];
  for (const {card,count} of Object.values(deck)) byGrade[card.grade].push({card,count});
  for (let g=0; g<=maxG; g++) byGrade[g].sort((a,b)=>a.card.name.localeCompare(b.card.name));

  let html = '';
  if (fvCard) {
    html += `<div class="section-title" style="margin-bottom:4px;color:var(--accent)">First Vanguard</div>`;
    html += `<div class="deck-card-row">
      <span style="font-size:14px">${fvCard.icon}</span>
      <span class="dcr-name">${fvCard.name}</span>
      <span class="dcr-count" style="color:var(--accent)">★</span>
      <button class="dcr-remove" onclick="clearFV()" title="Remove FV">−</button>
    </div>`;
  }
  const gradeLabel = g => `Grade ${g}`;  // label set per-card type in sections below
  for (const g of Array.from({length:maxG+1},(_,i)=>maxG-i)) {
    if (!byGrade[g].length) continue;
    // Check if all cards in this grade bucket are G Units
    const allGUnits = byGrade[g].every(x=>isGUnit(x.card));
    const anyGUnits = byGrade[g].some(x=>isGUnit(x.card));
    const secLabel = allGUnits ? `G Units (Grade ${g})` : `Grade ${g}`;
    html += `<div class="section-title" style="margin-bottom:4px;margin-top:8px">${secLabel}</div>`;
    for (const {card,count} of byGrade[g]) {
      const tag = isHeal(card)?'💚':isSentinel(card)?'🛡️':isTrigger(card)?'⚡':isGUnit(card)?'✨':'';
      html += `<div class="deck-card-row">
        <span style="font-size:14px">${card.icon}</span>
        <span class="dcr-name">${card.name} ${tag}</span>
        <span class="dcr-count">${count}x</span>
        <button class="dcr-remove" onclick="removeFromDeck('${card.id}')" title="Remove one">−</button>
      </div>`;
    }
  }
  document.getElementById('deck-list').innerHTML = html || '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">No cards added yet</div>';
}


// ==================== EXPORT ====================
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
  document.getElementById('export-textarea').value = text;
  document.getElementById('export-overlay').classList.add('active');
}
function closeExport() { document.getElementById('export-overlay').classList.remove('active'); }

async function exportDeckImage() {
  const deckName = document.getElementById('deck-name-input').value || 'My Deck';
  const deckClan = getDeckClan() || 'N/A';
  const total    = getDeckTotal();

  // Build grade groups
  const maxGimg = Math.max(4, ...Object.values(deck).map(x=>x.card.grade));
  const byGrade = {};
  for (let g=0; g<=maxGimg; g++) byGrade[g]=[];
  for (const {card,count} of Object.values(deck)) byGrade[card.grade].push({card,count});
  for (let g=0; g<=maxGimg; g++) byGrade[g].sort((a,b)=>a.card.name.localeCompare(b.card.name));

  // ── Layout constants — high resolution ──
  // Use larger card size and scale canvas by 2x for crisp output
  const SCALE = 2;               // render at 2x then canvas CSS size stays logical
  const CARD_W = 120, CARD_H = 175, GAP = 10, COLS = 10;
  const SECTION_HEADER_H = 36, TOP_H = 150, BOTTOM_PAD = 32;
  const COL_W = CARD_W + GAP;

  // Count rows needed per grade section
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

  // Background
  ctx.fillStyle = '#14171f';
  ctx.fillRect(0, 0, WIDTH, totalHeight);
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let x = 0; x < WIDTH; x += 20) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,totalHeight); ctx.stroke(); }
  for (let y2 = 0; y2 < totalHeight; y2 += 20) { ctx.beginPath(); ctx.moveTo(0,y2); ctx.lineTo(WIDTH,y2); ctx.stroke(); }

  // Header bar
  const grad = ctx.createLinearGradient(0,0,WIDTH,0);
  grad.addColorStop(0,'#4f8ef7'); grad.addColorStop(1,'#7c3aed');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, 5);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 32px Arial';
  ctx.fillText(deckName, GAP*2, 48);
  ctx.fillStyle = 'rgba(79,142,247,0.18)';
  roundRect(ctx, GAP*2, 60, 280, 32, 7); ctx.fill();
  ctx.fillStyle = '#4f8ef7';
  ctx.font = '15px Arial';
  ctx.fillText(`${deckClan}  ·  ${total} / 50 cards`, GAP*2+12, 82);

  // Trigger bar
  const trigCounts = {Critical:0,Draw:0,Stand:0,Heal:0};
  if (fvCard) { const t=getTriggerType(fvCard); if(t&&trigCounts[t]!==undefined) trigCounts[t]++; }
  for (const {card,count} of Object.values(deck)) { const t=getTriggerType(card); if(t&&trigCounts[t]!==undefined) trigCounts[t]+=count; }
  const trigColors = {Critical:'#f0b429',Draw:'#e67820',Stand:'#3b82f6',Heal:'#3dbf7f'};
  let tx = GAP*2;
  for (const [t,cnt] of Object.entries(trigCounts)) {
    if (!cnt) continue;
    ctx.fillStyle = trigColors[t]+'33'; roundRect(ctx,tx,102,120,26,6); ctx.fill();
    ctx.fillStyle = trigColors[t]; ctx.font='bold 12px Arial';
    ctx.fillText(`${t}  ${cnt}x`, tx+10, 119); tx += 128;
  }

  // Card sections
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
    if(count>1){ctx.fillStyle='rgba(0,0,0,0.8)';roundRect(ctx,cx+CARD_W-26,cy+3,23,18,4);ctx.fill();ctx.fillStyle='#fff';ctx.font='bold 11px Arial';ctx.textAlign='center';ctx.fillText(`${count}x`,cx+CARD_W-14,cy+15);ctx.textAlign='left';}
    if(isFV){ctx.fillStyle='#4f8ef7';roundRect(ctx,cx+3,cy+3,34,16,4);ctx.fill();ctx.fillStyle='#fff';ctx.font='bold 9px Arial';ctx.textAlign='center';ctx.fillText('★ FV',cx+20,cy+14);ctx.textAlign='left';}
    const ttype=getTriggerType(card),isSent=isSentinel(card);
    if(ttype||isSent){const label=isSent?'🛡 Sentinel':{Critical:'🗡 Critical',Draw:'🃏 Draw',Stand:'🔄 Stand',Heal:'💚 Heal'}[ttype]||ttype;const col=isSent?'#f0b429':trigColors[ttype]||'#555';ctx.fillStyle=col;roundRect(ctx,cx,cy+CARD_H-18,CARD_W,18,{bl:6,br:6,tl:0,tr:0});ctx.fill();ctx.fillStyle='#000';ctx.font='bold 9px Arial';ctx.textAlign='center';ctx.fillText(label,cx+CARD_W/2,cy+CARD_H-5);ctx.textAlign='left';}
  }

  for (const g of sections) {
    const items = g===0&&fvCard ? [{card:fvCard,count:1,isFV:true},...byGrade[g]] : byGrade[g].map(x=>({...x,isFV:false}));
    if (!items.length) continue;
    ctx.fillStyle='rgba(255,255,255,0.06)'; ctx.fillRect(0,y,WIDTH,SECTION_HEADER_H);
    ctx.fillStyle='#4f8ef7'; ctx.font='bold 15px Arial'; ctx.fillText(`GRADE ${g}`,GAP*2,y+23);
    ctx.fillStyle='#6b7280'; ctx.font='12px Arial';
    ctx.fillText(`${items.reduce((s,x)=>s+x.count,0)} cards`,GAP*2+110,y+23);
    y += SECTION_HEADER_H + GAP;
    for(let i=0;i<items.length;i++){const col=i%COLS,row=Math.floor(i/COLS);await drawCardSlot(items[i].card,items[i].count,GAP+col*COL_W,y+row*(CARD_H+GAP),items[i].isFV);}
    y += Math.ceil(items.length/COLS)*(CARD_H+GAP)+GAP;
  }

  ctx.fillStyle='#374151'; ctx.font='11px Arial';
  ctx.fillText('Generated by Vanguard Pack Simulator', GAP*2, totalHeight-10);

  const link = document.createElement('a');
  link.download = `${deckName.replace(/[^a-z0-9]/gi,'_')}_deck.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  showToast({icon:'🖼',name:'Deck image exported!',rarity:'C'});
}




// Helper: rounded rectangle path (supports per-corner radii object or single number)
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


// ==================== TOAST ====================
function showToast(card) {
  // System messages (icon+name only, no "Nice pull!" prefix)
  const isSystem = ['✅','❌','⚠️','🗑️','📋'].includes(card.icon);
  const msgs = { RRR: '🌟 RRR Pull!', SP: '✨ SP Parallel!' };
  if (card._wishlistHit) { toast.className = 'toast rrr'; toast.textContent = `⭐ Wishlist Hit! ${card.name}`; document.getElementById('toast-container').appendChild(toast); setTimeout(() => toast.remove(), 4000); return; }
  const classes = { RRR: 'rrr', SP: 'sp' };
  const toast = document.createElement('div');
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


// Horizontal scroll with mouse wheel on filter rows
document.addEventListener('wheel', function(e) {
  const row = e.target.closest('.gallery-filter-row, .deck-filter-row');
  if (row) { e.preventDefault(); row.scrollLeft += e.deltaY + e.deltaX; }
}, { passive: false });


// ==================== PITY TRACKER ====================
function updatePityDisplay() {
  const el = document.getElementById('pity-count');
  const wrap = document.getElementById('pity-display');
  if (!el || !wrap) return;
  el.textContent = packsSinceLastRRR;
  const hot = packsSinceLastRRR >= 8;
  el.style.color = hot ? 'var(--gold)' : packsSinceLastRRR >= 5 ? 'var(--rarity-rr)' : 'var(--accent)';
  // Pulse the open buttons when getting unlucky
  document.querySelectorAll('.open-btns .btn').forEach(b => b.classList.toggle('pity-hot', hot));
}

// ==================== WISHLIST ====================
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

// ==================== QUICK-ADD FROM REVEAL ====================
function quickAddFromReveal(cardId) {
  const card = getAllCardById(cardId);
  if (!card) return;
  // Open deck builder if not open
  const overlay = document.getElementById('deck-overlay');
  if (!overlay.classList.contains('active')) openDeckBuilder();
  addToDeck(card);
}

// ==================== STATS MODAL ====================
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
  const rarityOrder = ["SP","RRR","RR","R","C"];
  const rarityColors = {SP:'var(--rarity-sp)',RRR:'var(--rarity-rrr)',RR:'var(--rarity-rr)',R:'var(--rarity-r)',C:'var(--rarity-c)'};

  // Set completion
  const boosterSets = SETS.filter(s=>s.id.startsWith('BT')||s.id.startsWith('EB'));
  const setRows = boosterSets.map(s => {
    const cards = s.cards.filter(c=>c.rarity!=='TD');
    const uniqueNames = [...new Set(cards.map(c=>c.name))];
    const owned = uniqueNames.filter(name => cards.some(c=>c.name===name && collection[c.id]?.count>0));
    const pct = uniqueNames.length ? Math.round((owned.length/uniqueNames.length)*100) : 0;
    const barColor = pct===100?'var(--green)':pct>=50?'var(--gold)':'var(--accent)';
    return `<div style="margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px">
        <span>${s.label} – ${s.name}</span>
        <span style="color:${barColor}">${owned.length}/${uniqueNames.length} (${pct}%)</span>
      </div>
      <div style="height:4px;background:var(--surface2);border-radius:2px">
        <div style="height:4px;width:${pct}%;background:${barColor};border-radius:2px;transition:width 0.3s"></div>
      </div>
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
            <div style="height:6px;width:${pct2}%;background:${rarityColors[r]};border-radius:3px"></div>
          </div>
          <span style="font-size:10px;color:var(--text-muted);width:60px;text-align:right">${byR[r]} (${pct2}%)</span>
        </div>`;
      }).join('')}
    </div>

    <div>
      <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">Set Completion</div>
      ${setRows}
    </div>
  `;
}

// ==================== KEYBOARD SHORTCUTS ====================
document.addEventListener('keydown', e => {
  // Don't fire when typing in an input
  if (['INPUT','TEXTAREA'].includes(e.target.tagName)) return;
  const key = e.key;
  const anyOverlay = document.querySelector('.zoom-overlay.active, .gallery-overlay.active, .deck-overlay.active, .export-overlay.active');
  if (key === 'Escape') {
    if (document.getElementById('stats-overlay')?.classList.contains('active')) { closeStats(); return; }
    if (document.getElementById('zoom-overlay')?.classList.contains('active')) { document.getElementById('zoom-overlay').classList.remove('active'); return; }
    if (document.getElementById('gallery-overlay')?.classList.contains('active')) { closeGallery(); return; }
    if (document.getElementById('deck-overlay')?.classList.contains('active')) { closeDeckBuilder(); return; }
    if (document.getElementById('export-overlay')?.classList.contains('active')) { closeExport(); return; }
  }
  if (anyOverlay) return; // don't fire pack shortcuts when modal open
  if (key === ' ' || key === 'Enter') { e.preventDefault(); stagePack(1); }
  if (key === 'r' || key === 'R') { const btn = document.getElementById('reveal-btn'); if (btn && btn.style.display !== 'none') revealCards(); }
  if (key === 'a' || key === 'A') { const btn = document.getElementById('flip-all-btn'); if (btn && btn.style.display !== 'none') flipAll(); }
});

// ==================== SAVE/LOAD — extend for wishlist & stats ====================
const _origBuildSaveData = buildSaveData;
buildSaveData = function() {
  const data = _origBuildSaveData();
  data.wishlist = [...wishlist];
  data.packsSinceLastRRR = packsSinceLastRRR;
  data.sessionStats = sessionStats;
  return data;
};
const _origApplySaveData = applySaveData;
applySaveData = function(data) {
  _origApplySaveData(data);
  wishlist = new Set(data.wishlist || []);
  packsSinceLastRRR = data.packsSinceLastRRR || 0;
  if (data.sessionStats) sessionStats = {...sessionStats, ...data.sessionStats};
  updatePityDisplay();
};


// ==================== MISSING CARD LIST ====================
function renderMissing() {
  const setFilter = document.getElementById('missing-set-filter')?.value || 'ALL';
  const container = document.getElementById('missing-list-container');
  if (!container) return;

  // Populate set filter options on first run
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
      if (card.rarity === 'SP') continue; // SP parallels optional
      if (!collection[card.id] || collection[card.id].count === 0) {
        missing.push(card);
      }
    }
  }

  if (!missing.length) {
    container.innerHTML = '<div class="empty-state"><div class="icon">✅</div><p>You own every card in this set!</p></div>';
    return;
  }

  // Group by set then rarity
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

// ==================== SOUND ====================
let soundEnabled = true;
function toggleSound(el) {
  soundEnabled = el.checked;
  const lbl = el.closest('.toggle-wrap')?.querySelector('.toggle-label');
  if (lbl) lbl.textContent = soundEnabled ? '🔊 Sound' : '🔇 Sound';
}

const SFX = (() => {
  // Tiny synthesized sounds via Web Audio API — no external files
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

// ==================== PACK RIP ANIMATION ====================
function playPackRip(icon, setLabel, boxSrc, callback) {
  const overlay = document.getElementById('pack-rip-overlay');
  const top     = document.getElementById('pack-rip-top');
  const bot     = document.getElementById('pack-rip-bot');
  const flash   = document.getElementById('rip-flash');
  if (!overlay) { callback(); return; }

  const H = 232; // half-height of the pack image display
  const cy = window.innerHeight / 2;

  // Load box image into both halves; fallback to emoji if missing
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

  // Position: top half sits just above centre, bottom half starts at centre
  top.style.top = (cy - H) + 'px';
  bot.style.top = cy + 'px';

  // Reset to closed position (no animation yet)
  top.style.transition = 'none';
  bot.style.transition = 'none';
  top.style.transform = 'translateX(-50%) translateY(0)';
  bot.style.transform = 'translateX(-50%) translateY(0)';

  overlay.style.display = 'block';
  overlay.style.pointerEvents = 'auto';

  SFX.packRip();

  // Brief pause so image loads, then tear apart
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

// ==================== GO ====================
init();
