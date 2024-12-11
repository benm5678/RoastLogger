// Check if the URL contains the debug parameter
const urlParams = new URLSearchParams(window.location.search);
const debugParam = urlParams.get("debug") === "true";
const isFileProtocol = window.location.protocol === "file:";
const debug = debugParam || isFileProtocol;

const DB_COLLECTION = debug ? "roast_logs_test" : "roast_logs";

class BluetoothRoastLogger {
  constructor(debug = false) {
    this.debug = debug; // Enable debug mode if true
    this.device = null;
    this.server = null;
    this.targetService = null;
    this.writableCharacteristic = null;
    this.enableLogging = false;
    this.logData = [];
    this.loggingInterval = null;
    this.peripheralName = "DSD TECH"; // Target device name
    this.roastStartTime = null;
    this.noSleep = new NoSleep(); // Initialize NoSleep.js
    this.logStartTime = null; // Tracks when logging starts

    this.initChart();
  }

  initChart() {
    // Chart setup
    const ctx = document.getElementById('chart').getContext('2d');
    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'BT',
            data: [],
            borderColor: 'rgba(75, 192, 192, 1)',
            backgroundColor: 'rgba(75, 192, 192, 0.2)',
            fill: false,
            tension: 0.1
          },
          {
            label: 'MET',
            data: [],
            borderColor: 'rgba(255, 99, 132, 1)',
            backgroundColor: 'rgba(255, 99, 132, 0.2)',
            fill: false,
            tension: 0.1
          }
        ]
      },
      options: {
        animation: false,
        scales: {
          x: {
            type: 'time', // Use the time scale
            time: {
                unit: 'second', // Display in seconds
                tooltipFormat: 'mm:ss', // Format for tooltips  
                displayFormats: {
                  second: 'mm:ss'
                }
            },
            ticks: {
              autoSkip: true,
              maxTicksLimit: 10 // Adjust this value to control the number of ticks shown
            },
          },
          y: {
            beginAtZero: false
          }
        }
      }
    });

  }

  isRoasting() {
    return this.isLogging() && this.roastStartTime;
  }

  updateUIState() {
    document.getElementById("connectButton").disabled = this.connected;
    document.getElementById("startButton").disabled = !this.connected || this.isLogging();
    document.getElementById("stopButton").disabled = !this.connected || !this.isLogging() || this.roastStartTime;
    document.getElementById("chargeButton").disabled = !this.connected || !this.isLogging() || this.roastStartTime || !this.getCoffeeName();
    document.getElementById("dropButton").disabled = !this.connected || !this.isLogging() || !this.roastStartTime || this.roastEndTime;
    document.getElementById('coffeeName').disabled = this.isRoasting();
    document.getElementById('coffeeAmount').disabled = this.isRoasting();
    document.getElementById('saveButton').disabled = !this.isRoasting();
    document.getElementById('loadButton').disabled = this.isLogging() || this.isRoasting();
    document.getElementById('pinButton').style.display = (this.isLogging() || this.isRoasting() || !this.loadedRoastData || !this.loadedRoastData.roastEndTime || this.roastDataToMatch) ? 'none' : 'inline-block';
    document.getElementById('unpinButton').style.display = (this.isLogging() || !this.roastDataToMatch) ? 'none' : 'inline-block';
    document.getElementById("roastStartTime").textContent = this.roastStartTime ?
      this.roastStartTime.toLocaleTimeString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
      : "-";
  }

  getCoffeeName() {
    return document.getElementById("coffeeName").value;
  }

  setCoffeeName(name) {
    document.getElementById("coffeeName").value = name;
  }

  getCoffeeBatchNum() {
    return document.getElementById("coffeeBatchNum").value;
  }

  setCoffeeBatchNum(batchNum) {
    document.getElementById("coffeeBatchNum").value = batchNum;
  }

  getCoffeeAmount() {
    return document.getElementById("coffeeAmount").value;
  }

  setCoffeeAmount(amount) {
    document.getElementById("coffeeAmount").value = amount;
  }

  onConnected() {
    if (this.roastStartTime && !this.roastEndTime) {
      // Resume active roast logging
      this.startLogging(true);
    }
  }

  async connect() {
    if (this.debug) {
      console.log("Debug mode enabled: Skipping Bluetooth connection");
      this.connected = true;
      this.updateUIState();
      this.onConnected();
      return true;
    }

    try {
      console.log("Attempting to connect...");

      // Automatically connect to the device with the specified UUID
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [0xFFE0] }] // Filter by service UUID
      });

      this.device.addEventListener('gattserverdisconnected', this.onDisconnected.bind(this));

      this.server = await this.device.gatt.connect();
      console.log(`Connected to ${this.device.name}`);
      this.connectServiceNotifications();


      this.connected = true;
      this.updateUIState(); // Enable buttons after successful connection
      this.onConnected();
      return true;
    } catch (error) {
      console.error("Connection failed:", error);
      this.connected = false;
      this.updateUIState(); // Keep buttons disabled on failure
      return false;
    }
  }

  async connectServiceNotifications() {
    const services = await this.server.getPrimaryServices();
    this.targetService = services[0]; // Assume first service is relevant
    const characteristics = await this.targetService.getCharacteristics();

    for (let characteristic of characteristics) {
      if (characteristic.properties.write || characteristic.properties.writeWithoutResponse) {
        this.writableCharacteristic = characteristic;
        // Set up to receive notifications from this characteristic
        await this.writableCharacteristic.startNotifications();
        this.writableCharacteristic.addEventListener('characteristicvaluechanged', this.handleData.bind(this));
        break;
      }
    }

    if (!this.writableCharacteristic) {
      throw new Error("Writable characteristic not found.");
    }

    console.log(`Writable characteristic found: ${this.writableCharacteristic.uuid}`);
  }

  // Handle disconnection and attempt reconnection
  onDisconnected(event) {
    console.warn("Device disconnected:", event.target.name);
    this.connected = false;
    this.updateUIState();

    // Optional: Automatically try to reconnect after a delay
    setTimeout(async () => {
      console.log("Attempting to reconnect...");
      try {
        if (this.device.gatt.connected) {
          console.log("Already connected");
          return;
        }
        this.server = await this.device.gatt.connect();
        this.connectServiceNotifications();
        console.log(`Reconnected to ${this.device.name}`);
        this.connected = true;
        this.updateUIState();
      } catch (reconnectError) {
        console.error("Reconnection failed:", reconnectError);
      }
    }, 2000); // Retry after 2 seconds
  }

  enableDurationCounter() {
    if (!this.durationInterval) {
      this.durationInterval = setInterval(() => {
        this.updateRoastDuration(); // Update duration every second
      }, 1000);
    }
  }

  resetParams() {
    this.roastStartTime = null;
    this.roastEndTime = null;
    this.logData = [];
  }

  startLogging(resume) {
    if (!resume) {
      if (this.roastStartTime && !confirm("You sure you want to clear collected data?"))
        return;

      this.resetParams();
      getNextBatchNum((nextBatchNum) => {
        this.setCoffeeBatchNum(nextBatchNum);
      });
    }

    if (this.debug) {
      console.log("Debug mode: Generating fake data...");
      this.enableLogging = true;
      this.logStartTime = new Date(); // Set log start time
      this.noSleep.enable();

      this.updateRoastDuration(); // Update duration immediately
      this.enableDurationCounter();

      this.loggingInterval = setInterval(() => {
        if (this.enableLogging) {
          this.generateFakeData();
        }
      }, 1000); // Generate fake data every 2 seconds
    } else {
      if (!this.writableCharacteristic) {
        console.error("Writable characteristic not available");
        return;
      }
      console.log("Starting logging...");
      this.enableLogging = true;
      this.logStartTime = new Date(); // Set log start time
      this.noSleep.enable();

      this.updateRoastDuration(); // Update duration immediately
      this.enableDurationCounter();

      const readCommand = "#001Nrn";
      const data = new TextEncoder().encode(readCommand);

      this.loggingInterval = setInterval(() => {
        if (this.enableLogging) {
          this.writableCharacteristic.writeValueWithoutResponse(data)
            .then(() => console.log("Command sent successfully"))
            .catch(err => console.error("Error writing value:", err));
        }
      }, 1000); // Send the command every second
    }

    this.updateUIState();
  }



  stopLogging() {
    clearInterval(this.loggingInterval);
    this.enableLogging = false;
    this.stopDurationCounter();
    this.updateUIState();
    this.noSleep.disable();
    console.log("Logging stopped");
  }

  isLogging() {
    return this.enableLogging;
  }

  /**
   * Generates and logs fake data for testing.
   */
  generateFakeData() {
    const bt = Math.random() * 300 + 150; // Random BT temperature between 150-450
    const met = Math.random() * 300 + 150; // Random MET temperature between 150-450

    this.processData(bt, met);
  }

  // Handle data received from the device (this is the 'characteristicvaluechanged' event handler)
  handleData(event) {
    const characteristic = event.target;
    const data = characteristic.value;
    this.parseIncomingSensorData(data);
  }

  parseIncomingSensorData(data) {
    const lastResponse = new TextDecoder().decode(data);
    console.log(`Received data: ${lastResponse}`);

    if (lastResponse.length >= 10 && lastResponse !== "Err\r\n") {
      // Parse BT and ET values from the data string
      const btHex = lastResponse.substring(1, 5); // Assuming BT is at positions 1-4
      const etHex = lastResponse.substring(7, 11); // Assuming MET is at positions 7-10

      const bt = parseInt(btHex, 16) / 10;
      const et = parseInt(etHex, 16) / 10;

      // Only log if the values are reasonable
      if (bt < 600 && bt > 0 && et < 600 && et > 0) {
        this.processData(bt, et)
      }
    }
  }

  processData(bt, et) {
    // Log the data
    const logTime = new Date();
    bt = parseInt(bt)
    et = parseInt(et)
    this.logData.push({ logTime, BT: bt, MET: et });

    // Update UI
    document.getElementById("BT").textContent = parseFloat(bt).toFixed(1);
    document.getElementById("ET").textContent = parseFloat(et).toFixed(1);

    // Update chart with new data
    this.updateChart();

    // Alert
    if (this.isInAlarmState()) {
      speakWithVoice(`Temp is ${bt}`);
    }
  }

  isInAlarmState() {
    if (!document.getElementById('enableAlarmCheckbox').checked)
      return false;
    const maxTemp = parseInt(document.getElementById('maxTempInput').value, 10);
    // return last bt recorded in logData
    const lastBT = this.logData.at(-1).BT;
    return lastBT > maxTemp;
  }

  charge() {
    console.log("Roast started");
    this.roastStartTime = this.getLatestLogTime();
    this.updateChart();
    this.updateRoastDuration(); // Update roast duration when roast starts
    this.updateUIState();

    // Update duration every second
    this.enableDurationCounter();
    this.saveRoastData();
  }

  stopDurationCounter() {
    if (this.durationInterval) {
      clearInterval(this.durationInterval); // Ensure the interval is cleared
      this.durationInterval = null; // Reset to null to prevent re-initialization
    }
  }

  drop() {
    console.log("Roast ended");

    // Set the roast end time
    this.roastEndTime = new Date();

    // Stop updating the duration counter
    this.stopDurationCounter();

    // Stop logging
    this.stopLogging();

    // Calculate and display the final roast time
    if (this.roastStartTime && this.roastEndTime) {
      const duration = this.roastEndTime - this.roastStartTime;
      const minutes = Math.floor(duration / 60000);
      const seconds = ((duration % 60000) / 1000).toFixed(0);
      const formattedDuration = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
      document.getElementById("duration").textContent = `${formattedDuration}`;
    } else {
      document.getElementById("duration").textContent = "-";
    }
    this.updateUIState();

    this.saveRoastData();
  }



  updateRoastDuration(manualDuration) {
    const now = new Date();
    let duration = manualDuration || null;

    if (!manualDuration) {
      if (this.roastStartTime) {
        // Duration since roast started
        duration = now - this.roastStartTime;
      } else if (this.logStartTime) {
        // Duration since logging started
        duration = now - this.logStartTime;
      } else {
        document.getElementById("duration").textContent = "-";
        return;
      }
    }

    const minutes = Math.floor(duration / 60000);
    const seconds = ((duration % 60000) / 1000).toFixed(0);
    const formattedDuration = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    document.getElementById("duration").textContent = formattedDuration;
  }

  getLatestLogTime() {
    return new Date(Math.max(...this.logData.map(entry => entry.logTime)));
  }

  updateChart() {
    // Determine the earliest logTime (either filtered data or entire data)
    const earliestTime = this.roastStartTime || Math.min(...this.logData.map(entry => entry.logTime));
    const filteredData = this.logData.filter(entry => entry.logTime >= earliestTime);

    // Load data to match
    if (this.roastDataToMatch) {
      const hasCache = this.roastDataToMatchCache && this.roastDataToMatchCache.coffeeBatchNum === this.roastDataToMatch.coffeeBatchNum;
      if(!hasCache) this.roastDataToMatchCache = { coffeeBatchNum: this.roastDataToMatch.coffeeBatchNum };
      const logDataToMatchCutoff = new Date(this.roastDataToMatch.roastStartTime - (15 * 60 * 1000))  // Load 5min pre-roast data
      const logDataToMatch = this.roastDataToMatch.logData.filter(entry => entry.logTime > logDataToMatchCutoff);
      let earliestTimeToMatch = this.roastStartTime ? this.roastDataToMatch.roastStartTime : null;
      if(!earliestTimeToMatch)
        earliestTimeToMatch = hasCache && this.roastDataToMatchCache.earliestTime ? this.roastDataToMatchCache.earliestTime : (this.roastDataToMatchCache.earliestTime = new Date(Math.min(...logDataToMatch.map(entry => entry.logTime))));
      const didEarliestTimeChange = this.roastDataToMatchCache.previousEarliestTime !== earliestTimeToMatch;
      const filteredDataToMatch = hasCache && !didEarliestTimeChange ? this.roastDataToMatchCache.filteredData : this.roastDataToMatchCache.filteredData = logDataToMatch.filter(entry => entry.logTime >= earliestTimeToMatch);
      
      this.roastDataToMatchCache.previousEarliestTime = earliestTimeToMatch;

      
      // Update chart datasets
      this.chart.data.datasets[2] = {
        label: 'Target BT',
        data: filteredDataToMatch.map(entry => { return { x: new Date(entry.logTime - earliestTimeToMatch).getTime(), y: entry.BT} }),
        borderColor: 'rgba(0, 255, 0, 0.5)', // Light green
        borderWidth: 1,
        borderDash: [5, 5], // Dashed line
        fill: false, // Ensure the line is not filled
        pointRadius: 0 // Hide points
      };

      this.chart.data.datasets[3] = {
        label: 'Target ET',
        data: filteredDataToMatch.map(entry => { return { x: new Date(entry.logTime - earliestTimeToMatch).getTime(), y: entry.MET} }),
        borderColor: 'rgba(255, 0, 0, 0.5)', // Light red
        borderWidth: 1,
        borderDash: [5, 5], // Dashed line
        fill: false, // Ensure the line is not filled
        pointRadius: 0 // Hide points
      };
    } else {
      // No target roast, remove 2, 3 datasets
      this.chart.data.datasets.splice(2, 2);

    }

    // Update bt/et datasets
    this.chart.data.datasets[0].data = filteredData.map(entry => { return { x: new Date(entry.logTime - earliestTime).getTime(), y: entry.BT} });
    this.chart.data.datasets[1].data = filteredData.map(entry => { return { x: new Date(entry.logTime - earliestTime).getTime(), y: entry.MET} });
    this.chart.update();
  }

  targetRoastData(target = true) {
    if (this.loadedRoastData && target) {
      this.roastDataToMatch = this.loadedRoastData;
      this.updateChart();
      roastLogger.updateUIState();
    } else {
      if (this.roastDataToMatch && !target) {
        this.roastDataToMatch = null;
        this.updateChart();
        roastLogger.updateUIState();
      }
    }
  }

  saveRoastData() {
    const db = firebase.firestore();
    const docName = this.roastEndTime ? `roast_${this.roastStartTime.toISOString().replace(/[:.-]/g, '')}` : 'active';

    db.collection(DB_COLLECTION).doc(docName).set({
      roastStartTime: this.roastStartTime ?? null,
      roastEndTime: this.roastEndTime ?? null,
      coffeeBatchNum: this.getCoffeeBatchNum(),
      coffeeName: this.getCoffeeName(),
      coffeeAmount: this.getCoffeeAmount(),
      logData: this.logData,
    }).then(() => {
      console.log(`Saved roast data as '${docName}' in db!`);
    }).catch((error) => {
      showError(`Failed to save roast data to database! | ${error}`);
    });

    if (this.roastEndTime) {
      db.collection(DB_COLLECTION).doc('active').delete()
        .then(() => {
          console.log('Deleted the active roast document.');
        })
        .catch((error) => {
          showError(`Failed to delete the active roast document! | ${error}`);
        });
    }
  }

  loadRoastData(roastData) {
    // Convert timestamps back into Date objects
    if (roastData.logData) {
      roastData.logData = roastData.logData.map(logEntry => {
        return {
          ...logEntry,
          logTime: logEntry.logTime.toDate()  // Convert timestamp to Date object
        };
      });
    } else {
      roastData.logData = [];
    }
    roastData.roastStartTime = roastData.roastStartTime ? roastData.roastStartTime.toDate() : null;
    roastData.roastEndTime = roastData.roastEndTime ? roastData.roastEndTime.toDate() : null;

    // Load info
    this.logData = roastData.logData;
    this.loadedRoastData = roastData;
    this.roastStartTime = roastData.roastStartTime;
    this.roastEndTime = roastData.roastEndTime;
    if (this.roastEndTime) {
      this.updateRoastDuration(this.roastEndTime - this.roastStartTime);
    }
    
    this.setCoffeeBatchNum(roastData.coffeeBatchNum ?? '0');
    this.setCoffeeName(roastData.coffeeName ?? '');
    this.setCoffeeAmount(roastData.coffeeAmount ?? 150);
    this.updateUIState();
    this.updateChart();
  }
}

