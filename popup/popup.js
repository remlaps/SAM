let currentBlockChart;
let totalTransactionsChart;

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

    // Get initial data
    chrome.runtime.sendMessage({ type: 'getData' }, response => {
        updateCharts(response.currentBlock, response.totalTransactions);
        updateInfo(response.info);
    });

    // Listen for updates
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'update') {
            // Ensure that the data is being assigned correctly
            const blockData = message.currentBlock; // This should be the latest block's data
            const totalData = message.totalTransactions; // This should be the total transactions data

            updateCharts(blockData, totalData);
            updateInfo(message.info);
        }
    });

    document.getElementById('reset-button').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'reset' });
    });
});