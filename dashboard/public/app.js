// Global state
let lastAssetsData = null;
let positionModal;
let accountModal;
let assetModal;

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    positionModal = new bootstrap.Modal(document.getElementById('positionModal'));
    accountModal = new bootstrap.Modal(document.getElementById('accountModal'));
    assetModal = new bootstrap.Modal(document.getElementById('assetModal'));
    
    fetchAssets();
});

// Fetch data
async function fetchAssets() {
    try {
        const response = await fetch('/api/assets');
        lastAssetsData = await response.json();
        renderAll();
    } catch (error) {
        console.error('Error fetching assets:', error);
        showAlert('Error fetching assets', 'danger');
    }
}

function renderAll() {
    if (!lastAssetsData) return;
    renderPositions(lastAssetsData.accounts);
    renderAccounts(lastAssetsData.accounts);
    renderAssets(lastAssetsData.real_estate, lastAssetsData.vehicles);
}

function renderPositions(accounts) {
    const tbody = document.querySelector('#positions-table tbody');
    tbody.innerHTML = '';
    
    const investmentAccounts = accounts.filter(a => a.category === 'investment' || !a.category);
    
    investmentAccounts.forEach(acc => {
        // Stocks
        acc.holdings.stocks.forEach(pos => {
            addPositionRow(tbody, pos, acc, 'stock');
        });
        // Bonds
        acc.holdings.bonds.forEach(pos => {
            addPositionRow(tbody, pos, acc, 'bond');
        });
    });
}

