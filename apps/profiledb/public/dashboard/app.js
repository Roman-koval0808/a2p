// public/dashboard/app.js

const API_BASE = '/api/v1';

// ─── STATE MANAGEMENT ───────────────────────────────────────────────────────
let state = {
  currentTenant: 'mlo',
  currentPage: 1,
  limit: 20,
  totalPages: 1,
  searchQuery: '',
  selectedBucket: '',
  selectedTemp: '',
  profiles: [],
  tenants: ['mlo']
};

let charts = {
  intent: null,
  temp: null,
  activity: null
};

// ─── DOM SELECTORS ──────────────────────────────────────────────────────────
const selectTenant = document.getElementById('tenant-select');
const btnSync = document.getElementById('btn-sync');
const btnClearDb = document.getElementById('btn-clear-db');

// KPI fields
const kpiTenants = document.getElementById('kpi-tenants');
const kpiProfiles = document.getElementById('kpi-profiles');
const kpiEvents = document.getElementById('kpi-events');
const kpiAvgScore = document.getElementById('kpi-avg-score');

// Filters
const searchInput = document.getElementById('search-query');
const bucketFilters = document.getElementById('bucket-filters');
const tempFilter = document.getElementById('temp-filter');

// Table
const tableTbody = document.getElementById('profiles-tbody');
const resultsCount = document.getElementById('results-count');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const pageIndicator = document.getElementById('page-indicator');

// Drawer
const drawer = document.getElementById('detail-drawer');
const drawerOverlay = document.getElementById('drawer-overlay');
const drawerClose = document.getElementById('drawer-close');
const drawerAvatar = document.getElementById('drawer-avatar');
const drawerName = document.getElementById('drawer-name');
const drawerIdSub = document.getElementById('drawer-id-sub');
const drawerEmail = document.getElementById('drawer-email');
const drawerPhone = document.getElementById('drawer-phone');
const drawerFullName = document.getElementById('drawer-full-name');
const drawerGroup = document.getElementById('drawer-group');
const drawerTier = document.getElementById('drawer-tier');
const drawerScoreLive = document.getElementById('drawer-score-live');
const drawerScoreRaw = document.getElementById('drawer-score-raw');
const drawerDecayPct = document.getElementById('drawer-decay-pct');
const drawerGraceStatus = document.getElementById('drawer-grace-status');
const drawerFingerprintsList = document.getElementById('drawer-fingerprints-list');
const drawerTimeline = document.getElementById('drawer-timeline');

// ─── INITIALIZATION & LISTENERS ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  init();
});

function init() {
  fetchAnalytics();
  fetchProfiles();
  fetchTenantAnalytics();

  // Listeners
  btnSync.addEventListener('click', syncAll);
  selectTenant.addEventListener('change', (e) => {
    state.currentTenant = e.target.value;
    state.currentPage = 1;
    fetchProfiles();
    fetchTenantAnalytics();
  });

  // Search input debounce (300ms)
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.searchQuery = e.target.value.trim();
      state.currentPage = 1;
      fetchProfiles();
    }, 300);
  });

  // Radio filters
  bucketFilters.addEventListener('change', (e) => {
    if (e.target.name === 'bucket') {
      state.selectedBucket = e.target.value;
      state.currentPage = 1;
      fetchProfiles();
    }
  });

  // Temperature filter
  tempFilter.addEventListener('change', (e) => {
    state.selectedTemp = e.target.value;
    state.currentPage = 1;
    fetchProfiles();
  });

  // Data clears
  btnClearDb.addEventListener('click', clearTenantData);

  // Pagination
  btnPrev.addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      fetchProfiles();
    }
  });
  btnNext.addEventListener('click', () => {
    if (state.currentPage < state.totalPages) {
      state.currentPage++;
      fetchProfiles();
    }
  });

  // Drawer closers
  drawerClose.addEventListener('click', closeDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);
}

