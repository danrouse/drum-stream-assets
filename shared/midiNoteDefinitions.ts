export interface MIDINoteDefinition {
  name: string;
  color: string;
  z: number;
  keys: number[];
}

export interface MIDINoteDisplayDefinition extends MIDINoteDefinition {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
};

export const midiNoteDefinitions: MIDINoteDefinition[] = [
  { name: 'Snare', keys: [37, 38, 40], color: 'rgb(223, 25, 25)', z: 7 },
  { name: 'Tom1', keys: [48, 50], color: 'rgb(94 120 231)', z: 6 },
  { name: 'Tom2', keys: [45, 47], color: 'rgb(94 201 231)', z: 5 },
  { name: 'Tom3', keys: [43, 58], color: 'rgb(77 218 134)', z: 4 },
  { name: 'Tom4', keys: [41, 39], color: 'rgb(60 145 40)', z: 3 },
  { name: 'HiHat', keys: [26, 46, 44], color: 'rgb(206 179 57)', z: 8 },
  { name: 'Crash1', keys: [49], color: 'rgb(248 16 138)', z: 9 },
  { name: 'Crash2', keys: [52, 57], color: 'rgb(209 102 255)', z: 1 },
  { name: 'Ride', keys: [29, 30], color: 'orangered', z: 1 },
  { name: 'Ride2', keys: [51, 53], color: 'brown', z: 6 },
  { name: 'Splash', keys: [27, 28], color: '#aaa', z: 5 },
  { name: 'Kick', keys: [36], color: '#444', z: 2 },
  { name: 'Kick Secondary', keys: [36], color: '#444', z: 2 },
];

export const midiNoteKeysByName = midiNoteDefinitions.reduce((acc, def) => {
  acc[def.name] = def.keys;
  return acc;
}, {} as { [name: string]: number[] });
