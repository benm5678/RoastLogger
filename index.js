class BluetoothRoastLogger {
  constructor() {
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
          this.writableCharacteristic.addEventListener('characteristicvaluechanged', this.handleData.bind(this)); // Handle incoming data
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

  startLogging() {
    if (!this.writableCharacteristic) {
      console.error("Writable characteristic not available");
      return;
    }
    console.log("Starting logging...");
    this.enableLogging = true;
    this.logData = [];

    const readCommand = "#001Nrn"; // Command to read data (replace with your actual command)
    const data = new TextEncoder().encode(readCommand);

    const timer = setInterval(() => {
      if (this.enableLogging) {
        console.log("Sending data to characteristic...");
        this.writableCharacteristic.writeValueWithoutResponse(data)
          .then(() => {
            console.log("Command sent successfully")
          })
          .catch(err => console.error("Error writing value:", err));
      }
    }, 1000 * 2); // Send the command every second

    this.loggingInterval = timer;
  }

  stopLogging() {
    clearInterval(this.loggingInterval);
    this.enableLogging = false;
    console.log("Logging stopped");
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
    this.roastStartTime = new Date();
    this.updateChart();
  }

  drop() {
    console.log("Roast ended");
    this.stopLogging();
  }

  updateChart() {
    if (this.roastStartTime) {
      const filteredData = this.logData.filter(entry => entry.logTime >= this.roastStartTime);
      this.timeData = filteredData.map(entry => entry.logTime.toLocaleTimeString());
      this.btData = filteredData.map(entry => entry.BT);
      this.metData = filteredData.map(entry => entry.MET);
    } else {
      this.timeData = this.logData.map(entry => entry.logTime.toLocaleTimeString());
      this.btData = this.logData.map(entry => entry.BT);
      this.metData = this.logData.map(entry => entry.MET);
    }
  
    this.chart.data.labels = this.timeData;
    this.chart.data.datasets[0].data = this.btData;
    this.chart.data.datasets[1].data = this.metData;
    this.chart.update();
  }
}

const roastLogger = new BluetoothRoastLogger();

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