// ─── FETCH PLATFORM ANALYTICS ──────────────────────────────────────────────
async function fetchAnalytics() {
  try {
    const res = await fetch(`${API_BASE}/analytics/aggregation`);
    if (!res.ok) throw new Error('Failed to fetch analytics');
    const data = await res.json();
    
    // Set KPIs
    kpiTenants.textContent = data.summary.totalTenants || '0';
    kpiProfiles.textContent = data.summary.totalProfiles || '0';
    kpiEvents.textContent = data.summary.totalEvents || '0';
    
    // Calculate average score dynamically
    const summaries = data.tenantSummaries || [];
    let totalScoreSum = 0;
    let totalProfilesCount = 0;
    summaries.forEach(t => {
      totalScoreSum += t.avgScoreLive * t.profileCount;
      totalProfilesCount += t.profileCount;
    });
    const avgScore = totalProfilesCount > 0 ? Math.round(totalScoreSum / totalProfilesCount) : 0;
    kpiAvgScore.textContent = `${avgScore} pts`;

    // Populate tenant select dynamically
    const currentSlugs = summaries.map(s => s.slug);
    state.tenants = [...new Set(['mlo', ...currentSlugs])];

    const currentSelected = selectTenant.value;
    selectTenant.innerHTML = '';
    state.tenants.forEach(tenantSlug => {
      const option = document.createElement('option');
      option.value = tenantSlug;
      option.textContent = `Business: ${tenantSlug}`;
      if (tenantSlug === currentSelected) {
        option.selected = true;
      }
      selectTenant.appendChild(option);
    });

  } catch (error) {
    console.error('Error fetching dashboard aggregation:', error);
  }
}

// ─── FETCH PROFILES LISTING ────────────────────────────────────────────────
async function fetchProfiles() {
  tableTbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Retrieving customer profiles...</td></tr>`;
  
  try {
    const url = new URL(`${API_BASE}/tenants/${state.currentTenant}/profiles`, window.location.origin);
    url.searchParams.append('page', state.currentPage);
    url.searchParams.append('limit', state.limit);
    url.searchParams.append('sortBy', 'lastEventAt');
    url.searchParams.append('sortOrder', 'desc');
    
    if (state.searchQuery) {
      url.searchParams.append('search', state.searchQuery);
    }
    if (state.selectedBucket) {
      url.searchParams.append('intentBucket', state.selectedBucket);
    }

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error('Profiles retrieval failed');
    const result = await res.json();
    
    let rawProfiles = result.data || [];
    
    // Client-side temperature filter (Hot >=80, Warm >=40, Cold <40)
    if (state.selectedTemp) {
      rawProfiles = rawProfiles.filter(p => {
        const score = p.scoreLive || 0;
        if (state.selectedTemp === 'hot') return score >= 80;
        if (state.selectedTemp === 'warm') return score >= 40 && score < 80;
        if (state.selectedTemp === 'cold') return score < 40;
        return true;
      });
    }

    state.profiles = rawProfiles;
    
    // Pagination data
    const pag = result.pagination || { page: 1, total: 0, limit: 20, totalPages: 1 };
    state.totalPages = Math.max(1, pag.totalPages);
    
    renderTable();
    updatePaginationControls(pag);
    
  } catch (error) {
    console.error('Error loading profiles list:', error);
    tableTbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Error retrieving profiles: ${error.message}</td></tr>`;
  }
}

