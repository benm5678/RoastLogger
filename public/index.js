const DB_COLLECTION = "roast_logs";

// Check if the URL contains the debug parameter
const urlParams = new URLSearchParams(window.location.search);
const debugParam = urlParams.get("debug") === "true";
const isFileProtocol = window.location.protocol === "file:";
const debug = debugParam || isFileProtocol;

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
    this.timeData = [];
    this.btData = [];
    this.metData = [];
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
        labels: this.timeData,
        datasets: [
          {
            label: 'BT',
            data: this.btData,
            borderColor: 'rgba(75, 192, 192, 1)',
            backgroundColor: 'rgba(75, 192, 192, 0.2)',
            fill: false,
            tension: 0.1
          },
          {
            label: 'MET',
            data: this.metData,
            borderColor: 'rgba(255, 99, 132, 1)',
            backgroundColor: 'rgba(255, 99, 132, 0.2)',
            fill: false,
            tension: 0.1
          }
        ]
      },
      options: {
        scales: {
          x: {
            ticks: {
              autoSkip: true, // Chart.js will handle skipping based on available space
              maxTicksLimit: 10, // Ensure no more than 10 labels appear
              callback: function (value, index) {
                // Only show every Nth label explicitly (e.g., every 10th)
                const skipInterval = Math.ceil(this.chart.data.labels.length / 10); // Dynamically adjust interval
                return index % skipInterval === 0 ? this.getLabelForValue(value) : '';
              }
            }
          },
          y: {
            beginAtZero: false
          }
        }
      }
    });

  }

  updateButtonStates() {
    document.getElementById("connectButton").disabled = this.connected;
    document.getElementById("startButton").disabled = !this.connected || this.isLogging();
    document.getElementById("stopButton").disabled = !this.connected || !this.isLogging() || this.roastStartTime;
    document.getElementById("chargeButton").disabled = !this.connected || !this.isLogging() || this.roastStartTime || !this.getCoffeeName();
    document.getElementById("dropButton").disabled = !this.connected || !this.isLogging() || !this.roastStartTime || this.roastEndTime;
    document.getElementById('coffeeName').disabled = this.isLogging() && this.roastStartTime;
    document.getElementById('coffeeAmount').disabled = this.isLogging() && this.roastStartTime;
  }

  getCoffeeName() {
    return document.getElementById("coffeeName").value
  }

  setCoffeeName(name) {
    document.getElementById("coffeeName").value = name;
  }

  getCoffeeAmount() {
    return document.getElementById("coffeeAmount").value
  }

  setCoffeeAmount(amount) {
    document.getElementById("coffeeAmount").value = amount;
  }

  async connect() {
    if (this.debug) {
      console.log("Debug mode enabled: Skipping Bluetooth connection");
      this.connected = true;
      this.updateButtonStates();
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
      this.updateButtonStates(); // Enable buttons after successful connection
      return true;
    } catch (error) {
      console.error("Connection failed:", error);
      this.connected = false;
      this.updateButtonStates(); // Keep buttons disabled on failure
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
    this.updateButtonStates();

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
        this.updateButtonStates();
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
  }

  startLogging() {
    if (this.roastStartTime && !confirm("You sure you want to clear collected data?"))
      return;

    this.resetParams();
    if (this.debug) {
      console.log("Debug mode: Generating fake data...");
      this.enableLogging = true;
      this.logData = [];
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
      this.logData = [];
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

    this.updateButtonStates();
  }



  stopLogging() {
    clearInterval(this.loggingInterval);
    this.enableLogging = false;
    this.stopDurationCounter();
    this.updateButtonStates();
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
    document.getElementById("roastStartTime").textContent = this.roastStartTime ? this.roastStartTime.toLocaleTimeString() : "-";
    document.getElementById("BT").textContent = bt;
    document.getElementById("ET").textContent = et;

    // Update chart with new data
    this.updateChart();

    // Alert
    if (document.getElementById('enableAlarmCheckbox').checked) {
      const maxTemp = parseInt(document.getElementById('maxTempInput').value, 10);
      if (bt > maxTemp) {
        speakWithVoice(`Temp is ${bt}`);
      }
    }
  }

  charge() {
    console.log("Roast started");
    this.roastStartTime = this.getLatestLogTime();
    this.updateChart();
    this.updateRoastDuration(); // Update roast duration when roast starts
    this.updateButtonStates();

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
    this.updateButtonStates();

    this.saveRoastData();
  }



  updateRoastDuration() {
    const now = new Date();
    let duration;

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

    // Calculate the time difference from the earliest logTime
    this.timeData = filteredData.map(entry => {
      const offsetTime = new Date(entry.logTime - earliestTime);
      return offsetTime.toISOString().substr(11, 8); // Formats as HH:MM:SS
    });

    this.btData = filteredData.map(entry => entry.BT);
    this.metData = filteredData.map(entry => entry.MET);

    this.chart.data.labels = this.timeData;
    this.chart.data.datasets[0].data = this.btData;
    this.chart.data.datasets[1].data = this.metData;
    this.chart.update();
  }

  loadRecentRoasts() {
    const db = firebase.firestore();
    const collectionRef = db.collection(DB_COLLECTION);

    // Query for documents that start with "roast_"
    collectionRef.where(firebase.firestore.FieldPath.documentId(), '>=', 'roast_')
      .orderBy(firebase.firestore.FieldPath.documentId(), 'asc')
      .limit(10)
      .get()
      .then((querySnapshot) => {
        const roasts = [];
        querySnapshot.forEach((doc) => {
          roasts.push({
            id: doc.id,
            ...doc.data()
          });
        });
        console.log('Last 10 roasts:', roasts);
      })
      .catch((error) => {
        console.error("Error loading roasts: ", error);
      });
  }

  saveRoastData() {
    const db = firebase.firestore();
    const docName = this.roastEndTime ? `roast_${this.roastStartTime.toISOString().replace(/[:.-]/g, '')}` : 'active';

    db.collection(DB_COLLECTION).doc(docName).set({
      roastStartTime: this.roastStartTime ?? null,
      roastEndTime: this.roastEndTime ?? null,
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
    this.roastStartTime = roastData.roastStartTime;
    this.roastEndTime = roastData.roastEndTime;
    this.logData = roastData.logData;
    this.setCoffeeName(roastData.coffeeName ?? '');
    this.setCoffeeAmount(roastData.coffeeAmount ?? 150);
    this.updateButtonStates();
    this.updateChart();
  }
}

// Initialize the BluetoothRoastLogger
const roastLogger = new BluetoothRoastLogger(debug);

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

document.getElementById('enableAlarmCheckbox').addEventListener('change', function () {
  const maxTempInput = document.getElementById('maxTempInput');
  maxTempInput.style.display = this.checked ? 'inline-block' : 'none';
  if (this.checked) {
    speakWithVoice(""); // Required to enable on iOS from human click
  }
});

document.getElementById('coffeeName').addEventListener('input', function () {
  roastLogger.updateButtonStates();
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

function speakWithVoice(text) {
  if (!isSpeaking) {
    isSpeaking = true;
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.volume = 1; // Full volume
      utterance.rate = 1;   // Normal rate
      utterance.pitch = 1;  // Normal pitch
      speechSynthesis.speak(utterance);
    } finally {
      isSpeaking = false;
    }
  }
}

function showError(msg) {
  console.error(msg);
  document.getElementById("errorMessage").textContent = msg;
}