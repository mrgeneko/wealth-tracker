// Example Frontend Integration for "Add Position" Modal
// This shows how to use the metadata API endpoints

/**
 * Autocomplete Component
 * Triggers as user types in symbol field
 */
async function handleSymbolInput(inputValue) {
    if (inputValue.length < 1) return;

    // Debounce the API call
    clearTimeout(window.autocompleteTimeout);

    window.autocompleteTimeout = setTimeout(async () => {
        const response = await fetch(`/api/metadata/autocomplete?q=${inputValue}`);
        const data = await response.json();

        // Display autocomplete results
        displayAutocompleteResults(data.results);
    }, 300); // 300ms debounce
}

/**
 * Symbol Selection Handler
 * When user selects a symbol from autocomplete or types it manually
 */
async function handleSymbolSelected(symbol) {
    // Show loading state
    showLoadingState('Fetching security details...');

    try {
        // Prefetch metadata (blocks for 1-2 seconds)
        const response = await fetch('/api/metadata/prefetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol })
        });

        const data = await response.json();

        if (data.metadata) {
            // Populate form with metadata
            populateFormFields({
                symbol: data.metadata.symbol,
                name: data.metadata.long_name || data.metadata.short_name,
                type: data.metadata.quote_type,
                exchange: data.metadata.exchange,
                currency: data.metadata.currency
            });

            // Show success message
            showSuccessMessage(
                data.cached
                    ? 'Security details loaded'
                    : 'Security details fetched from Yahoo Finance'
            );
        } else {
            // Symbol not found in Yahoo Finance
            showWarningMessage(
                `Symbol ${symbol} not found in Yahoo Finance. You can still add this position, but it won't have enriched metadata.`
            );
        }
    } catch (error) {
        showErrorMessage('Failed to fetch security details');
    } finally {
        hideLoadingState();
    }
}

/**
 * Import Positions Handler
 * Processes CSV/JSON import and prefetches metadata for all symbols
 */
async function handleImportPositions(positions) {
    // Extract unique symbols
    const symbols = [...new Set(positions.map(p => p.symbol))];

    // Show progress modal
    showProgressModal(`Checking metadata for ${symbols.length} symbols...`);

    try {
        // Batch prefetch
        const response = await fetch('/api/metadata/batch-prefetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbols })
        });

        const data = await response.json();

        // Show summary
        showImportSummary({
            total: data.summary.total,
            cached: data.summary.cached,
            fetched: data.summary.fetched,
            failed: data.summary.failed,
            failedSymbols: data.results
                .filter(r => r.status === 'failed')
                .map(r => r.symbol)
        });

        // Now insert positions
        await insertPositions(positions);

    } catch (error) {
        showErrorMessage('Import failed: ' + error.message);
    } finally {
        hideProgressModal();
    }
}

/**
 * Example: Add Position Form Submission
 */
async function submitAddPosition(formData) {
    try {
        // Insert position
        const response = await fetch('/api/positions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accountId: formData.accountId,
                symbol: formData.symbol,
                quantity: formData.quantity,
                type: formData.type,
                metadata_symbol: formData.symbol // Link to metadata
            })
        });

        if (response.ok) {
            showSuccessMessage('Position added successfully');
            refreshPortfolio();
        }
    } catch (error) {
        showErrorMessage('Failed to add position');
    }
}

// UI Helper Functions (implement based on your framework)
function displayAutocompleteResults(results) {
    // Display dropdown with results
    // Format: "AAPL - Apple Inc. (EQUITY)"
}

function populateFormFields(data) {
    // Auto-fill form fields with metadata
}

function showLoadingState(message) {
    // Show spinner/loading indicator
}

function hideLoadingState() {
    // Hide spinner
}

function showSuccessMessage(message) {
    // Toast notification
}

function showWarningMessage(message) {
    // Warning toast
}

function showErrorMessage(message) {
    // Error toast
}

function showProgressModal(message) {
    // Modal with progress bar
}

function hideProgressModal() {
    // Close modal
}

function showImportSummary(summary) {
    // Show import results modal
    console.log(`
    Import Summary:
    - Total symbols: ${summary.total}
    - Already cached: ${summary.cached}
    - Newly fetched: ${summary.fetched}
    - Failed: ${summary.failed}
    ${summary.failed > 0 ? `\nFailed symbols: ${summary.failedSymbols.join(', ')}` : ''}
  `);
}

function refreshPortfolio() {
    // Reload portfolio data
}

async function insertPositions(positions) {
    // Bulk insert positions
}
