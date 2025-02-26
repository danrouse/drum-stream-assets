/// <reference types="web-bluetooth" />
const heartRateElem = document.createElement('div');
heartRateElem.classList.add('heart-rate');
document.getElementById('app')?.appendChild(heartRateElem);


let reconnectInterval: NodeJS.Timeout | undefined;
let heartRateBPM: number = 60;

function updatePulseSpeed() {
  heartRateElem.style.animationDuration = `${60 / heartRateBPM}s`;
  setTimeout(updatePulseSpeed, (60 / heartRateBPM) * 1000);
}
updatePulseSpeed();

// @ts-expect-error
window._initialize = async () => {
  console.log('Searching for BLE heart monitor device...');
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [0x180d] }] });
  console.log('Found device!', device);

  await retryConnect(device);
  device.addEventListener('gattserverdisconnected', async () => {
    console.log('Disconnected!');
    retryConnect(device);
  });
};

function retryConnect(device: BluetoothDevice) {
  reconnectInterval = setInterval(async () => {
    try {
      console.log('Attempting to connect to device', device.name);
      await connect(device);
      clearInterval(reconnectInterval);
    } catch (e) {}
  }, 5000);
}

async function connect(device: BluetoothDevice) {
  const server = await device.gatt?.connect();
  if (!server) {
    console.error('Unable to connect to GATT');
    return;
  }
  const service = await server.getPrimaryService(0x180d);
  const characteristic = await service.getCharacteristic('00002a37-0000-1000-8000-00805f9b34fb');
  await characteristic.startNotifications();
  characteristic.addEventListener('characteristicvaluechanged', (evt) => {
    const value = characteristic.value;
    if (!value) return;
    const flag = value.getUint8(0);
    heartRateBPM = flag & 0x1 ? value.getUint16(1, true) : value.getUint8(1);
    heartRateElem.innerText = String(heartRateBPM);
  });

  console.log('Connected to device', device.name);
};
