export default async function initializeCamera(parentElem: HTMLElement, cameraId: string) {
  let videoElem = document.querySelector<HTMLVideoElement>('VIDEO');
  if (!videoElem) {
    videoElem = document.createElement('VIDEO') as HTMLVideoElement;
    videoElem.classList.add('camera-video');
    videoElem.autoplay = true;
    parentElem.appendChild(videoElem);
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  console.info('Video Devices', devices.filter(d => d.kind === 'videoinput').map(d => [d.label, d.deviceId]));

  const cameraStream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: 1920,
      height: 1080,
      deviceId: {
        exact: cameraId,
      }
    },
    audio: false,
  });
  videoElem.srcObject = cameraStream;
  return videoElem;
}
