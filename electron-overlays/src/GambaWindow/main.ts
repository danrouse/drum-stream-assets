const containerElem = document.getElementById('app')!;

const titleContainer = document.createElement('div');
titleContainer.classList.add('title-container');
containerElem.appendChild(titleContainer);

const titleElem = document.createElement('h1');
titleElem.innerText = 'Any Drum';
titleElem.classList.add('title');
titleContainer.appendChild(titleElem);

const subTitleElem = document.createElement('h2');
subTitleElem.innerText = 'triggers this song';
subTitleElem.classList.add('subtitle');
titleContainer.appendChild(subTitleElem);

const counterElem = document.createElement('p');
counterElem.innerText = '0';
counterElem.classList.add('counter');
containerElem.appendChild(counterElem);

window.ipcRenderer.on('gamba_started', (_, { drumName }) => {
  titleElem.innerText = drumName;
  counterElem.innerText = '0';
  containerElem.classList.add('visible');
});

window.ipcRenderer.on('gamba_progress', (_, { count }) => {
  counterElem.innerText = String(count);
});

window.ipcRenderer.on('gamba_complete', () => {
  containerElem.classList.remove('visible');
});
