export default async function initializeCamera(parentElem: HTMLElement) {
  let videoElem = document.querySelector<HTMLVideoElement>('VIDEO');
  if (!videoElem) {
    videoElem = document.createElement('VIDEO') as HTMLVideoElement;
    videoElem.classList.add('camera-video');
    videoElem.autoplay = true;
    parentElem.appendChild(videoElem);
  }

  const cameraStream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: 1920,
      height: 1080,
    },
    audio: false,
  });
  videoElem.srcObject = cameraStream;
  return videoElem;
}
