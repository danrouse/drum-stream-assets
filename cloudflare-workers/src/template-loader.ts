// HTML Template
export function loadTemplate(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Song Request History - Danny the Liar</title>
    <style>{{CSS_CONTENT}}</style>
</head>
<body>
    <div class="header">
        <h1>Danny the Liar's<br />Song Request History</h1>
        <div class="stats-summary">
            <div class="stat-item">
                <div class="stat-number">{{READY_COUNT}}</div>
                <div class="stat-label">In Queue</div>
            </div>
            <div class="stat-item">
                <div class="stat-number">{{FULFILLED_COUNT}}</div>
                <div class="stat-label">Total Songs Played</div>
            </div>
            <div class="refresh-section">
                <button id="refresh-btn" class="refresh-button" onclick="refreshData()">
                    <span class="refresh-icon">🔄</span>
                    <span class="refresh-text">Refresh</span>
                </button>
            </div>
        </div>
    </div>

    <div class="container">
        <div class="filters">
            <div class="filter-row">
                <div class="filter-group">
                    <label for="search">Search</label>
                    <input type="text" id="search" placeholder="Search song title, artist, or request text...">
                </div>
                <div class="filter-group">
                    <label for="requester">Requester</label>
                    <input type="text" id="requester" placeholder="Filter by requester name...">
                </div>
            </div>
            <div id="filter-results-count" class="filter-results-count" style="display: none;">
                <!-- Will be populated by JavaScript -->
            </div>
        </div>

        <div id="results">
            <!-- Will be populated by JavaScript -->
        </div>

        <div id="no-results" class="no-results" style="display: none;">
            No songs match your current filters.
        </div>
    </div>

    <script>
        {{JS_CONTENT}}
    </script>
</body>
</html>`;
}

// CSS Content
export function loadCSS(): string {
  return `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: Bahnschrift, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    background: #f5f6fa;
    color: #333;
    line-height: 1.6;
}

.header {
    background: linear-gradient(to bottom, rgba(239, 89, 89, 1), rgba(239, 89, 89, 0.8));
    color: white;
    padding: 2rem 0;
    text-align: center;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    -webkit-text-stroke: 6px black;
    paint-order: stroke fill;
}

.header h1 {
    font-size: 2.5rem;
    font-weight: 800;
    margin-bottom: 0.5rem;
}

.stats-summary {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 3rem;
    margin-top: 1rem;
    -webkit-text-stroke: 4px black;
}

.stat-item {
    text-align: center;
}

.stat-number {
    font-size: 2rem;
    font-weight: bold;
    color: #aeaa90;
}

.stat-label {
    font-size: 0.9rem;
    opacity: 0.9;
}

.refresh-section {
    display: flex;
    align-items: center;
}

.refresh-button {
    background: rgba(255, 255, 255, 0.2);
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-radius: 8px;
    color: white;
    padding: 0.5rem 1rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    font-weight: 600;
    transition: all 0.3s ease;
    -webkit-text-stroke: 2px black;
    paint-order: stroke fill;
}

.refresh-button:hover {
    background: rgba(255, 255, 255, 0.3);
    border-color: rgba(255, 255, 255, 0.5);
    transform: translateY(-1px);
}

.refresh-button:active {
    transform: translateY(0);
}

.refresh-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
}

.refresh-button.refreshing .refresh-icon {
    animation: spin 1s linear infinite;
}

.refresh-icon {
    font-size: 1rem;
    display: inline-block;
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
}

.filters {
    background: white;
    padding: 1.5rem;
    border-radius: 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    margin-bottom: 2rem;
}

.filter-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
}

.filter-group {
    display: flex;
    flex-direction: column;
}

.filter-group label {
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: #555;
}

.filter-group input, .filter-group select {
    padding: 0.75rem;
    border: 1px solid #ddd;
    border-radius: 5px;
    font-size: 0.9rem;
    min-width: 200px;
}

.filter-group input:focus, .filter-group select:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
}

.filter-results-count {
    margin-top: 1rem;
    padding: 0.75rem 1rem;
    background: rgba(174, 170, 144, 0.5);
    border: 1px solid rgb(174, 170, 144);
    border-radius: 6px;
    font-size: 0.9rem;
    color: #555;
    text-align: center;
    font-weight: 500;
}

.stream-section {
    background: white;
    border-radius: 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    margin-bottom: 2rem;
    overflow: hidden;
}

