class BluetoothRoastLogger {
  constructor(debug = false) {
    this.debug = debug; // Enable debug mode if true
    this.device = null;
    this.server = null;
    this.targetService = null;
    this.writableCharacteristic = null;
    this.enableLogging = false;
    this.logData = [];
    this.lastTemp1 = "-";
    this.lastTemp2 = "-";
    this.lastReadTime = "-";
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
              callback: function(value, index) {
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

  updateButtonStates(connected) {
    document.getElementById("startButton").disabled = !connected;
    document.getElementById("stopButton").disabled = !connected;
    document.getElementById("chargeButton").disabled = !connected;
    document.getElementById("dropButton").disabled = !connected;
  }

  async connect() {
    if (this.debug) {
      console.log("Debug mode enabled: Skipping Bluetooth connection");
      return true;
    }

    try {
      console.log("Attempting to connect...");

      // Automatically connect to the device with the specified UUID
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [0xFFE0] }] // Filter by service UUID
      });

      this.server = await this.device.gatt.connect();
      console.log(`Connected to ${this.device.name}`);

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
      this.updateButtonStates(true); // Enable buttons after successful connection
      return true;
    } catch (error) {
      console.error("Connection failed:", error);
      this.updateButtonStates(false); // Keep buttons disabled on failure
      return false;
    }
  }

  enableDurationCounter() {
    if (!this.durationInterval) {
      this.durationInterval = setInterval(() => {
        this.updateRoastDuration(); // Update duration every second
      }, 1000);
    }
  }

  startLogging() {
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
  }



  stopLogging() {
    clearInterval(this.loggingInterval);
    this.enableLogging = false;
    console.log("Logging stopped");
  }

  /**
   * Generates and logs fake data for testing.
   */
  generateFakeData() {
    const bt = Math.random() * 300 + 150; // Random BT temperature between 150-450
    const met = Math.random() * 300 + 150; // Random MET temperature between 150-450
    const logTime = new Date();

    this.lastTemp1 = bt.toFixed(1);
    this.lastTemp2 = met.toFixed(1);
    this.lastReadTime = logTime.toLocaleTimeString();

    // Log the fake data
    this.logData.push({ logTime, BT: bt, MET: met });

    // Update UI
    document.getElementById("lastReadTime").textContent = this.lastReadTime;
    document.getElementById("lastTemp1").textContent = this.lastTemp1;
    document.getElementById("lastTemp2").textContent = this.lastTemp2;

    // Update chart
    this.updateChart();
  }

  // Handle data received from the device (this is the 'characteristicvaluechanged' event handler)
  handleData(event) {
    const characteristic = event.target;
    const data = characteristic.value;
    this.processData(data);
  }

  processData(data) {
    const lastResponse = new TextDecoder().decode(data);
    console.log(`Received data: ${lastResponse}`);

    if (lastResponse.length >= 10 && lastResponse !== "Err\r\n") {
      // Parse BT and MET values from the data string
      const temp1Hex = lastResponse.substring(1, 5); // Assuming BT is at positions 1-4
      const temp2Hex = lastResponse.substring(7, 11); // Assuming MET is at positions 7-10

      const bt = parseInt(temp1Hex, 16) / 10;
      const met = parseInt(temp2Hex, 16) / 10;

      // Only log if the values are reasonable
      if (bt < 600 && bt > 0 && met < 600 && met > 0) {
        const logTime = new Date();
        this.lastTemp1 = bt.toFixed(1);
        this.lastTemp2 = met.toFixed(1);
        this.lastReadTime = logTime.toLocaleTimeString();

        // Log the data
        this.logData.push({ logTime, BT: bt, MET: met });

        // Update UI
        document.getElementById("lastReadTime").textContent = this.lastReadTime;
        document.getElementById("lastTemp1").textContent = this.lastTemp1;
        document.getElementById("lastTemp2").textContent = this.lastTemp2;

        // Update chart with new data
        this.updateChart();
      }
    }
  }

  charge() {
    console.log("Roast started");
    this.roastStartTime = this.getLatestLogTime();
    this.updateChart();
    this.updateRoastDuration(); // Update roast duration when roast starts

    // Update duration every second
    this.enableDurationCounter();
  }

  drop() {
    console.log("Roast ended");

    // Set the roast end time
    this.roastEndTime = new Date();

    // Stop updating the duration counter
    if (this.durationInterval) {
      clearInterval(this.durationInterval); // Ensure the interval is cleared
      this.durationInterval = null; // Reset to null to prevent re-initialization
    }

    // Stop logging
    this.stopLogging();

    // Calculate and display the final roast time
    if (this.roastStartTime && this.roastEndTime) {
      const duration = this.roastEndTime - this.roastStartTime;
      const minutes = Math.floor(duration / 60000);
      const seconds = ((duration % 60000) / 1000).toFixed(0);
      const formattedDuration = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
      document.getElementById("duration").textContent = `Final Roast Time: ${formattedDuration}`;
    } else {
      document.getElementById("duration").textContent = "Duration not available";
    }
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

}

const isFileProtocol = window.location.protocol === "file:";
const roastLogger = new BluetoothRoastLogger(debug = isFileProtocol);

// Connect Button Logic
document.getElementById("connectButton").addEventListener("click", async () => {
  const connected = await roastLogger.connect();
  if (connected) {
    document.getElementById("startButton").disabled = false;
    document.getElementById("chargeButton").disabled = false;
    document.getElementById("dropButton").disabled = false;
  }
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
