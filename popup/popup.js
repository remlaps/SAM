let currentBlockChart;
let totalTransactionsChart;
let isPaused = true; // Initial state is paused (to prevent runaway if forgotten)

function initCharts() {
    const currentCtx = document.getElementById('current-block-chart').getContext('2d');
    const totalCtx = document.getElementById('total-transactions-chart').getContext('2d');

    const chartConfig = {
        type: 'pie',
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        font: {
                            size: 11
                        }
                    }
                }
            }
        }
    };

    // Initialize charts with empty data
    currentBlockChart = new Chart(currentCtx, { ...chartConfig, data: { labels: [], datasets: [] } });
    totalTransactionsChart = new Chart(totalCtx, { ...chartConfig, data: { labels: [], datasets: [] } });
}

function updateCharts(blockData, totalData) {
    const chartData = (data) => {
        const labels = Object.keys(data);
        const values = Object.values(data);

        return {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: labels.map((_, i) =>
                    `hsl(${(i * 360) / labels.length}, 70%, 50%)`)
            }]
        };
    };

    // Create new data objects for each chart to avoid reference issues
    currentBlockChart.data = chartData(blockData); // This should be the latest block's data
    totalTransactionsChart.data = chartData(totalData); // This should be the total transactions data

    // Update the charts
    currentBlockChart.update();
    totalTransactionsChart.update();
}

function updateInfo(info) {
    document.getElementById('last-block').textContent = info.lastBlock;
    document.getElementById('blocks-collected').textContent = info.blocksCollected;
    document.getElementById('last-block-time').textContent = info.lastBlockTime;
    document.getElementById('witness').textContent = info.witness;
    document.getElementById('total-operations').textContent = info.totalOperations || 0;
    document.getElementById('operations-per-second').textContent = info.operationsPerSecond || 0;
}

document.addEventListener('DOMContentLoaded', () => {
    initCharts();

    // Check local storage for the saved pause state
    chrome.storage.local.get(['isPaused'], (result) => {
        // If isPaused is not found, default to true
        isPaused = result.isPaused !== undefined ? result.isPaused : isPaused;
        document.getElementById('toggle-button').textContent = isPaused ? '(Re)start' : 'Pause';
    });

    // Get initial data
    chrome.runtime.sendMessage({ type: 'getData' }, response => {
        updateCharts(response.currentBlock, response.totalTransactions);
        updateInfo(response.info);
    });

    // Listen for updates
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'update') {
            const blockData = message.currentBlock;
            const totalData = message.totalTransactions;
    
            updateCharts(blockData, totalData);
            updateInfo(message.info);
        } else if (message.type === 'dataUpdated') {
            // Fetch the updated data after reset
            chrome.runtime.sendMessage({ type: 'getData' }, response => {
                updateCharts(response.currentBlock, response.totalTransactions);
                updateInfo(response.info);
            });
        } 
    });

    // Handle API selection
    document.getElementById('api-select').addEventListener('change', (event) => {
        const selectedApi = event.target.value;
        chrome.runtime.sendMessage({ type: 'setApi', apiUrl: selectedApi });
    });

    document.getElementById('reset-button').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'reset' });
    });

    document.getElementById('toggle-button').addEventListener('click', () => {
        isPaused = !isPaused; // Toggle the pause state
        chrome.storage.local.set({ isPaused: isPaused });
        chrome.runtime.sendMessage({ type: 'togglePauseState', isPaused });
        document.getElementById('toggle-button').textContent = isPaused ? 'Restart' : 'Pause'; // Update button text
    });
});