// ─── RENDER PROFILES TABLE ─────────────────────────────────────────────────
function renderTable() {
  tableTbody.innerHTML = '';
  
  if (state.profiles.length === 0) {
    tableTbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No matching customer profiles found.</td></tr>`;
    resultsCount.textContent = '0 profiles matching criteria';
    return;
  }

  resultsCount.textContent = `Showing ${state.profiles.length} profiles`;

  state.profiles.forEach(p => {
    const isAnon = p.isAnonymous || (!p.email && !p.phone);
    const avatarLetter = isAnon ? '?' : (p.name ? p.name[0].toUpperCase() : 'U');
    const avatarClass = isAnon ? 'anonymous' : 'known';
    const profileName = isAnon ? 'Anonymous Visitor' : (p.name || 'Unidentified Lead');
    const profileId = p.id;
    const profileSub = isAnon ? `ID: ${profileId.slice(0, 8)}...` : (p.email || p.phone || 'No Identifiers');
    
    // Scores
    const scoreLive = p.scoreLive || 0;
    const scoreRaw = p.scoreRaw || 0;
    
    // Temperature Status
    let tempLabel = 'Cold';
    let tempClass = 'text-muted';
    if (scoreLive >= 80) {
      tempLabel = 'Hot';
      tempClass = 'badge badge-emergency';
    } else if (scoreLive >= 40) {
      tempLabel = 'Warm';
      tempClass = 'badge badge-active';
    }
    
    // Status tags
    let statusTagsHtml = '';
    if (p.inGrace) {
      statusTagsHtml += `<span class="status-tag grace">● grace</span> `;
    }
    if (p.decayPct > 0 && !p.inGrace) {
      statusTagsHtml += `<span class="status-tag decay">&darr; ${p.decayPct}% decay</span> `;
    }
    if (p.wasDemoted) {
      statusTagsHtml += `<span class="status-tag demoted">&darr; demoted</span> `;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="profile-cell">
          <div class="avatar ${avatarClass}">${avatarLetter}</div>
          <div>
            <div class="profile-title">${profileName}</div>
            <div class="profile-subtitle">${profileSub}</div>
          </div>
        </div>
      </td>
      <td class="text-center">
        <div class="text-xs">
          <span class="badge badge-${(p.tier || 'Tier 2B').toLowerCase().replace(' ', '')}" style="padding: 0.15rem 0.4rem; font-size: 10px;">${p.tier || 'Tier 2B'}</span>
          <div class="text-muted" style="font-size: 10px; margin-top: 2px;">Group ${p.group || 2}</div>
        </div>
      </td>
      <td class="text-center font-medium">${p.sessionCount || 1}</td>
      <td>
        <div class="score-group">
          <div class="score-live-row">
            <span class="score-live">${scoreLive}</span>
            <span class="score-raw">/ ${scoreRaw} raw</span>
          </div>
          <div class="score-meta-tags">
            ${statusTagsHtml}
          </div>
        </div>
      </td>
      <td>
        <span class="badge badge-${(p.bucket || 'unclassified').toLowerCase()}">${p.bucket || 'unclassified'}</span>
      </td>
      <td>
        <div class="text-xs">
          <strong>Temp:</strong> <span class="${scoreLive >= 40 ? '' : 'text-muted'}">${tempLabel}</span><br>
          <strong>Decayed:</strong> ${p.decayPct || 0}%
        </div>
      </td>
      <td class="text-muted text-xs">${new Date(p.lastEventAt || p.lastSeen).toLocaleString()}</td>
      <td class="text-right">
        <a href="#" class="action-link" onclick="openProfileDrawer('${p.id}'); return false;">
          Inspect Journey &rarr;
        </a>
      </td>
    `;
    tableTbody.appendChild(tr);
  });
}

// ─── PAGINATION UPDATES ───────────────────────────────────────────────────
function updatePaginationControls(pag) {
  pageIndicator.textContent = `Page ${state.currentPage} of ${state.totalPages}`;
  btnPrev.disabled = state.currentPage <= 1;
  btnNext.disabled = state.currentPage >= state.totalPages;
}