.stream-header {
    background: #aeaa90;
    color: white;
    padding: 1.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    -webkit-text-stroke: 6px black;
    paint-order: stroke fill;
}

.stream-date {
    font-size: 1.3rem;
    font-weight: 600;
}

.stream-info {
    font-size: 0.9rem;
    opacity: 0.9;
    -webkit-text-stroke: 2px black;
}

.active-queue {
    background: rgba(239, 89, 89, 0.5);
}

.requests-table {
    width: 100%;
    border-collapse: collapse;
}

.requests-table th {
    background: #f8f9fa;
    padding: 1rem;
    text-align: left;
    font-weight: 600;
    color: #555;
    border-bottom: 2px solid #eee;
}

.requests-table th:first-child {
    width: 60px;
}

.requests-table td {
    padding: 1rem;
    border-bottom: 1px solid #eee;
    vertical-align: top;
}

.requests-table tr:hover {
    background: #f8f9fa;
}

.song-info {
    font-weight: 600;
    color: #333;
    margin-bottom: 0.25rem;
    word-wrap: break-word;
    word-break: break-word;
    overflow-wrap: break-word;
    max-width: 250px;
}

.song-artist {
    font-size: 0.9rem;
    color: #666;
    margin-top: 0.25rem;
    word-wrap: break-word;
    word-break: break-word;
    overflow-wrap: break-word;
    max-width: 250px;
}

.song-duration {
    font-size: 0.8rem;
    color: #888;
    margin-top: 0.25rem;
    font-weight: 500;
}

.request-text {
    font-style: italic;
    color: #555;
    max-width: 300px;
    word-wrap: break-word;
    word-break: break-word;
    overflow-wrap: break-word;
}

.request-link {
    color: #667eea;
    text-decoration: none;
    font-weight: 500;
    border-bottom: 1px dotted #667eea;
    transition: all 0.2s ease;
}

.request-link:hover {
    color: #764ba2;
    border-bottom-color: #764ba2;
    text-decoration: none;
}

.timestamp {
    font-size: 0.85rem;
    color: #666;
    white-space: nowrap;
}

.requester {
    font-weight: 500;
}

.song-number {
    font-weight: 600;
    color: #666;
    text-align: center;
}

.no-results {
    text-align: center;
    padding: 3rem;
    color: #999;
    font-size: 1.1rem;
    background: white;
    border-radius: 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

@media (max-width: 768px) {
    .header h1 { font-size: 2rem; }
    .stats-summary { flex-direction: column; gap: 1rem; }
    .stat-number { font-size: 1.5rem; }
    .container { padding: 1rem; }
    .filter-row { grid-template-columns: 1fr; }
    .filter-group input, .filter-group select { min-width: auto; }
    .requests-table { font-size: 0.8rem; }
    .requests-table th { display: none; }
    .requests-table tr { display: flex; flex-direction: column; }
    .requests-table td { padding: 0.75rem; }
    .request-row:nth-child(odd) { background:rgb(250, 250, 250); }
    .refresh-button {
        font-size: 0.8rem;
        padding: 0.4rem 0.8rem;
        gap: 0.3rem;
    }
}`;
}

// JavaScript Content
export function loadJavaScript(): string {
  return `
function initializeApp(historyData) {
    // Validate data structure
    if (!historyData || !historyData.readyRequests || !historyData.playedSongs) {
        console.error('Invalid data structure received');
        document.getElementById('results').innerHTML = '<div class="error">Error loading data</div>';
        return;
    }

    // Generate the HTML for both sections
    generateResults(historyData);

    // Load filters from URL hash
    loadFiltersFromUrl();

    // Initialize filters (apply loaded values)
    filterResults();
}

function formatDate(dateStr) {
    if (!dateStr) return 'Unknown';

    // Handle different timestamp formats from the database
    let date;

    // Check if it's already in GMT/RFC format (fulfilledAt timestamps)
    if (dateStr.includes('GMT') || dateStr.includes('Z')) {
        // Already properly formatted for JavaScript Date parsing
        date = new Date(dateStr);
    } else {
        // Simple datetime format (createdAt timestamps) - add 'Z' to indicate UTC
        const utcDateStr = dateStr + 'Z';
        date = new Date(utcDateStr);
    }

    if (isNaN(date.getTime())) return 'Invalid Date';

    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
    });
}

