let lastBlock = 0;
let blocksCollected = 0;
let totalTransactions = {};
let currentBlock = {};
let lastBlockTime = '';
let witness = '';
let retryCount = 0; // To keep track of retries
const maxRetries = 10; // Maximum number of retries
let nextBlockToCheck = 0; // Variable to track the next block to check
let totalOperations = 0; // Variable to track total operations
let isSaving = false; // Lock to prevent multiple saves
let isUpdating = false; // Lock to prevent multiple updates
let apiUrl = "https://api.moecki.online"; // Default API URL
let isPaused = true; // Track the pause state (start paused to prevent runaway collection)


chrome.action.onClicked.addListener(tab => {
    chrome.tabs.create({ url: "popup/popup.html" });
});

async function fetchGlobalProperties() {
    const response = await fetch(apiUrl, {
        method: 'POST',
        body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'condenser_api.get_dynamic_global_properties',
            params: [],
            id: 1
        })
    });
    const data = await response.json();
    return data.result;
}

function getLastIrreversibleBlockNum(globalProperties) {
    return globalProperties.last_irreversible_block_num;
}

async function fetchBlockOperations(blockNum) {
    const response = await fetch(apiUrl, {
        method: 'POST',
        body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'condenser_api.get_ops_in_block',
            params: [blockNum, false],
            id: 1
        }),
        headers: {
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        console.warn('Error fetching block operations:', response.statusText);
        return []; // Return an empty array on error
    }

    const data = await response.json();
    return data.result;
}

function processOperations(operations) {
    if (!operations) {
        console.warn('No operations to process');
        return { totalOperations, operationsPerSecond: 0 };
    }

    currentBlock = {};

    operations.forEach(op => {
        const type = op.op[0];
        currentBlock[type] = (currentBlock[type] || 0) + 1;
        totalTransactions[type] = (totalTransactions[type] || 0) + 1;
    });

    // Initialize variables to store the producer reward information
    lastBlockTime = '';
    witness = '';

    // Find the first operation of type "producer_reward"
    const producerRewardOp = operations.find(op => op.op[0] === "producer_reward");

    if (producerRewardOp) {
        lastBlockTime = producerRewardOp.timestamp; // Get the timestamp from the operation
        witness = producerRewardOp.op[1].producer || witness; // Get the producer from the operation
    }

    // Update total operations count
    totalOperations += operations.length;

    // Calculate operations per second
    blocksCollected++;
    let operationsPerSecond = totalOperations / (blocksCollected * 3); // Calculate operations per second
    operationsPerSecond = operationsPerSecond.toFixed(2);
    // console.log(`Operations: ${operations.length}, total: ${totalOperations}, ops/sec: ${operationsPerSecond}, blocks: ${blocksCollected}`);

    // Return the total operations and operations per second
    return { totalOperations, operationsPerSecond };
}

function broadcastUpdate(totalOperations, operationsPerSecond) {
    const update = {
        type: 'update',
        currentBlock, // This should be the latest block's transaction counts
        totalTransactions, // This should be the total transaction counts
        info: {
            lastBlock,
            blocksCollected,
            lastBlockTime,
            witness,
            totalOperations, // Include total operations
            operationsPerSecond // Include operations per second
        }
    };
    chrome.runtime.sendMessage(update, response => {
        if (chrome.runtime.lastError) {
            // console.error('Error sending message:', chrome.runtime.lastError);
        } else {
            // console.log('Message sent successfully:', response);
        }
    });
}

async function fetchWithRetry(blockNum, maxRetries = 15) {
    let attempt = 0;
    let delay = 500; // Start with a 500ms delay

    while (attempt < maxRetries) {
        try {
            const operations = await fetchBlockOperations(blockNum);
            if (operations.length === 0) {
                attempt++;
                console.warn(`Attempt ${attempt} to fetch block ${blockNum} returned empty result:`, error);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Double the delay for the next attempt
                continue;
            }
            return operations; // Return the operations if successful
        } catch (error) {
            attempt++;
            console.warn(`Attempt ${attempt} to fetch block ${blockNum} failed:`, error);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2; // Double the delay for the next attempt
        }
    }

    console.error(`Failed to fetch block ${blockNum} after ${maxRetries} attempts.`);
    return []; // Return an empty array or handle the failure gracefully
}