// ─── INSPECT PROFILE JOURNEY (DRAWER) ──────────────────────────────────────
async function openProfileDrawer(id) {
  // Clear previous details
  drawerName.textContent = 'Loading...';
  drawerIdSub.textContent = `ID: ${id}`;
  drawerEmail.textContent = '-';
  drawerPhone.textContent = '-';
  drawerFullName.textContent = '-';
  drawerGroup.textContent = '-';
  drawerTier.textContent = '-';
  drawerScoreLive.textContent = '-';
  drawerScoreRaw.textContent = '-';
  drawerDecayPct.textContent = '-';
  drawerGraceStatus.textContent = '-';
  drawerFingerprintsList.innerHTML = '<div class="text-muted text-xs">Loading...</div>';
  drawerTimeline.innerHTML = '<div class="text-muted text-xs">Loading activity logs...</div>';
  
  // Make drawer active
  drawer.classList.add('active');

  try {
    const res = await fetch(`${API_BASE}/tenants/${state.currentTenant}/profiles/${id}`);
    if (!res.ok) throw new Error('Failed to load profile details');
    const profile = await res.json();

    const isAnon = !profile.email && !profile.phone;
    
    // Set Header
    drawerAvatar.textContent = isAnon ? '?' : (profile.name ? profile.name[0].toUpperCase() : 'U');
    drawerAvatar.className = `avatar ${isAnon ? 'anonymous' : 'known'}`;
    drawerName.textContent = isAnon ? 'Anonymous Visitor' : (profile.name || 'Unidentified Lead');
    drawerIdSub.textContent = `ID: ${profile.id}`;

    // Set Identifiers
    drawerEmail.textContent = profile.email || 'None';
    drawerPhone.textContent = profile.phone || 'None';
    drawerFullName.textContent = profile.name || 'None';
    drawerGroup.textContent = profile.group !== undefined ? `Group ${profile.group}` : 'None';
    drawerTier.textContent = profile.tier || 'None';

    // Set Scores
    drawerScoreLive.textContent = profile.scoreLive || '0';
    drawerScoreRaw.textContent = profile.scoreRaw || '0';
    drawerDecayPct.textContent = `${profile.decayPct || 0}%`;
    drawerGraceStatus.textContent = profile.inGrace ? 'Active (No score decay)' : 'Expired (Decay active)';

    // Set Fingerprints
    const fingerprints = profile.fingerprints || [];
    drawerFingerprintsList.innerHTML = '';
    if (fingerprints.length === 0) {
      drawerFingerprintsList.innerHTML = '<div class="text-muted text-xs">No fingerprints linked to this profile.</div>';
    } else {
      fingerprints.forEach(fp => {
        const div = document.createElement('div');
        div.className = 'fingerprint-tag';
        div.innerHTML = `
          <span>${fp.fingerprintId}</span>
          <span class="text-xs">Seen: ${new Date(fp.lastSeenAt).toLocaleDateString()}</span>
        `;
        drawerFingerprintsList.appendChild(div);
      });
    }

    // Set Timeline
    const events = profile.events || [];
    drawerTimeline.innerHTML = '';
    if (events.length === 0) {
      drawerTimeline.innerHTML = '<div class="text-muted text-xs">No recorded activity for this user.</div>';
    } else {
      // Sort events newest first
      const sortedEvents = [...events].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
      
      sortedEvents.forEach(ev => {
        const div = document.createElement('div');
        div.className = 'timeline-item';
        
        const isHighlight = ev.eventType.includes('submit') || ev.eventType.includes('promo');
        const dotClass = isHighlight ? 'highlight' : '';
        
        const payloadStr = ev.payload ? JSON.stringify(ev.payload, null, 2) : '';
        const scoreDeltaHtml = ev.scoreDelta > 0 
          ? `<span style="color:#10b981; font-weight:bold;">+${ev.scoreDelta}</span>` 
          : (ev.scoreDelta < 0 ? `<span style="color:#ef4444; font-weight:bold;">${ev.scoreDelta}</span>` : `<span class="text-muted">0</span>`);

        div.innerHTML = `
          <div class="timeline-dot ${dotClass}"></div>
          <div class="timeline-content">
            <div class="timeline-header">
              <span class="timeline-title">${ev.eventType}</span>
              <span class="timeline-time">${new Date(ev.occurredAt).toLocaleTimeString()} (${new Date(ev.occurredAt).toLocaleDateString()})</span>
            </div>
            ${ev.pageUrl ? `<span class="timeline-page">Page: ${ev.pageUrl}</span>` : ''}
            <div class="text-xs text-muted" style="margin-top: 0.1rem;">
              <strong>Score Change:</strong> ${scoreDeltaHtml}
            </div>
            ${payloadStr && payloadStr !== '{}' ? `<pre class="timeline-details">${payloadStr}</pre>` : ''}
          </div>
        `;
        drawerTimeline.appendChild(div);
      });
    }

  } catch (error) {
    console.error('Error opening profile drawer:', error);
    drawerName.textContent = 'Error Loading';
    drawerTimeline.innerHTML = `<div class="text-danger text-xs">Failed to load detail: ${error.message}</div>`;
  }
}

// Global hook for table rows onclick
window.openProfileDrawer = openProfileDrawer;

function closeDrawer() {
  drawer.classList.remove('active');
}

