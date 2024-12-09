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

async function fetchGlobalProperties() {
  const response = await fetch('https://api.steemit.com', {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'condenser_api.get_dynamic_global_properties',
      params: [],
      id: 1
    })
  });
  const data = await response.json();
  return data.result.last_irreversible_block_num;
}

async function fetchBlockOperations(blockNum) {
  const response = await fetch('https://api.steemit.com', {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'condenser_api.get_ops_in_block',
      params: [blockNum, false],
      id: 1
    })
  });
  const data = await response.json();
  return data.result;
}

function processOperations(operations) {
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
    let operationsPerSecond = totalOperations / ((blocksCollected + 1) * 3); // Calculate operations per second
    operationsPerSecond = operationsPerSecond.toFixed(2);

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
    
    chrome.runtime.sendMessage(update);
  }

async function checkNewBlock() {
    try {
      const newLastBlock = await fetchGlobalProperties();
  
      // If this is the first fetch, set the next block to check
      if (lastBlock === 0) {
        lastBlock = newLastBlock; // Set lastBlock to the fetched value
        nextBlockToCheck = lastBlock + 1; // Set the next block to check
        console.log(`Initial last irreversible block: ${lastBlock}`);
      } else {
        // Increment the block number to check
        if (nextBlockToCheck > lastBlock) {
          console.log('Waiting for the last irreversible block to catch up...');
          
          // Sleep for 1 second before fetching the last irreversible block again
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          lastBlock = await fetchGlobalProperties(); // Fetch the last irreversible block again
          return; // Wait for the last irreversible block to catch up
        }
  
        // Check the next block
        const operations = await fetchBlockOperations(nextBlockToCheck);
        const { totalOperations, operationsPerSecond } = processOperations(operations); // Call processOperations with operations
        
        // Update lastBlock only if new block is processed
        lastBlock = nextBlockToCheck; 
        blocksCollected++;
        nextBlockToCheck++; // Increment the block number to check for the next iteration
        broadcastUpdate(totalOperations, operationsPerSecond); // Pass the metrics to broadcastUpdate
      }
    } catch (error) {
      console.warn('Error fetching block data:', error);
    }
  }

async function retryFetchBlock(expectedBlock) {
  for (let i = 0; i < maxRetries; i++) {
    console.log(`Retrying to fetch block ${expectedBlock}... Attempt ${i + 1}`);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second

    const newLastBlock = await fetchGlobalProperties();
    
    if (newLastBlock > lastBlock) {
      const operations = await fetchBlockOperations(newLastBlock);
      processOperations(operations);
      
      lastBlock = newLastBlock; // Update lastBlock only if new block is processed
      blocksCollected++;
      retryCount = 0; // Reset retry count on successful fetch
      broadcastUpdate();
      return; // Exit the retry loop
    }
  }
  console.warn('Max retries reached. No new block found.');
}

function reset() {
  blocksCollected = 0;
  totalTransactions = {};
  currentBlock = {};
  broadcastUpdate();
  totalOperations = 0;
}

// Start monitoring
setInterval(checkNewBlock, 1500);

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
  }
});