function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '';
    const roundedSeconds = Math.round(seconds);
    const minutes = Math.floor(roundedSeconds / 60);
    const remainingSeconds = roundedSeconds % 60;
    return \`\${minutes}:\${remainingSeconds.toString().padStart(2, '0')}\`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}


function formatRequestText(text) {
    if (!text) return '';

    // First escape HTML to prevent XSS
    const escaped = escapeHtml(text);

    // URL regex pattern to match http/https URLs
    const urlRegex = /(https?:\\/\\/[^\\s<>"']+)/gi;

    // Replace URLs with clickable links
    return escaped.replace(urlRegex, (url) => {
        // Remove any trailing punctuation that might not be part of the URL
        const cleanUrl = url.replace(/[.,;!?]+$/, '');
        const punctuation = url.substring(cleanUrl.length);

        return \`<a href="\${cleanUrl}" target="_blank" rel="noopener noreferrer" class="request-link">\${cleanUrl}</a>\${punctuation}\`;
    });
}

function generateResults(data) {
    const resultsContainer = document.getElementById('results');
    let html = '';

    // Generate Active Queue section
    html += generateActiveQueue(data.readyRequests);

    // Generate Song History section
    html += generateStreamSections(data.playedSongs);

    resultsContainer.innerHTML = html;
}

function generateActiveQueue(readyRequests) {
    if (!readyRequests || readyRequests.length === 0) {
        return '';
    }

    const requestRows = readyRequests.map((request, index) => \`
        <tr class="request-row"
            data-search="\${escapeHtml(request.query)} \${escapeHtml(request.title)} \${escapeHtml(request.artist)}"
            data-requester="\${escapeHtml(request.requester)}">
            <td class="timestamp">\${formatDate(request.createdAt)}</td>
            <td class="request-text">\${formatRequestText(request.query)}</td>
            <td>
                \${request.title ? \`
                    <div class="song-info">\${escapeHtml(request.title)}</div>
                    <div class="song-artist">\${escapeHtml(request.artist)}</div>
                    <div class="song-duration">\${request.duration ? formatDuration(request.duration) : ''}</div>
                \` : '<em style="color: #999;">No song data</em>'}
            </td>
            <td class="requester">\${escapeHtml(request.requester) || 'Unknown'}</td>
        </tr>
    \`).join('');

    return \`
        <div class="stream-section">
            <div class="stream-header active-queue">
                <div class="stream-date">Current Requests</div>
                <div class="stream-info" data-original-count="\${readyRequests.length}" data-section-type="queue">
                    \${readyRequests.length} song\${readyRequests.length !== 1 ? 's' : ''} in queue
                </div>
            </div>
            <table class="requests-table">
                <thead>
                    <tr>
                        <th>Requested At</th>
                        <th>Request</th>
                        <th>Song</th>
                        <th>Requester</th>
                    </tr>
                </thead>
                <tbody>
                    \${requestRows}
                </tbody>
            </table>
        </div>
    \`;
}

function generateStreamSections(streamGroups) {
    if (!streamGroups || streamGroups.length === 0) {
        return '<div class="no-results">No played songs found.</div>';
    }

    // Add history header
    let html = \`
    \`;

    // Generate each stream section
    streamGroups.forEach(stream => {
        if (!stream.songs || stream.songs.length === 0) return;

        const streamTitle = stream.streamStartedAt
            ? \`Stream - \${formatDate(stream.streamStartedAt)}\`
            : 'Unknown Stream';

        const streamStatus = stream.streamEndedAt
            ? \`Ended \${formatDate(stream.streamEndedAt)}\`
            : stream.streamStartedAt
                ? 'Stream in progress'
                : '';

        // Check if this is an unknown stream (no chronological meaning)
        const isUnknownStream = !stream.streamStartedAt;

        const songRows = stream.songs.map((song, index) => {
            const songNumberCell = isUnknownStream
                ? ''
                : \`<td class="song-number">#\${song.chronologicalNumber || index + 1}</td>\`;

            // Handle case where song has no corresponding request
            const searchText = [song.query || '', song.title || '', song.artist || ''].join(' ').trim();
            const requestText = song.query
                ? formatRequestText(song.query)
                : '<em style="color: #999;">-</em>';

            return \`
                <tr class="request-row"
                    data-search="\${escapeHtml(searchText)}"
                    data-requester="\${escapeHtml(song.requester || '')}"
                    data-song-number="\${song.chronologicalNumber || index + 1}">
                    \${songNumberCell}
                    <td class="timestamp">\${formatDate(song.startedAt)}</td>
                    <td class="request-text">\${requestText}</td>
                    <td>
                        \${song.title ? \`
                            <div class="song-info">\${escapeHtml(song.title)}</div>
                            <div class="song-artist">\${escapeHtml(song.artist)}</div>
                            <div class="song-duration">\${song.duration ? formatDuration(song.duration) : ''}</div>
                        \` : '<em style="color: #999;">No song data</em>'}
                    </td>
                    <td class="requester">\${escapeHtml(song.requester) || ('Streamer')}</td>
                </tr>
            \`;
        }).join('');

        const tableHeaders = isUnknownStream
            ? '<th>Played At</th><th>Request</th><th>Song</th><th>Requester</th>'
            : '<th>#</th><th>Played At</th><th>Request</th><th>Song</th><th>Requester</th>';

        html += \`
            <div class="stream-section">
                <div class="stream-header">
                    <div class="stream-date">\${streamTitle}</div>
                    <div class="stream-info" data-original-count="\${stream.songs.length}" data-section-type="history">
                        \${stream.songs.length} song\${stream.songs.length !== 1 ? 's' : ''}
                    </div>
                </div>
                <table class="requests-table">
                    <thead>
                        <tr>
                            \${tableHeaders}
                        </tr>
                    </thead>
                    <tbody>
                        \${songRows}
                    </tbody>
                </table>
            </div>
        \`;
    });

    return html;
}

function updateUrlHash() {
    const searchTerm = document.getElementById('search').value;
    const requesterFilter = document.getElementById('requester').value;

    const params = new URLSearchParams();
    if (searchTerm) params.set('search', searchTerm);
    if (requesterFilter) params.set('requester', requesterFilter);

    const hash = params.toString();
    const newUrl = window.location.pathname + window.location.search + (hash ? '#' + hash : '');

    // Use replaceState to avoid polluting browser history
    history.replaceState(null, '', newUrl);
}

function loadFiltersFromUrl() {
    const hash = window.location.hash.substring(1); // Remove the '#'
    if (!hash) return;

    const params = new URLSearchParams(hash);
    const search = params.get('search');
    const requester = params.get('requester');

    if (search) {
        document.getElementById('search').value = search;
    }
    if (requester) {
        document.getElementById('requester').value = requester;
    }
}

function filterResults() {
    const searchTerm = document.getElementById('search').value.toLowerCase();
    const requesterFilter = document.getElementById('requester').value.toLowerCase();
    const hasFilters = searchTerm || requesterFilter;

    const allRows = document.querySelectorAll('.request-row');
    let totalVisibleCount = 0;

    allRows.forEach(row => {
        const searchData = (row.dataset.search || '').toLowerCase();
        const requesterData = (row.dataset.requester || '').toLowerCase();

        const matchesSearch = !searchTerm || searchData.includes(searchTerm);
        const matchesRequester = !requesterFilter || requesterData.includes(requesterFilter);

        const shouldShow = matchesSearch && matchesRequester;

        row.style.display = shouldShow ? '' : 'none';
        if (shouldShow) totalVisibleCount++;
    });

    // Update counts and hide empty stream sections
    document.querySelectorAll('.stream-section').forEach(section => {
        const visibleRowsInSection = section.querySelectorAll('.request-row[style=""], .request-row:not([style])').length;
        const countElement = section.querySelector('.stream-info[data-original-count]');

        if (countElement) {
            const originalCount = parseInt(countElement.dataset.originalCount || '0');
            const sectionType = countElement.dataset.sectionType;

            if (hasFilters) {
                // Show filtered count vs original count
                if (sectionType === 'queue') {
                    countElement.textContent = \`\${visibleRowsInSection} of \${originalCount} song\${originalCount !== 1 ? 's' : ''} in queue\`;
                } else {
                    countElement.textContent = \`\${visibleRowsInSection} of \${originalCount} song\${originalCount !== 1 ? 's' : ''}\`;
                }
            } else {
                // Show original count
                if (sectionType === 'queue') {
                    countElement.textContent = \`\${originalCount} song\${originalCount !== 1 ? 's' : ''} in queue\`;
                } else {
                    countElement.textContent = \`\${originalCount} song\${originalCount !== 1 ? 's' : ''}\`;
                }
            }
        }

        section.style.display = visibleRowsInSection > 0 ? '' : 'none';
    });

    // Show/hide no results message
    document.getElementById('no-results').style.display = totalVisibleCount === 0 ? 'block' : 'none';
    document.getElementById('results').style.display = totalVisibleCount === 0 ? 'none' : 'block';

    // Update filter results count display
    const filterCountElement = document.getElementById('filter-results-count');
    if (hasFilters) {
        filterCountElement.textContent = \`\${totalVisibleCount} total song\${totalVisibleCount !== 1 ? 's' : ''} match these filters\`;
        filterCountElement.style.display = 'block';
    } else {
        filterCountElement.style.display = 'none';
    }

    // Update URL hash with current filters
    updateUrlHash();
}

// Set up event listeners
document.getElementById('search').addEventListener('input', filterResults);
document.getElementById('requester').addEventListener('input', filterResults);

// Listen for hash changes (back/forward navigation or manual URL changes)
window.addEventListener('hashchange', function() {
    loadFiltersFromUrl();
    filterResults();
});

// Fetch data from API
async function fetchHistoryData() {
    try {
        const response = await fetch('/api/requests');
        if (!response.ok) {
            throw new Error(\`HTTP error! status: \${response.status}\`);
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching history data:', error);
        throw error;
    }
}

// Show loading state
function showLoadingState() {
    document.getElementById('results').innerHTML = \`
        <div style="text-align: center; padding: 3rem; color: #666;">
            <div style="font-size: 1.2rem; margin-bottom: 1rem;">Loading song history...</div>
            <div style="width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #667eea; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto;"></div>
        </div>
        <style>
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        </style>
    \`;
}

// Update header counts
function updateHeaderCounts(readyCount, playedCount) {
    const readyCountElement = document.querySelector('.stats-summary .stat-item:nth-child(1) .stat-number');
    const playedCountElement = document.querySelector('.stats-summary .stat-item:nth-child(2) .stat-number');

    if (readyCountElement) readyCountElement.textContent = readyCount;
    if (playedCountElement) playedCountElement.textContent = playedCount;
}

// Refresh data function
async function refreshData() {
    const refreshBtn = document.getElementById('refresh-btn');
    const refreshIcon = refreshBtn.querySelector('.refresh-icon');
    const refreshText = refreshBtn.querySelector('.refresh-text');

    try {
        // Set refreshing state
        refreshBtn.disabled = true;
        refreshBtn.classList.add('refreshing');
        refreshText.textContent = 'Refreshing...';

        // Fetch new data
        const historyData = await fetchHistoryData();

        // Update header counts
        const readyCount = historyData.readyRequests.length;
        const playedCount = historyData.playedSongs.reduce(
            (total, stream) => total + stream.songs.length,
            0
        );
        updateHeaderCounts(readyCount, playedCount);

        // Regenerate the results
        generateResults(historyData);

        // Reapply current filters
        filterResults();

        // Show success feedback briefly
        refreshText.textContent = 'Updated!';
        setTimeout(() => {
            refreshText.textContent = 'Refresh';
        }, 1000);

    } catch (error) {
        console.error('Failed to refresh data:', error);

        // Show error feedback
        refreshText.textContent = 'Error';
        setTimeout(() => {
            refreshText.textContent = 'Refresh';
        }, 2000);
    } finally {
        // Reset button state
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('refreshing');
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', async function() {
    try {
        showLoadingState();

        const historyData = await fetchHistoryData();

        // Update header counts
        const readyCount = historyData.readyRequests.length;
        const playedCount = historyData.playedSongs.reduce(
            (total, stream) => total + stream.songs.length,
            0
        );
        updateHeaderCounts(readyCount, playedCount);

        // Initialize the app with fetched data
        initializeApp(historyData);

        // Apply any filters from URL hash that were loaded before data arrived
        if (window.location.hash) {
            loadFiltersFromUrl();
            filterResults();
        }
    } catch (error) {
        console.error('Failed to load history data:', error);
        document.getElementById('results').innerHTML = \`
            <div style="text-align: center; padding: 3rem; color: #e74c3c;">
                <div style="font-size: 1.2rem; margin-bottom: 1rem;">Failed to load song history</div>
                <div style="color: #666; margin-bottom: 1rem;">Please try refreshing the page</div>
                <button onclick="location.reload()" style="padding: 0.5rem 1rem; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    Refresh Page
                </button>
            </div>
        \`;
    }
});
`;

}