// Usage in your checkNewBlock function
// Update checkNewBlocks to respect the pause state
async function checkNewBlocks() {
    if (isPaused) {
        return; // Skip checking new blocks if paused
    }

    if (isSaving || isUpdating) {
        return; // Prevent checking new blocks if a save or reset is in progress
    }
    isUpdating = true;

    await retrieveData();

    try {
        // If this is the first fetch, set the next block to check
        if (lastBlock === 0) {
            const globalProperties = await fetchGlobalProperties();
            const newLastBlock = getLastIrreversibleBlockNum(globalProperties);
            lastBlock = newLastBlock;
            nextBlockToCheck = lastBlock + 1;
            // console.log(`Initial last irreversible block: ${lastBlock}`);
            isUpdating = false;
            // Save data at the end of the function
            await saveData();
            return;
        }

        const globalProperties = await fetchGlobalProperties();
        lastBlock = getLastIrreversibleBlockNum(globalProperties);
        // Continue checking blocks until we catch up
        while (nextBlockToCheck <= lastBlock) {
            // Check the next block
            const operations = await fetchWithRetry(nextBlockToCheck);
            if (operations) {
                const { totalOperations, operationsPerSecond } = processOperations(operations);

                // Update lastBlock only if new block is processed
                lastBlock = nextBlockToCheck;
                nextBlockToCheck++;
                broadcastUpdate(totalOperations, operationsPerSecond);
            } else {
                break;
            }
            const globalProperties = await fetchGlobalProperties();
            lastBlock = getLastIrreversibleBlockNum(globalProperties);
        }
    } catch (error) {
        console.warn('Error fetching block data:', error);
    }

    console.log(`Waiting for the last irreversible block to catch up: ${nextBlockToCheck} > ${lastBlock}`);
    await saveData();
    isUpdating = false;
}

checkNewBlocks();
// Call checkNewBlock periodically
setInterval(checkNewBlocks, 1500); // Check every 1.5 seconds

async function saveData() {
    const dataToSave = {
        lastBlock,
        blocksCollected,
        totalTransactions,
        currentBlock,
        lastBlockTime,
        witness,
        totalOperations,
        nextBlockToCheck
    };
    await chrome.storage.local.set({ blockchainData: dataToSave });
    // console.log('Data saved to storage:', dataToSave);
}

async function retrieveData() {
    const result = await chrome.storage.local.get('blockchainData');
    if (result.blockchainData) {
        let { lastBlock, blocksCollected, totalTransactions, currentBlock, lastBlockTime, witness, totalOperations, nextBlockToCheck } = result.blockchainData;
        // Restore the values
        lastBlock = lastBlock;
        blocksCollected = blocksCollected;
        totalTransactions = totalTransactions;
        currentBlock = currentBlock;
        lastBlockTime = lastBlockTime;
        witness = witness;
        totalOperations = totalOperations;
        nextBlockToCheck = nextBlockToCheck;
        // console.log('Data retrieved from storage:', result.blockchainData);
    } else {
        // console.log('No data found in storage.');
    }
}

async function reset() {
    if (isSaving || isUpdating) {
        console.warn('Cannot reset while saving or updating.');
        return; // Prevent reset if a save or update is in progress
    }    
    isSaving = true;

    // Reset the state
    blocksCollected = 0;
    totalTransactions = {};
    currentBlock = {};
    totalOperations = 0;
    lastBlock = 0;
    lastBlockTime = '';
    witness = '';

    try {
        await saveData(); // Wait for the data to be saved

        // Broadcast the update after saving
        broadcastUpdate();
        
        // Notify the popup to refresh data
        chrome.runtime.sendMessage({ type: 'dataUpdated' }, response => {
            if (chrome.runtime.lastError) {
                // console.error('Error sending message:', chrome.runtime.lastError);
            } else {
                // console.log('Message sent successfully:', response);
            }
        });
    } catch (error) {
        console.error('Error saving data after reset:', error);
    } finally {
        isSaving = false; // Release the lock
    }
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'getData') {
        sendResponse({
            currentBlock,
            totalTransactions,
            info: {
                lastBlock,
                blocksCollected,
                lastBlockTime,
                witness
            }
        });
    } else if (message.type === 'reset') {
        reset();
    } else if (message.type === 'setApi') {
        apiUrl = message.apiUrl; // Update the API URL based on user selection
        // console.log(`API URL set to: ${apiUrl}`);
    } else if (message.type === 'togglePauseState') {
        isPaused = message.isPaused; // Update the pause state
        // console.log(`Data collection is now ${isPaused ? 'paused' : 'running'}.`);
    }
});


/*
 * Avoid runaway data collection.  The user must start collection manually.
 */
// Listen for the extension being installed or updated
chrome.runtime.onInstalled.addListener(() => {
    // Set isPaused to true when the extension is reloaded
    isPaused = true;
    chrome.storage.local.set({ isPaused: isPaused });
});

chrome.runtime.onStartup.addListener(() => {
    // Set isPaused to true when the browser restarts
    isPaused = true;
    chrome.storage.local.set({ isPaused: isPaused });
});