function addPositionRow(tbody, pos, acc, type) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>${pos.symbol}</td>
        <td>${pos.type || type}</td>
        <td>${pos.quantity}</td>
        <td>${formatNumber(pos.cost_basis || 0)}</td>
        <td>
            <button class="btn btn-sm btn-secondary" onclick='openPositionModal("edit", ${JSON.stringify({...pos, account_id: acc.id})})'>Edit</button>
            <button class="btn btn-sm btn-danger" onclick="deletePosition(${pos.id})">Delete</button>
        </td>
    `;
    tbody.appendChild(tr);
}

function renderAccounts(accounts) {
    const tbody = document.querySelector('#accounts-table tbody');
    tbody.innerHTML = '';
    
    accounts.forEach(acc => {
        const tr = document.createElement('tr');
        let balance = 0;
        if (acc.holdings.cash) balance += acc.holdings.cash.value;
        // Add other holdings value if needed, but usually balance is cash for bank accounts
        // For investment accounts, we might want to show total value
        
        tr.innerHTML = `
            <td>${acc.name}</td>
            <td>${acc.type}</td>
            <td>${formatNumber(balance)}</td>
            <td>
                <button class="btn btn-sm btn-secondary" onclick='openAccountModal("edit", ${JSON.stringify(acc)})'>Edit</button>
                <button class="btn btn-sm btn-danger" onclick="deleteAccount(${acc.id})">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderAssets(realEstate, vehicles) {
    const tbody = document.querySelector('#assets-table tbody');
    tbody.innerHTML = '';
    
    const assets = [
        ...(realEstate || []).map(a => ({...a, type: 'real_estate'})),
        ...(vehicles || []).map(a => ({...a, type: 'vehicle'}))
    ];
    
    assets.forEach(asset => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${asset.description || asset.name}</td>
            <td>${asset.type}</td>
            <td>${formatNumber(asset.value)}</td>
            <td>
                <button class="btn btn-sm btn-secondary" onclick='openAssetModal("edit", ${JSON.stringify(asset)})'>Edit</button>
                <button class="btn btn-sm btn-danger" onclick="deleteAsset(${asset.id}, "${asset.type}")'>Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Modal Functions
window.openPositionModal = function(mode, data) {
    const form = document.getElementById('position-form');
    form.reset();
    document.getElementById('position-id').value = '';
    
    // Populate Account Dropdown
    const accountSelect = document.getElementById('position-account');
    accountSelect.innerHTML = '';
    if (lastAssetsData && lastAssetsData.accounts) {
        lastAssetsData.accounts.forEach(acc => {
            const option = document.createElement('option');
            option.value = acc.id;
            option.textContent = acc.name;
            accountSelect.appendChild(option);
        });
    }
    
    if (mode === 'edit' && data) {
        document.getElementById('positionModalLabel').innerText = 'Edit Position';
        document.getElementById('position-id').value = data.id;
        document.getElementById('position-account').value = data.account_id;
        document.getElementById('position-symbol').value = data.symbol;
        document.getElementById('position-type').value = data.type;
        document.getElementById('position-shares').value = data.quantity;
        document.getElementById('position-cost').value = data.cost_basis || 0;
    } else {
        document.getElementById('positionModalLabel').innerText = 'Add Position';
    }
    
    positionModal.show();
};

window.openAccountModal = function(mode, data) {
    const form = document.getElementById('account-form');
    form.reset();
    document.getElementById('account-id').value = '';
    
    if (mode === 'edit' && data) {
        document.getElementById('accountModalLabel').innerText = 'Edit Account';
        document.getElementById('account-id').value = data.id;
        document.getElementById('account-name').value = data.name;
        document.getElementById('account-type').value = data.type;
        document.getElementById('account-balance').value = data.holdings?.cash?.value || 0;
    } else {
        document.getElementById('accountModalLabel').innerText = 'Add Account';
    }
    
    accountModal.show();
};

window.openAssetModal = function(mode, data) {
    const form = document.getElementById('asset-form');
    form.reset();
    document.getElementById('asset-id').value = '';
    
    if (mode === 'edit' && data) {
        document.getElementById('assetModalLabel').innerText = 'Edit Asset';
        document.getElementById('asset-id').value = data.id;
        document.getElementById('asset-name').value = data.description || data.name;
        document.getElementById('asset-type').value = data.type;
        document.getElementById('asset-value').value = data.value;
    } else {
        document.getElementById('assetModalLabel').innerText = 'Add Asset';
    }
    
    assetModal.show();
};

// Form Submissions
document.getElementById('position-form').onsubmit = async function(e) {
    e.preventDefault();
    const id = document.getElementById('position-id').value;
    const body = {
        account_id: document.getElementById('position-account').value,
        symbol: document.getElementById('position-symbol').value,
        type: document.getElementById('position-type').value,
        quantity: parseFloat(document.getElementById('position-shares').value),
        cost_basis: parseFloat(document.getElementById('position-cost').value),
        currency: 'USD'
    };
    
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/positions/${id}` : '/api/positions';
    
    try {
        await axios({ method, url, data: body });
        positionModal.hide();
        fetchAssets();
        showAlert('Position saved successfully', 'success');
    } catch (error) {
        console.error('Error saving position:', error);
        showAlert('Error saving position', 'danger');
    }
};

document.getElementById('account-form').onsubmit = async function(e) {
    e.preventDefault();
    const id = document.getElementById('account-id').value;
    const body = {
        name: document.getElementById('account-name').value,
        type: document.getElementById('account-type').value,
        // Balance is usually handled via cash position, but API might accept it
        balance: parseFloat(document.getElementById('account-balance').value)
    };
    
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/accounts/${id}` : '/api/accounts';
    
    try {
        await axios({ method, url, data: body });
        accountModal.hide();
        fetchAssets();
        showAlert('Account saved successfully', 'success');
    } catch (error) {
        console.error('Error saving account:', error);
        showAlert('Error saving account', 'danger');
    }
};

document.getElementById('asset-form').onsubmit = async function(e) {
    e.preventDefault();
    const id = document.getElementById('asset-id').value;
    const body = {
        name: document.getElementById('asset-name').value,
        type: document.getElementById('asset-type').value,
        value: parseFloat(document.getElementById('asset-value').value),
        currency: 'USD'
    };
    
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/fixed_assets/${id}` : '/api/fixed_assets';
    
    try {
        await axios({ method, url, data: body });
        assetModal.hide();
        fetchAssets();
        showAlert('Asset saved successfully', 'success');
    } catch (error) {
        console.error('Error saving asset:', error);
        showAlert('Error saving asset', 'danger');
    }
};

// Delete functions
window.deletePosition = async function(id) {
    if (!confirm('Are you sure you want to delete this position?')) return;
    try {
        await axios.delete(`/api/positions/${id}`);
        fetchAssets();
        showAlert('Position deleted', 'success');
    } catch (error) {
        console.error('Error deleting position:', error);
        showAlert('Error deleting position', 'danger');
    }
};

window.deleteAccount = async function(id) {
    if (!confirm('Are you sure you want to delete this account?')) return;
    try {
        await axios.delete(`/api/accounts/${id}`);
        fetchAssets();
        showAlert('Account deleted', 'success');
    } catch (error) {
        console.error('Error deleting account:', error);
        showAlert('Error deleting account', 'danger');
    }
};

window.deleteAsset = async function(id) {
    if (!confirm('Are you sure you want to delete this asset?')) return;
    try {
        await axios.delete(`/api/fixed_assets/${id}`);
        fetchAssets();
        showAlert('Asset deleted', 'success');
    } catch (error) {
        console.error('Error deleting asset:', error);
        showAlert('Error deleting asset', 'danger');
    }
};

// Helpers
function formatNumber(num) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
}

function showAlert(message, type) {
    const alerts = document.getElementById('alerts');
    const alert = document.createElement('div');
    alert.className = `alert alert-${type} alert-dismissible fade show`;
    alert.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    alerts.appendChild(alert);
    setTimeout(() => alert.remove(), 5000);
}