// Initialize the BluetoothRoastLogger
const roastLogger = new BluetoothRoastLogger(debug);
roastLogger.updateUIState();

// Connect Button Logic
document.getElementById("connectButton").addEventListener("click", async () => {
  await roastLogger.connect();
});

// Start/Stop Logging
document.getElementById("startButton").addEventListener("click", () => {
  roastLogger.startLogging();
});

document.getElementById("stopButton").addEventListener("click", () => {
  roastLogger.stopLogging();
});

// Charge/Drop Buttons
document.getElementById("chargeButton").addEventListener("click", () => {
  roastLogger.charge();
});

document.getElementById("dropButton").addEventListener("click", () => {
  roastLogger.drop();
});

document.getElementById("saveButton").addEventListener("click", () => {
  roastLogger.saveRoastData();
});

document.getElementById('loadButton').addEventListener('click', loadRoastNames);

document.getElementById("pinButton").addEventListener("click", () => {
  roastLogger.targetRoastData();
});

document.getElementById("unpinButton").addEventListener("click", () => {
  roastLogger.targetRoastData(false);
});

// Close popup
document.getElementById('closeRoastSelectionPopup').addEventListener('click', () => {
  document.getElementById('roastSelectionPopup').style.display = 'none';
});

document.getElementById('enableAlarmCheckbox').addEventListener('change', function () {
  const maxTempInput = document.getElementById('maxTempInput');
  maxTempInput.style.display = this.checked ? 'inline-block' : 'none';
  if (this.checked) {
    speakWithVoice(""); // Required to enable on iOS from human click
  }
});

