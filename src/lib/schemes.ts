/**
 * Colour schemes. Each one re-tints the whole app — background, surfaces and the primary
 * colour — with tuned values for light and dark. Semantic colours (good / watch / over)
 * stay fixed so meaning never changes with the scheme. Values are "R G B" channels.
 */
export interface SchemeTones { bg: string; surface: string; sunk: string; line: string; primary: string; onprimary: string }
export interface Scheme { id: string; name: string; light: SchemeTones; dark: SchemeTones }

export const SCHEMES: Scheme[] = [
  {
    id: 'harbor', name: 'Harbor',
    light: { bg: '243 244 241', surface: '255 255 255', sunk: '234 237 232', line: '221 225 219', primary: '15 76 92', onprimary: '255 255 255' },
    dark: { bg: '11 19 23', surface: '18 29 35', sunk: '8 14 17', line: '35 50 58', primary: '127 209 185', onprimary: '7 33 38' },
  },
  {
    id: 'ocean', name: 'Ocean',
    light: { bg: '241 244 250', surface: '255 255 255', sunk: '231 236 246', line: '218 225 238', primary: '35 76 196', onprimary: '255 255 255' },
    dark: { bg: '10 14 27', surface: '17 23 41', sunk: '7 10 20', line: '33 42 68', primary: '140 172 255', onprimary: '8 18 48' },
  },
  {
    id: 'forest', name: 'Forest',
    light: { bg: '241 245 240', surface: '255 255 255', sunk: '231 238 229', line: '217 227 214', primary: '30 104 68', onprimary: '255 255 255' },
    dark: { bg: '10 18 13', surface: '17 29 22', sunk: '7 13 9', line: '33 52 40', primary: '120 214 156', onprimary: '6 32 18' },
  },
  {
    id: 'plum', name: 'Plum',
    light: { bg: '246 242 247', surface: '255 255 255', sunk: '238 231 240', line: '228 219 231', primary: '112 52 140', onprimary: '255 255 255' },
    dark: { bg: '19 12 24', surface: '30 20 38', sunk: '13 8 17', line: '52 37 64', primary: '210 166 246', onprimary: '38 12 56' },
  },
  {
    id: 'sunset', name: 'Sunset',
    light: { bg: '248 244 239', surface: '255 255 255', sunk: '242 234 225', line: '233 223 211', primary: '176 72 30', onprimary: '255 255 255' },
    dark: { bg: '22 14 10', surface: '35 23 17', sunk: '16 10 7', line: '60 41 31', primary: '255 166 116', onprimary: '58 22 4' },
  },
  {
    id: 'graphite', name: 'Graphite',
    light: { bg: '242 243 245', surface: '255 255 255', sunk: '232 234 238', line: '220 223 228', primary: '38 46 60', onprimary: '255 255 255' },
    dark: { bg: '13 14 17', surface: '22 24 29', sunk: '9 10 12', line: '40 43 51', primary: '208 216 230', onprimary: '18 22 30' },
  },
];

export const schemeById = (id: string) => SCHEMES.find((s) => s.id === id) ?? SCHEMES[0];
export const rgb = (channels: string) => `rgb(${channels.split(' ').join(',')})`;
