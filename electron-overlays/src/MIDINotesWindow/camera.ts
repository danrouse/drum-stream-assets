export default async function initializeCamera(parentElem: HTMLElement) {
  let videoElem = document.querySelector<HTMLVideoElement>('VIDEO');
  if (!videoElem) {
    videoElem = document.createElement('VIDEO') as HTMLVideoElement;
    videoElem.classList.add('camera-video');
    videoElem.autoplay = true;
    parentElem.appendChild(videoElem);
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  console.log('Video Devices', devices.filter(d => d.kind === 'videoinput').map(d => [d.label, d.deviceId]));

  const cameraStream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: 1920,
      height: 1080,
      deviceId: {
        exact: 'abbd7e022d1282d5ba2103ff0e3526c1c9554b957e8513daeebe2fd5c35b83ef',
      }
    },
    audio: false,
  });
  videoElem.srcObject = cameraStream;
  return videoElem;
}