document.getElementById('coffeeName').addEventListener('input', function () {
  roastLogger.updateUIState();
});

function initApp() {
  const db = firebase.firestore();
  var docRef = db.collection(DB_COLLECTION).doc("active");
  docRef.get().then((doc) => {
    if (doc.exists) {
      console.log("Got active roast data:", doc.data());
      roastLogger.loadRoastData(doc.data());
    } else {
      // doc.data() will be undefined in this case
      console.log("No active roast found");
    }
  }).catch((error) => {
    showError(`Failed to load state from database! | ${error}`);
  });
}

let isSpeaking = false;
const voice = getVoice();

function getVoice() {
  const voices = window.speechSynthesis.getVoices();

  // Select a specific voice by name (example: "Google US English")
  const voice = voices.find(v => v.name === "Samantha");
  if (voice) {
    return voice;
  } else {
    // default to first voice
    return voices[0];
  }
}

function loadRoastNames() {
  const db = firebase.firestore();
  const collectionRef = db.collection(DB_COLLECTION);

  collectionRef.where(firebase.firestore.FieldPath.documentId(), '>=', 'roast_')
    .orderBy('roastStartTime', 'desc')
    .limit(20)
    .get()
    .then((querySnapshot) => {
      const roastNamesList = document.getElementById('roastNamesList');
      roastNamesList.innerHTML = ''; // Clear existing list

      querySnapshot.forEach((doc) => {
        const roastDate = doc.data().roastStartTime.toDate().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        const coffeeBatchNum = doc.data().coffeeBatchNum;
        const coffeeName = doc.data().coffeeName;
        const roastButton = document.createElement('button');
        roastButton.className = 'roast-name-button';
        roastButton.setAttribute('data-id', doc.id);
        roastButton.innerHTML = `#${coffeeBatchNum} - ${coffeeName} - ${roastDate}`;
        roastButton.addEventListener('click', () => loadRoastDetails(doc));
        roastNamesList.appendChild(roastButton);
      });

      document.getElementById('roastSelectionPopup').style.display = 'block';
    })
    .catch((error) => {
      console.error("Error loading roasts: ", error);
    });
}

