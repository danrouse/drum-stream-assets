// Kits are posted to pastebin for viewing
export const td30KitsPastebin = 'https://pastebin.com/hDsiNT2k';

export const kitNames = [
  'Studio',
  'LA Metal',
  'Swingin\'',
  'Burnin\'',
  'Birch',
  'Nashville',
  'LoudRock',
  'JJ\'s DnB',
  'Djembe',
  'Stage',
  'RockMaster',
  'LoudJazz',
  'Overhead',
  'Looooose',
  'Fusion',
  'Room',
  '[RadioMIX]',
  'R&B',
  'Brushes',
  'Vision',
  'AstroNote',
  'acidfunk',
  'PunkRock',
  'OpenMaple',
  '70s Rock',
  'DrySound',
  'Flat&Shallow',
  'Rvs!Trashy',
  'melodious',
  'HARD n\'BASS',
  'BazzKicker',
  'FatPressed',
  'DrumnDubStep',
  'ReMix-ulator',
  'Acoutronic',
  'HipHop',
  '90sHouse',
  'D-N-B',
  'SuperLoop',
  '>>process>>>',
  'RockGig',
  'Hard BeBop',
  'Rock Solid',
  '2nd Line',
  'ROBO',
  'SATURATED',
  'piccolo',
  'FAT',
  'BigHall',
  'CoolGig',
  'JazzSes',
  '7/4 Beat',
  ':neotype:',
  'FLA>n<GER',
  'CustomWood',
  '50s King',
  'BluesRock',
  '2HH House',
  'TechFusion',
  'BeBop',
  'Crossover',
  'Skanky',
  'RoundBdge',
  'Metal\Core',
  'JazzCombo',
  'Spark!',
  '80sMachine',
  '=cosmic=',
  '1985',
  'TR-808',
  'TR-909',
  'LatinDrums',
  'Latin',
  'Brazil',
  'Cajon',
  'African',
  'Ka-Rimba',
  'Tabla',
  'Asian',
  'Orchestra',
];

const sanitizeKitName = (name: string) => name
  .toLowerCase()
  .replace(/[\W\s\-\_]/g, '');

const sanitizedKitNames = kitNames.map(n => sanitizeKitName(n));

export function getKitDefinition(name: string | number): [number, string] | undefined {
  if (typeof name === 'number' || !Number.isNaN(Number(name))) {
    name = Number(name);
    if (name < 1 || name > kitNames.length) return;
    return [name, kitNames[name - 1]];
  }
  const kitIndex = sanitizedKitNames.indexOf(sanitizeKitName(name));
  if (kitIndex === -1) return;
  return [kitIndex + 1, kitNames[kitIndex]];
}
