export const CAM_ID_RIDE = 'abbd7e022d1282d5ba2103ff0e3526c1c9554b957e8513daeebe2fd5c35b83ef';
export const CAM_ID_OVERHEAD = '283197bd4b6c6e3e8a801b83185954cb744df394d9ba307388f67277a54a68eb';

export default async function initializeCamera(parentElem: HTMLElement, cameraId: string) {
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
        exact: cameraId,
      }
    },
    audio: false,
  });
  videoElem.srcObject = cameraStream;
  return videoElem;
}