// ─── CLEAR TELEMETRY CACHE ─────────────────────────────────────────────────
async function clearTenantData() {
  if (!confirm(`Are you absolutely sure you want to delete all telemetry events, device mappings, and customer profiles for business: "${state.currentTenant}"?\n\nThis action cannot be undone.`)) {
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/tenants/${state.currentTenant}/clear`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Clear request failed');
    const result = await res.json();
    
    alert(result.message || 'Tenant telemetry logs successfully cleared.');
    
    syncAll();
  } catch (error) {
    alert(`Failed to clear tenant database: ${error.message}`);
  }
}

// ─── GLOBAL RE-SYNC ────────────────────────────────────────────────────────
function syncAll() {
  fetchAnalytics();
  fetchProfiles();
  fetchTenantAnalytics();
}

// ─── FETCH BUSINESS-SPECIFIC ANALYTICS ──────────────────────────────────────
async function fetchTenantAnalytics() {
  try {
    const res = await fetch(`${API_BASE}/tenants/${state.currentTenant}/analytics`);
    if (!res.ok) throw new Error('Failed to fetch business analytics');
    const data = await res.json();
    renderCharts(data);
  } catch (error) {
    console.error('Error fetching business analytics:', error);
  }
}

// ─── RENDER CHARTJS GRAPHS ──────────────────────────────────────────────────
function renderCharts(data) {
  const fontColor = '#94a3b8';
  const gridColor = 'rgba(255, 255, 255, 0.05)';

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: fontColor,
          font: { family: 'Inter', size: 10, weight: '500' }
        }
      }
    }
  };

  // 1. Intent Stages Chart (Doughnut)
  const intentCtx = document.getElementById('chart-intent').getContext('2d');
  if (charts.intent) charts.intent.destroy();

  const intentLabels = ['Emergency', 'Active', 'Comparison', 'Research', 'Unclassified'];
  const intentColors = {
    emergency: '#ef4444',
    active: '#fbbf24',
    comparison: '#3b82f6',
    research: '#10b981',
    unclassified: '#94a3b8'
  };

  const intentDataMap = {};
  intentLabels.forEach(lbl => {
    intentDataMap[lbl.toLowerCase()] = 0;
  });
  data.intentBuckets.forEach(item => {
    const bucket = item.bucket.toLowerCase();
    if (intentDataMap[bucket] !== undefined) {
      intentDataMap[bucket] = item.count;
    }
  });

  charts.intent = new Chart(intentCtx, {
    type: 'doughnut',
    data: {
      labels: intentLabels,
      datasets: [{
        data: intentLabels.map(lbl => intentDataMap[lbl.toLowerCase()]),
        backgroundColor: intentLabels.map(lbl => intentColors[lbl.toLowerCase()]),
        borderWidth: 1,
        borderColor: 'rgba(15, 23, 42, 0.8)'
      }]
    },
    options: {
      ...chartOptions,
      cutout: '65%'
    }
  });

  // 2. Temperature Chart (Bar)
  const tempCtx = document.getElementById('chart-temp').getContext('2d');
  if (charts.temp) charts.temp.destroy();

  const tempLabels = ['Hot', 'Warm', 'Cold'];
  const tempCounts = [
    data.temperatures.hot || 0,
    data.temperatures.warm || 0,
    data.temperatures.cold || 0
  ];

  charts.temp = new Chart(tempCtx, {
    type: 'bar',
    data: {
      labels: tempLabels,
      datasets: [{
        label: 'Profiles',
        data: tempCounts,
        backgroundColor: ['#ef4444', '#fbbf24', '#3b82f6'],
        borderWidth: 0,
        borderRadius: 4
      }]
    },
    options: {
      ...chartOptions,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: fontColor }
        },
        y: {
          grid: { color: gridColor },
          ticks: { color: fontColor, precision: 0 }
        }
      }
    }
  });

  // 3. Activity Line Chart (Line)
  const activityCtx = document.getElementById('chart-activity').getContext('2d');
  if (charts.activity) charts.activity.destroy();

  const sortedActivity = data.dailyActivity || [];
  const activityLabels = sortedActivity.map(item => {
    const parts = item.date.split('-');
    return parts.length === 3 ? `${parts[1]}/${parts[2]}` : item.date;
  });
  const activityCounts = sortedActivity.map(item => item.count);

  charts.activity = new Chart(activityCtx, {
    type: 'line',
    data: {
      labels: activityLabels,
      datasets: [{
        label: 'Events',
        data: activityCounts,
        borderColor: '#14b8a6',
        backgroundColor: 'rgba(20, 184, 166, 0.1)',
        fill: true,
        tension: 0.3,
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: '#14b8a6'
      }]
    },
    options: {
      ...chartOptions,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: fontColor }
        },
        y: {
          grid: { color: gridColor },
          ticks: { color: fontColor, precision: 0 }
        }
      }
    }
  });
}