function loadLastRoast(processRoastDataCallback) {
  const db = firebase.firestore();
  const collectionRef = db.collection(DB_COLLECTION);

  collectionRef.where(firebase.firestore.FieldPath.documentId(), '>=', 'roast_')
    .orderBy('roastStartTime', 'desc')
    .limit(1)
    .get()
    .then((querySnapshot) => {
      if (!querySnapshot.empty) {
        const doc = querySnapshot.docs[0]; // Access the first (and only) document
        console.log("Last Record:", doc.id, "=>", doc.data());
        processRoastDataCallback(doc.data());
      } else {
        console.log("No records found.");
      }
    })
    .catch((error) => {
      console.error("Error loading last roast: ", error);
    });
}

function getNextBatchNum(processNextBatchNumCallback) {
  loadLastRoast((lastRoast) => {
    if (!lastRoast)
      processNextBatchNumCallback(1);
    else
      processNextBatchNumCallback(parseInt(lastRoast.coffeeBatchNum) + 1);
  });
}

function loadRoastDetails(doc) {
  // Display details of the selected roast (doc.data())
  console.log("Roast details:", doc.data());
  roastLogger.loadRoastData(doc.data());
  // Hide popup after selecting
  document.getElementById('roastSelectionPopup').style.display = 'none';
}

function speakWithVoice(text) {
  if (!isSpeaking) {
    isSpeaking = true;
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => {
        console.log("Finished speaking!");
        isSpeaking = false;
      };
      utterance.voice = voice;
      utterance.volume = 1; // Full volume
      utterance.rate = 1;   // Normal rate
      utterance.pitch = 1;  // Normal pitch
      speechSynthesis.speak(utterance);
    } catch {
      isSpeaking = false;
    }
  }
}

function showError(msg) {
  console.error(msg);
  document.getElementById("errorMessage").textContent = msg;
}