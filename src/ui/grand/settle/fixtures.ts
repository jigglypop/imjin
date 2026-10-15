import type { Ground, SiteRecord, Vec2 } from './types';

// Three sample sites to preview and test the settlement builders on before the solver writes public/ui/grand_sites.json:
// Yeosu, a Joseon seat of value 2, its camp across the neck of the peninsula facing east over its harbour, the works down
// the east shore and the town round the inner bay to the north-west; Busan, value 3, its camp on the hill north-east of
// the port facing south over the bay, the works up the east shore and a walled town on the low ground to the west; and
// Noryang, value 1, its camp at the head of a cove on the strait facing south over it, the works round the cove and the
// town on the slope behind. Laid out once by a script of hand-written rules over the drawn terrain round the real ports,
// not kept: frozen data, to give way to the solver's records. Every pad is clipped where the coast cuts it, as the
// solver's will be, and every town is laid out up to value 3 where the ground allows, so each size can be seen on each
// site.
//
// Each site's ground is a 3 m grid of the drawn heights in centimetres (below 0 is sea), read bilinearly, every pad flat
// at its h0 inside its outline and nothing eased outside it. At run time the terrain build eases the pads into the land
// instead, so no builder may rely on the ground just outside a pad.

export type FixtureId = 'yeosu' | 'busan' | 'noryang';

export const FIXTURES: Record<FixtureId, SiteRecord> = {
  yeosu: {
    id: 'yeosu',
    u: 0.5200759,
    v: 0.3454666,
    seaward: [0.94, 0.342],
    radius: 169,
    value: 2,
    seat: true,
    pads: [
      {
        id: 'core',
        poly: [
          [13.7, -37.6], [-0.5, -43], [-5.8, -43.6], [-9.6, -41.9], [-10.2, -31.9], [-12.2, -29], [-15.4, -28], [-17.8, -22.9], [-29.1, -10.6],
          [-35.7, 7.7], [-37.3, 14.4], [-37.8, 19.4], [-37.2, 23.5], [-35.5, 26.8], [-32.5, 29.7], [-28, 32.6], [-13.3, 36.6], [0.5, 43],
          [5.8, 43.6], [9.9, 43.4], [13.4, 41.9], [16.5, 39.2], [19.3, 35], [22.4, 28.9], [25.8, 9.4], [34.7, -7.5], [35.9, -13.9], [36, -18.5],
          [35.9, -22.7], [35.5, -26.8], [32.5, -29.7], [28, -32.6],
        ],
        h0: 2.8,
      },
      { id: 'battery', poly: [[4.5, 48.5], [12.1, 67], [25, 61.6], [17.4, 43.1]], h0: 0.44 },
      { id: 'granary', poly: [[-35.1, 0], [-26.9, -22.6], [-43.8, -28.7], [-52, -6.2]], h0: 0.74 },
      { id: 'beacon', poly: [[85.8, -30.1], [91.3, -45.1], [78.2, -49.9], [72.7, -34.9]], h0: 14.17 },
    ],
    harbour: {
      quay: [
        [31.6, 41.5], [31.5, 39.4], [31.9, 37.4], [32.6, 35.7], [33.6, 34.1], [33.5, 32.3], [31.5, 31.8], [29.2, 31.5], [28.2, 29.6], [29, 27.6],
        [30.2, 26], [31.4, 24.5], [31.7, 22.6], [31.7, 20.7], [31.2, 18.8], [30.8, 16.9], [30, 15], [29.5, 12.9], [29.1, 10.9], [28.9, 8.9],
        [29.1, 6.8], [30.2, 5], [32, 3.8], [33.6, 2.5], [35.4, 1.6], [36.6, 0.2], [37.5, -1.5], [37.9, -3.4], [38.3, -5.3], [38.5, -7.3],
        [38.7, -9.2], [38.8, -11.2], [38.9, -13.2], [38.9, -15.2], [39, -17.2], [38.8, -19.2], [38.9, -21.2],
      ],
      span: { 1: [36.3, 36.3], 2: [25.3, 47.3], 3: [10.3, 62.3] },
      gate: { x: 29.1, z: 10.9, rot: 1.222 },
      piers: [
        { x: 29.1, z: 10.9, rot: 1.731, len: 13.5, width: 3, from: 1, berths: [{ x: 44.9, z: 14.5, rot: 1.731 }] },
        { x: 38.6, z: -8.1, rot: 1.491, len: 17.5, width: 3.5, from: 2, berths: [{ x: 53.1, z: -0.6, rot: 1.491 }] },
      ],
      anchorage: [
        { x: 86.1, z: 58.9, rot: 1.222 },
        { x: 86.1, z: 70.9, rot: 1.222 },
        { x: 50.1, z: -73.1, rot: 1.222 },
        { x: 92.1, z: 85.9, rot: 1.222 },
        { x: 113.1, z: 64.9, rot: 1.222 },
        { x: 74.1, z: 100.9, rot: 1.222 },
        { x: 113.1, z: 76.9, rot: 1.222 },
        { x: 95.1, z: 97.9, rot: 1.222 },
        { x: 74.1, z: 112.9, rot: 1.222 },
        { x: 119.1, z: 91.9, rot: 1.222 },
        { x: 71.1, z: 124.9, rot: 1.222 },
        { x: 140.1, z: 67.9, rot: 1.222 },
      ],
      breakwater: [],
    },
    camp: {
      walls: {
        1: {
          points: [[20.7, -17.5], [-4.6, -26.7], [-11.1, -23.7], [-23.7, 11.1], [-20.7, 17.5], [4.6, 26.7], [11.1, 23.7], [23.7, -11.1]],
          closed: true,
          gates: [{ x: 17.1, z: 6.2, rot: 1.222, width: 5, role: 'sea' }, { x: -17.4, z: -6.3, rot: -1.92, width: 5, role: 'land' }],
        },
        2: {
          points: [
            [27, -23.1], [-5.8, -35.1], [-7.8, -31.5], [-9.3, -27.8], [-11.4, -26.5], [-14.3, -23.9], [-17.2, -20.1], [-18.6, -17.7], [-30.6, 15.5],
            [-27, 23.1], [5.8, 35.1], [13.5, 31.5], [30.6, -15.5],
          ],
          closed: true,
          gates: [{ x: 21.8, z: 8, rot: 1.222, width: 7, role: 'sea' }, { x: -21.8, z: -8, rot: -1.92, width: 6, role: 'land' }],
        },
        3: {
          points: [
            [12.8, -35.1], [-5.5, -41], [-9.2, -28.9], [-13.9, -25.2], [-26.5, -9.6], [-34.3, 13.3], [-34.8, 22], [-30.5, 27.9], [-12.5, 34.3],
            [5.5, 41], [12.5, 39.2], [17.8, 32.2], [23.4, 8.5], [33, -12.8], [33.4, -21.1], [30.5, -27.9],
          ],
          closed: true,
          gates: [{ x: 23.3, z: 8.5, rot: 1.222, width: 9, role: 'sea' }, { x: -26.3, z: -9.6, rot: -1.92, width: 7, role: 'land' }],
        },
      },
      streets: [
        { points: [[29.1, 10.9], [23.3, 8.5], [0, 0]], width: 5, from: 1 },
        { points: [[6.3, 31], [24.7, -19.7]], width: 3, from: 2 },
        { points: [[-26.3, -9.6], [-14.6, -5.3]], width: 4, from: 1 },
      ],
      lots: [
        { kind: 'hall', x: -7, z: -2.6, rot: 1.222, w: 22, d: 15, y: 2.8, drop: 0, from: 1, rank: 0 },
        { kind: 'yard', x: 7, z: 2.6, rot: 1.222, w: 20, d: 11, y: 2.8, drop: 0, from: 1, rank: 0 },
        { kind: 'barracks', x: -0.9, z: 17, rot: 2.793, w: 16, d: 7, y: 2.8, drop: 0, from: 1, rank: 0 },
        { kind: 'barracks', x: 10.3, z: -13.6, rot: -0.349, w: 16, d: 7, y: 2.8, drop: 0, from: 1, rank: 1 },
        { kind: 'office', x: -19, z: 12.8, rot: 1.222, w: 11, d: 8, y: 2.8, drop: 0, from: 2, rank: 0 },
        { kind: 'barracks', x: 8.7, z: -24, rot: -0.349, w: 24, d: 6.5, y: 2.8, drop: 0, from: 3, rank: 2 },
        { kind: 'barracks', x: -7.3, z: 24.5, rot: 2.793, w: 16, d: 6.5, y: 2.8, drop: 0, from: 3, rank: 3 },
      ],
    },
    town: {
      culture: 'korean',
      streets: [
        {
          points: [
            [-29, -77.2], [-35.1, -81.8], [-42.9, -85], [-53.9, -96], [-61.4, -100.6], [-70.4, -101], [-73.3, -98], [-74.2, -92], [-72.9, -81.8],
            [-67.2, -71.8], [-72.3, -63.2], [-73.1, -55.3], [-72, -51.1], [-68.3, -44.5], [-63, -40.2], [-58.7, -38.9], [-53.5, -39.2],
          ],
          width: 4,
          from: 1,
        },
        {
          points: [
            [-29, -101.2], [-28.5, -103.4], [-32.5, -108.1], [-42.4, -115.1], [-53.1, -120.5], [-64.4, -123.3], [-74.5, -122.2], [-81.2, -113.9],
            [-83.2, -95.8], [-82.4, -88.9], [-86.3, -85.6], [-93.7, -71.4], [-95.8, -62.9], [-95.8, -53.8], [-93.6, -44.4], [-86.4, -29.8],
            [-82.2, -25.3], [-75.9, -21.3], [-65.7, -18.3], [-52.2, -19.1],
          ],
          width: 4,
          from: 1,
        },
        {
          points: [
            [-29, -125.2], [-26.5, -128.4], [-27.9, -131.7], [-44.8, -140.4], [-62.7, -145], [-78.6, -143.5], [-89.1, -129.8], [-92.1, -99.7],
            [-92.1, -67.8], [-94.6, -50.7], [-97.4, -43.9], [-103, -42.4], [-105.5, -47.7], [-106.7, -57.8], [-118.4, -66.4],
          ],
          width: 4,
          from: 1,
        },
        {
          points: [
            [-73.5, -96.8], [-77.2, -101.5], [-80.9, -106.2], [-84.6, -111], [-88.3, -115.7], [-91.9, -120.4], [-95.6, -125.2], [-99.3, -129.9],
            [-103, -134.6],
          ],
          width: 3,
          from: 1,
        },
        {
          points: [
            [-72.7, -61.3], [-78.6, -62.4], [-84.5, -63.6], [-90.4, -64.7], [-96.3, -65.8], [-102.2, -66.9], [-108.1, -68], [-114, -69.1],
            [-119.9, -70.3],
          ],
          width: 3,
          from: 1,
        },
      ],
      lots: [
        { kind: 'tree', x: -27.1, z: -85.3, rot: -0.783, w: 7, d: 7, y: 0.81, drop: 0.57, from: 1, rank: 0 },
        { kind: 'well', x: -74.9, z: -85.5, rot: 2.927, w: 3, d: 3, y: 0.66, drop: 0.27, from: 1, rank: 0 },
        { kind: 'boats', x: -62.5, z: -94.7, rot: 3.078, w: 12, d: 6, y: 1.21, drop: 1.21, from: 1, rank: 0 },
        { kind: 'racks', x: -60.6, z: -71.5, rot: -1.087, w: 9, d: 4, y: 0.35, drop: 0.32, from: 1, rank: 0 },
        { kind: 'landing', x: -63.6, z: -81.8, rot: -0.935, w: 4, d: 12, y: 0.22, drop: 0.22, from: 1, rank: 0 },
        { kind: 'market', x: -68.5, z: -114.4, rot: -2.891, w: 16, d: 12, y: 1.39, drop: 1.16, from: 2, rank: 0 },
        { kind: 'pavilion', x: -59.8, z: -45.1, rot: -0.805, w: 8, d: 8, y: 1.06, drop: 1.05, from: 2, rank: 0 },
        { kind: 'temple', x: -117, z: -77.2, rot: 1.151, w: 14, d: 12, y: 1.37, drop: 1.19, from: 3, rank: 0 },
        { kind: 'boats', x: -67.6, z: -59, rot: -1.504, w: 10, d: 5, y: 0.78, drop: 0.69, from: 3, rank: 1 },
        { kind: 'house', x: -78, z: -75.2, rot: 2.431, w: 12, d: 8, y: 1.09, drop: 0.89, from: 1, rank: 1 },
        { kind: 'house', x: -80.8, z: -61.6, rot: 1.383, w: 9, d: 8, y: 1.76, drop: 1.26, from: 1, rank: 2 },
        { kind: 'house', x: -81.4, z: -99.5, rot: -0.214, w: 13, d: 8, y: 1.32, drop: 1.17, from: 1, rank: 3 },
        { kind: 'house', x: -66.5, z: -131, rot: 0.251, w: 11, d: 8, y: 1.39, drop: 0.84, from: 1, rank: 5 },
        { kind: 'house', x: -86.9, z: -112.9, rot: 0.662, w: 10, d: 8, y: 2.3, drop: 1.09, from: 1, rank: 6 },
        { kind: 'house', x: -93.3, z: -78.3, rot: 1.151, w: 14, d: 8, y: 2.16, drop: 1.3, from: 1, rank: 4 },
        { kind: 'house', x: -99.3, z: -37.9, rot: 2.218, w: 9, d: 8, y: 1.86, drop: 1.3, from: 2, rank: 8 },
        { kind: 'house', x: -24.2, z: -119.1, rot: 3.053, w: 9, d: 8, y: 3.79, drop: 0.95, from: 1, rank: 0 },
        { kind: 'house', x: -96.9, z: -93.1, rot: -2.61, w: 10, d: 8, y: 1.32, drop: 0.89, from: 2, rank: 7 },
        { kind: 'house', x: -112, z: -92.8, rot: 0.968, w: 14, d: 8, y: 0.83, drop: 0.56, from: 2, rank: 10 },
        { kind: 'house', x: -104.4, z: -108.2, rot: 0.531, w: 9, d: 8, y: 1.43, drop: 0.99, from: 2, rank: 9 },
      ],
      walls: [
        {
          points: [
            [-27.4, -117.2], [-18.2, -111.3], [-18.4, -112.6], [-21.2, -115.6], [-24.5, -118.4], [-27.6, -120.5], [-25.5, -118.2], [-30.3, -121.4],
            [-22.5, -114.5], [-23.1, -116], [-23.5, -115.2], [-31.6, -122.2], [-48.9, -132.8], [-63.5, -136.2], [-77.7, -134.8], [-86.5, -125.7],
            [-91.1, -106.1], [-85.6, -64], [-88.6, -54.2], [-93.3, -51.9], [-92.3, -49.2], [-97.2, -52.3], [-98.8, -53.5],
          ],
          closed: false,
          gates: [],
          from: 2,
        },
      ],
    },
    works: {
      shipyard: { kind: 'shipyard', x: 52.6, z: 49.7, rot: 1.893, w: 24, d: 28, y: 1.1, drop: 1.09, shore: -6 },
      dock: { kind: 'dock', x: 59.3, z: 79.4, rot: 2.076, w: 20, d: 26, y: 1.46, drop: 1.45, shore: -5 },
      battery: { kind: 'battery', x: 14.8, z: 55.1, rot: 5.105, w: 18, d: 12, y: 0.44, drop: 0 },
      granary: { kind: 'granary', x: -39.5, z: -14.4, rot: 1.222, w: 22, d: 16, y: 0.74, drop: 0 },
      beacon: { kind: 'beacon', x: 82, z: -40, rot: 1.222, w: 14, d: 12, y: 14.17, drop: 0 },
    },
    fields: [],
    roads: [],
  },
  busan: {
    id: 'busan',
    u: 0.7841185,
    v: 0.1760676,
    seaward: [0.174, 0.985],
    radius: 192,
    value: 3,
    seat: false,
    pads: [
      {
        id: 'core',
        poly: [
          [39.4, -6.9], [37, -21.9], [34.9, -26.9], [32.6, -30.3], [29.6, -32.6], [25.7, -33.8], [20.7, -34.2], [13.8, -33.8], [-5.4, -30.5],
          [-24.5, -27], [-31.1, -25.1], [-35.7, -23], [-38.9, -20.5], [-41, -17.3], [-41.9, -13.3], [-42.3, -8], [-39.9, 7], [-37, 21.9],
          [-34.9, 26.9], [-32.6, 30.3], [-29.6, 32.6], [-25.7, 33.8], [-20.7, 34.2], [-13.8, 33.8], [4, 22.7], [24.5, 27], [31.1, 25.1], [34, 21.9],
          [35, 18.4], [35, 14.8], [37.6, 12], [42.3, 8],
        ],
        h0: 2.17,
      },
      { id: 'battery', poly: [[68.7, -63.5], [68.7, -83.5], [54.7, -83.5], [54.7, -63.5]], h0: 1.1 },
      { id: 'granary', poly: [[-22.7, -38.4], [0.5, -44.6], [-4.2, -62], [-27.4, -55.8]], h0: 2.25 },
      { id: 'beacon', poly: [[-54.7, -47.7], [-38.9, -50.5], [-41.3, -64.3], [-57.1, -61.5]], h0: 14.83 },
    ],
    harbour: {
      quay: [
        [-5, 47.4], [-6.6, 46.5], [-8.8, 46.2], [-10.6, 45], [-10.7, 42.8], [-10.1, 40.8], [-8.7, 39.1], [-9.4, 37], [-9.4, 34.9], [-8.6, 32.8],
        [-7, 31.3], [-5, 30.8], [-3, 30.9], [-1.3, 30.5], [0.5, 29.8], [-0.6, 26], [1.7, 26.2], [3.5, 27.3], [5.2, 28.2], [7.1, 28.8], [8.5, 30.4],
        [10.3, 30.9], [12.1, 30.4], [13.4, 28.4], [15.4, 27.8], [17.5, 28.4], [19.6, 28.9], [21.5, 29.7], [23.1, 30.9], [25, 31.5], [26.8, 32],
        [28.7, 31.9], [30.6, 31.6], [32.2, 30.4], [33.6, 29.2], [34.8, 27.6], [36, 26],
      ],
      span: { 1: [39.5, 39.5], 2: [28.5, 50.5], 3: [13.5, 65.5] },
      gate: { x: 5.2, z: 28.2, rot: 0.175 },
      piers: [
        { x: 5.2, z: 28.2, rot: -0.437, len: 13.5, width: 3, from: 1, berths: [] },
        {
          x: 25.3,
          z: 31.6,
          rot: -0.269,
          len: 17.5,
          width: 3.5,
          from: 2,
          berths: [{ x: 15.1, z: 44.3, rot: -0.269 }, { x: 27.4, z: 47.7, rot: -0.269 }],
        },
      ],
      anchorage: [
        { x: 44.2, z: 40.2, rot: 0.175 },
        { x: 8.2, z: 73.2, rot: 0.175 },
        { x: 53.2, z: 28.2, rot: 0.175 },
        { x: 20.2, z: 76.2, rot: 0.175 },
        { x: 38.2, z: 67.2, rot: 0.175 },
        { x: -0.8, z: 85.2, rot: 0.175 },
        { x: 50.2, z: 67.2, rot: 0.175 },
        { x: 65.2, z: 31.2, rot: 0.175 },
        { x: 59.2, z: 55.2, rot: 0.175 },
        { x: -9.8, z: 97.2, rot: 0.175 },
        { x: 77.2, z: 31.2, rot: 0.175 },
        { x: 71.2, z: 58.2, rot: 0.175 },
      ],
      breakwater: [],
    },
    camp: {
      walls: {
        1: {
          points: [[25.5, 9.2], [20.8, -17.4], [15, -21.4], [-21.4, -15], [-25.5, -9.2], [-20.8, 17.4], [-15, 21.4], [21.4, 15]],
          closed: true,
          gates: [{ x: 3.2, z: 18, rot: 0.175, width: 5, role: 'sea' }, { x: -3.2, z: -18, rot: -2.967, width: 5, role: 'land' }],
        },
        2: {
          points: [
            [33.6, 11.9], [27.5, -22.6], [20.5, -27.5], [-28.7, -18.8], [-33.6, -11.9], [-27.5, 22.6], [-20.5, 27.5], [-9, 25.4], [-5.9, 24.2],
            [2.3, 20.1], [4.8, 19.7], [13.8, 20.7], [17.1, 20.8], [28.7, 18.8],
          ],
          closed: true,
          gates: [{ x: 3.5, z: 19.7, rot: 0.175, width: 7, role: 'sea' }, { x: -4.1, z: -23.1, rot: -2.967, width: 6, role: 'land' }],
        },
        3: {
          points: [
            [36.8, -6.5], [32.8, -25.2], [27.7, -30.4], [19, -31.5], [-4.9, -27.9], [-28.7, -23.1], [-36.4, -19.1], [-39.4, -12.5], [-37.3, 6.6],
            [-32.8, 25.2], [-27.7, 30.4], [-19, 31.5], [3.6, 20.2], [28.7, 23.1], [32.3, 17], [34.8, 11.1],
          ],
          closed: true,
          gates: [{ x: 3.5, z: 19.9, rot: 0.175, width: 9, role: 'sea' }, { x: -4.9, z: -27.8, rot: -2.967, width: 7, role: 'land' }],
        },
      },
      streets: [
        { points: [[5.2, 28.2], [3.5, 19.9], [0, 0]], width: 5, from: 1 },
        { points: [[-23.7, 20.9], [29.5, 11.6]], width: 3, from: 2 },
        { points: [[-4.9, -27.8], [-2.7, -15.3]], width: 4, from: 1 },
      ],
      lots: [
        { kind: 'hall', x: -1.3, z: -7.4, rot: 0.175, w: 22, d: 15, y: 2.17, drop: 0, from: 1, rank: 0 },
        { kind: 'yard', x: 1.3, z: 7.4, rot: 0.175, w: 20, d: 11, y: 2.17, drop: 0, from: 1, rank: 0 },
        { kind: 'barracks', x: -15.1, z: 7.7, rot: 1.745, w: 16, d: 7, y: 2.17, drop: 0, from: 1, rank: 0 },
        { kind: 'barracks', x: 16.9, z: 2.1, rot: -1.396, w: 16, d: 7, y: 2.17, drop: 0, from: 1, rank: 1 },
        { kind: 'office', x: -20.6, z: -10.1, rot: 0.175, w: 11, d: 8, y: 2.17, drop: 0, from: 2, rank: 0 },
        { kind: 'store', x: 15.9, z: -16.5, rot: 0.175, w: 10, d: 8, y: 2.17, drop: 0, from: 2, rank: 0 },
        { kind: 'barracks', x: -25.1, z: 4.4, rot: 1.745, w: 16, d: 6.5, y: 2.17, drop: 0, from: 3, rank: 2 },
        { kind: 'barracks', x: 25.4, z: -3, rot: -1.396, w: 16, d: 6.5, y: 2.17, drop: 0, from: 3, rank: 3 },
      ],
    },
    town: {
      culture: 'korean',
      streets: [
        { points: [[-76, -40], [-152.4, 36.4]], width: 4, from: 1 },
        { points: [[-93, -57], [-169.3, 19.4]], width: 4, from: 1 },
        { points: [[-109.9, -73.9], [-186.3, 2.4]], width: 4, from: 2 },
        {
          points: [
            [-106.5, -9.5], [-110.8, -13.7], [-115, -17.9], [-119.3, -22.2], [-123.5, -26.4], [-127.8, -30.7], [-132, -34.9], [-136.2, -39.2],
            [-140.5, -43.4],
          ],
          width: 3,
          from: 1,
        },
        {
          points: [[-133.3, 17.3], [-137.5, 13], [-141.8, 8.8], [-146, 4.5], [-150.2, 0.3], [-154.5, -3.9], [-158.7, -8.2], [-163, -12.4], [-167.2, -16.7]],
          width: 3,
          from: 1,
        },
      ],
      lots: [
        { kind: 'tree', x: -106.5, z: -20.1, rot: 0.785, w: 7, d: 7, y: 0.97, drop: 0.85, from: 1, rank: 0 },
        { kind: 'well', x: -113.5, z: -8.8, rot: 0.785, w: 3, d: 3, y: 0.12, drop: 0.01, from: 1, rank: 0 },
        { kind: 'market', x: -125.1, z: -12.8, rot: -2.356, w: 16, d: 12, y: 0.64, drop: 0.59, from: 2, rank: 0 },
        { kind: 'pavilion', x: -142, z: 34.5, rot: -2.356, w: 8, d: 8, y: 0.52, drop: 0.43, from: 2, rank: 0 },
        { kind: 'house', x: -131.9, z: 4.5, rot: 0.785, w: 12, d: 8, y: 0.12, drop: 0.04, from: 1, rank: 6 },
        { kind: 'house', x: -141.1, z: 13.7, rot: 0.785, w: 9, d: 8, y: 0.32, drop: 0.25, from: 2, rank: 9 },
        { kind: 'house', x: -75.3, z: -29.4, rot: -2.356, w: 10, d: 8, y: 0.56, drop: 0.45, from: 1, rank: 0 },
        { kind: 'house', x: -85.2, z: -19.5, rot: -2.356, w: 13, d: 8, y: 0.21, drop: 0.1, from: 1, rank: 1 },
        { kind: 'house', x: -94.7, z: -9.9, rot: -2.356, w: 9, d: 8, y: 0.24, drop: 0.13, from: 1, rank: 2 },
        { kind: 'house', x: -103.6, z: -1.1, rot: -2.356, w: 11, d: 8, y: 0.26, drop: 0.16, from: 1, rank: 3 },
        { kind: 'house', x: -112.8, z: 8.1, rot: -2.356, w: 10, d: 8, y: 0.11, drop: 0.02, from: 1, rank: 4 },
        { kind: 'house', x: -123, z: 18.3, rot: -2.356, w: 14, d: 8, y: 0.11, drop: 0.01, from: 2, rank: 7 },
        { kind: 'house', x: -132.9, z: 28.2, rot: -2.356, w: 9, d: 8, y: 0.16, drop: 0.08, from: 2, rank: 10 },
        { kind: 'house', x: -142.1, z: -19.1, rot: 0.785, w: 11, d: 8, y: 1.07, drop: 0.98, from: 1, rank: 5 },
        { kind: 'house', x: -151.3, z: -9.9, rot: 0.785, w: 10, d: 8, y: 0.43, drop: 0.36, from: 2, rank: 8 },
        { kind: 'house', x: -161.6, z: 0.3, rot: 0.785, w: 14, d: 8, y: 0.87, drop: 0.79, from: 2, rank: 11 },
        { kind: 'house', x: -171.5, z: 10.2, rot: 0.785, w: 9, d: 8, y: 1.14, drop: 0.98, from: 2, rank: 14 },
        { kind: 'house', x: -170.8, z: -24.4, rot: 0.785, w: 14, d: 8, y: 1.62, drop: 1.13, from: 2, rank: 12 },
        { kind: 'house', x: -180.7, z: -14.5, rot: 0.785, w: 9, d: 8, y: 1.09, drop: 0.72, from: 2, rank: 13 },
      ],
      walls: [
        {
          points: [
            [-181.8, 10.5], [-171.9, 20.5], [-133.3, 38.5], [-95.1, 0.4], [-84.4, -10.3], [-64.7, -30.1], [-74.6, -40], [-168.7, -36.4],
            [-182.8, -22.3], [-191, -14.2],
          ],
          closed: true,
          gates: [{ x: -73.1, z: -38.5, rot: 2.356, width: 6, role: 'land' }, { x: -149.8, z: 30.8, rot: -0.436, width: 6, role: 'land' }],
          from: 3,
        },
        {
          points: [
            [-117.7, -50.6], [-119.1, -49.2], [-120.5, -47.8], [-122, -46.4], [-123.4, -44.9], [-124.8, -43.5], [-126.2, -42.1], [-127.6, -40.7],
            [-129, -39.3], [-130.4, -37.9], [-131.9, -36.5], [-133.3, -35.1], [-134.7, -33.6], [-136.1, -32.2], [-137.5, -30.8], [-138.9, -29.4],
            [-140.3, -28], [-141.8, -26.6], [-143.2, -25.2], [-144.6, -23.7], [-146, -22.3], [-147.4, -20.9],
          ],
          closed: false,
          gates: [],
          from: 2,
        },
      ],
    },
    works: {
      shipyard: { kind: 'shipyard', x: 61.3, z: -0.4, rot: 1.41, w: 24, d: 28, y: 1.91, drop: 1.9, shore: -6 },
      dock: { kind: 'dock', x: 70.3, z: -26.2, rot: 1.298, w: 20, d: 26, y: 2.94, drop: 2.7, shore: -5 },
      battery: { kind: 'battery', x: 61.7, z: -73.5, rot: 1.571, w: 18, d: 12, y: 1.1, drop: 0 },
      granary: { kind: 'granary', x: -13.5, z: -50.2, rot: 0.262, w: 22, d: 16, y: 2.25, drop: 0 },
      beacon: { kind: 'beacon', x: -48, z: -56, rot: 0.175, w: 14, d: 12, y: 14.83, drop: 0 },
    },
    fields: [],
    roads: [
      {
        to: 'ulsan',
        points: [
          [-5.3, -29.8], [-4.8, -33.8], [-5.2, -37.7], [-4.6, -41.7], [-1.2, -43.8], [0.9, -47.2], [4.7, -48.5], [3.4, -52.3], [3.1, -56.3],
          [7.1, -56.7], [11.1, -57.2], [15, -57.7], [19, -58.3], [18.5, -62.2], [21.2, -65.1], [25, -66.6], [28.7, -68.1], [31.3, -71.1],
          [34.6, -73.4], [33.1, -77.1], [36.8, -78.6], [40.5, -80.2], [44.4, -81], [48.3, -81.9], [52.2, -82.8], [51.3, -86.7], [54.9, -88.5],
          [58, -91], [60.4, -94.2], [62.1, -97.9], [63.7, -101.5], [64.5, -105.4], [64.5, -109.4], [64.5, -113.4], [65.4, -117.3],
        ],
        width: 3,
      },
    ],
  },
  noryang: {
    id: 'noryang',
    u: 0.568525,
    v: 0.2498418,
    seaward: [0.174, 0.985],
    radius: 205,
    value: 1,
    seat: false,
    pads: [
      {
        id: 'core',
        poly: [
          [29.5, -5.2], [37, -21.9], [34.9, -26.9], [32.6, -30.3], [29.6, -32.6], [25.7, -33.8], [20.7, -34.2], [13.8, -33.8], [-5.4, -30.5],
          [-24.5, -27], [-31.1, -25.1], [-35.7, -23], [-38.9, -20.5], [-41, -17.3], [-41.9, -13.3], [-42.3, -8], [-39.9, 7], [-24.5, 14.5],
          [-20.2, 15.6], [-20.1, 18.7], [-20.2, 22.2], [-18.4, 24.3], [-17.6, 29.1], [-13.1, 31.9], [5.4, 30.5], [21.2, 23.3], [25.3, 20.4],
          [29, 18.7], [31, 16.3], [30.9, 13], [31, 9.8], [23.6, 4.4],
        ],
        h0: 1.2,
      },
      { id: 'battery', poly: [[-105.8, 41.9], [-85.8, 41.9], [-85.8, 27.9], [-105.8, 27.9]], h0: 0.59 },
      { id: 'granary', poly: [[-17.5, -30.4], [6.1, -34.6], [3, -52.3], [-20.7, -48.1]], h0: 2.28 },
      { id: 'beacon', poly: [[-64.7, 28.3], [-48.9, 25.5], [-51.3, 11.7], [-67.1, 14.5]], h0: 13.75 },
    ],
    harbour: {
      quay: [
        [-20.4, 31.5], [-20.2, 33.2], [-19.1, 34.8], [-17.2, 35.1], [-15.3, 35.1], [-13.3, 35], [-11.2, 35.2], [-9.1, 35.2], [-7.3, 36.3],
        [-5.6, 37.6], [-5.1, 39.6], [-4.7, 41.5], [-3.6, 43.1], [-1.7, 43.5], [0.2, 43.6], [2.1, 44.4], [4, 44.3], [5.9, 44], [7.8, 44.2],
        [9.7, 43.7], [10.6, 42], [11.9, 40.6], [13.5, 39.4], [14.4, 37.6], [15.5, 36], [16.4, 34.3], [16.5, 32.5], [15.8, 30.3], [16.8, 28.3],
        [18.9, 27.5], [21, 27.1], [22.9, 26.3], [24.8, 25.8], [26.4, 24.6], [28, 23.4], [29.7, 22.5], [31.6, 21.7],
      ],
      span: { 1: [35.6, 35.6], 2: [24.6, 46.6], 3: [9.6, 61.6] },
      gate: { x: 7.8, z: 44.2, rot: 0.175 },
      piers: [
        { x: 7.8, z: 44.2, rot: -0.108, len: 13.5, width: 3, from: 1, berths: [{ x: 0.1, z: 58.5, rot: -0.108 }, { x: 12.3, z: 59.8, rot: -0.108 }] },
        { x: 19.7, z: 27.4, rot: 0.221, len: 17.5, width: 3.5, from: 2, berths: [] },
        { x: -10.2, z: 35.2, rot: 0.01, len: 19.5, width: 4, from: 3, berths: [] },
      ],
      anchorage: [
        { x: 73.8, z: 89.2, rot: 0.175 },
        { x: 70.8, z: 116.2, rot: 0.175 },
        { x: 88.8, z: 110.2, rot: 0.175 },
        { x: 100.8, z: 107.2, rot: 0.175 },
        { x: 76.8, z: 143.2, rot: 0.175 },
        { x: 64.8, z: 152.2, rot: 0.175 },
        { x: 106.8, z: 134.2, rot: 0.175 },
        { x: 91.8, z: 155.2, rot: 0.175 },
        { x: 142.8, z: 86.2, rot: 0.175 },
        { x: 79.8, z: 170.2, rot: 0.175 },
        { x: 67.8, z: 179.2, rot: 0.175 },
      ],
      breakwater: [],
    },
    camp: {
      walls: {
        1: {
          points: [
            [22.4, 8.1], [22.5, 5.6], [23.7, 0.3], [23.4, -2.6], [20.8, -17.4], [15, -21.4], [-21.4, -15], [-25.5, -9.2], [-22.4, 8.5],
            [-21.4, 11.2], [-18.3, 12.4], [-17.1, 14.2], [-16.6, 16.5], [-16.3, 19.3], [-15, 21.4], [21.4, 15], [24.1, 11.1],
          ],
          closed: true,
          gates: [{ x: 3.2, z: 18, rot: 0.175, width: 5, role: 'sea' }, { x: -3.2, z: -18, rot: -2.967, width: 5, role: 'land' }],
        },
        2: {
          points: [
            [23.2, 8.2], [22.8, 6.2], [23.4, 4.4], [23.7, 2.4], [25.3, -4.5], [28.4, -13.7], [28.5, -16.9], [27.5, -22.6], [20.5, -27.5],
            [-28.7, -18.8], [-33.6, -11.9], [-30.5, 5.4], [-29.7, 8.2], [-23.2, 11.2], [-18.5, 13], [-17.6, 14.5], [-17.1, 16.5], [-16.9, 19.1],
            [-16.2, 21.7], [-15.5, 23.7], [-14, 25.1], [-11.6, 25.4], [-9, 25.4], [17.1, 20.8], [19.6, 19.9], [23.7, 17.8], [27.3, 14.8],
            [25.2, 11.2],
          ],
          closed: true,
          gates: [{ x: 4.1, z: 23.1, rot: 0.175, width: 7, role: 'sea' }, { x: -4.1, z: -23.1, rot: -2.967, width: 6, role: 'land' }],
        },
        3: {
          points: [
            [26.1, -4.6], [32.8, -25.2], [27.7, -30.4], [19, -31.5], [-4.9, -27.9], [-28.7, -23.1], [-36.4, -19.1], [-39.4, -12.5], [-35.7, 6.3],
            [-18.2, 14], [-17.6, 19.3], [-15.6, 25.8], [4.9, 27.9], [23.3, 18.8], [28.3, 14.9], [23.4, 7.4],
          ],
          closed: true,
          gates: [{ x: 4.9, z: 27.8, rot: 0.175, width: 9, role: 'sea' }, { x: -4.9, z: -27.8, rot: -2.967, width: 7, role: 'land' }],
        },
      },
      streets: [
        { points: [[7.8, 44.2], [4.9, 27.8], [0, 0]], width: 5, from: 1 },
        { points: [[-12.9, 19], [22.6, 12.8]], width: 3, from: 2 },
        { points: [[-4.9, -27.8], [-2.7, -15.3]], width: 4, from: 1 },
      ],
      lots: [
        { kind: 'hall', x: -1.3, z: -7.4, rot: 0.175, w: 22, d: 15, y: 1.2, drop: 0, from: 1, rank: 0 },
        { kind: 'yard', x: 1.3, z: 7.4, rot: 0.175, w: 20, d: 11, y: 1.2, drop: 0, from: 1, rank: 0 },
        { kind: 'office', x: -20.6, z: -10.1, rot: 0.175, w: 11, d: 8, y: 1.2, drop: 0, from: 2, rank: 0 },
        { kind: 'store', x: 15.9, z: -16.5, rot: 0.175, w: 10, d: 8, y: 1.2, drop: 0, from: 2, rank: 0 },
        { kind: 'barracks', x: 17, z: 1.6, rot: -1.396, w: 20, d: 6.5, y: 1.2, drop: 0, from: 3, rank: 0 },
        { kind: 'barracks', x: -31.4, z: -5.1, rot: 1.745, w: 16, d: 6.5, y: 1.2, drop: 0, from: 3, rank: 1 },
      ],
    },
    town: {
      culture: 'korean',
      streets: [
        { points: [[104, -100], [33.3, -29.3]], width: 4, from: 1 },
        { points: [[87, -117], [10.7, -40.6]], width: 4, from: 1 },
        { points: [[70.1, -133.9], [-6.3, -57.6]], width: 4, from: 2 },
        {
          points: [[75.7, -71.7], [71.5, -76], [67.2, -80.2], [63, -84.4], [58.7, -88.7], [54.5, -92.9], [50.3, -97.2], [46, -101.4], [41.8, -105.7]],
          width: 3,
          from: 1,
        },
        {
          points: [[51, -47], [46.7, -51.2], [42.5, -55.5], [38.2, -59.7], [34, -63.9], [29.8, -68.2], [25.5, -72.4], [21.3, -76.7], [17, -80.9]],
          width: 3,
          from: 1,
        },
      ],
      lots: [
        { kind: 'tree', x: 95.5, z: -102.1, rot: 0.785, w: 7, d: 7, y: 1.64, drop: 0.76, from: 1, rank: 0 },
        { kind: 'well', x: 69, z: -71.4, rot: 0.785, w: 3, d: 3, y: 1.09, drop: 0.23, from: 1, rank: 0 },
        { kind: 'market', x: 66.3, z: -84.2, rot: -2.356, w: 16, d: 12, y: 2.44, drop: 1.33, from: 2, rank: 0 },
        { kind: 'pavilion', x: 43.2, z: -30.7, rot: -2.356, w: 8, d: 8, y: 0.32, drop: 0.14, from: 2, rank: 0 },
        { kind: 'temple', x: 32.4, z: -110.5, rot: 0.785, w: 14, d: 12, y: 2.35, drop: 1.1, from: 3, rank: 0 },
        { kind: 'house', x: 86.3, z: -93.6, rot: 0.785, w: 12, d: 8, y: 1.98, drop: 0.93, from: 1, rank: 1 },
        { kind: 'house', x: 60.2, z: -67.5, rot: 0.785, w: 9, d: 8, y: 1.73, drop: 0.79, from: 2, rank: 8 },
        { kind: 'house', x: 51.7, z: -59, rot: 0.785, w: 10, d: 8, y: 1.81, drop: 0.8, from: 2, rank: 13 },
        { kind: 'house', x: 41.8, z: -49.1, rot: 0.785, w: 13, d: 8, y: 1.23, drop: 0.59, from: 2, rank: 16 },
        { kind: 'house', x: 32.2, z: -39.5, rot: 0.785, w: 9, d: 8, y: 1.2, drop: 0.67, from: 3, rank: 20 },
        { kind: 'house', x: 104.7, z: -89.4, rot: -2.356, w: 10, d: 8, y: 2.2, drop: 1.3, from: 1, rank: 0 },
        { kind: 'house', x: 94.8, z: -79.5, rot: -2.356, w: 13, d: 8, y: 2.57, drop: 1.23, from: 1, rank: 2 },
        { kind: 'house', x: 85.3, z: -69.9, rot: -2.356, w: 9, d: 8, y: 1.63, drop: 0.76, from: 1, rank: 4 },
        { kind: 'house', x: 76.4, z: -61.1, rot: -2.356, w: 11, d: 8, y: 1.08, drop: 0.65, from: 2, rank: 7 },
        { kind: 'house', x: 67.2, z: -51.9, rot: -2.356, w: 10, d: 8, y: 0.67, drop: 0.46, from: 2, rank: 12 },
        { kind: 'house', x: 57, z: -41.7, rot: -2.356, w: 14, d: 8, y: 0.51, drop: 0.35, from: 2, rank: 15 },
        { kind: 'house', x: 76.1, z: -117.3, rot: 0.785, w: 11, d: 8, y: 2, drop: 1.18, from: 1, rank: 3 },
        { kind: 'house', x: 66.9, z: -108.1, rot: 0.785, w: 10, d: 8, y: 2.12, drop: 1.27, from: 1, rank: 5 },
        { kind: 'house', x: 56.6, z: -97.9, rot: 0.785, w: 14, d: 8, y: 2.29, drop: 1.14, from: 1, rank: 6 },
        { kind: 'house', x: 46.7, z: -88, rot: 0.785, w: 9, d: 8, y: 2.8, drop: 1.13, from: 2, rank: 10 },
        { kind: 'house', x: 35.4, z: -76.7, rot: 0.785, w: 12, d: 8, y: 2.87, drop: 1.36, from: 2, rank: 14 },
        { kind: 'house', x: 20.9, z: -62.2, rot: 0.785, w: 12, d: 8, y: 2.73, drop: 1.2, from: 2, rank: 18 },
        { kind: 'house', x: 11.7, z: -53, rot: 0.785, w: 9, d: 8, y: 3.21, drop: 1.28, from: 3, rank: 21 },
        { kind: 'house', x: 58, z: -133.2, rot: 0.785, w: 14, d: 8, y: 2.77, drop: 1.17, from: 2, rank: 9 },
        { kind: 'house', x: 48.1, z: -123.3, rot: 0.785, w: 9, d: 8, y: 2.51, drop: 1.34, from: 2, rank: 11 },
        { kind: 'house', x: 22, z: -97.2, rot: 0.785, w: 12, d: 8, y: 2.47, drop: 1.26, from: 2, rank: 17 },
        { kind: 'house', x: 11.7, z: -86.9, rot: 0.785, w: 12, d: 8, y: 2.56, drop: 1.29, from: 2, rank: 19 },
        { kind: 'house', x: 2.5, z: -77.7, rot: 0.785, w: 9, d: 8, y: 2.5, drop: 1.3, from: 3, rank: 22 },
      ],
      walls: [
        {
          points: [
            [62.3, -110.6], [60.9, -109.2], [59.5, -107.8], [58, -106.4], [56.6, -104.9], [55.2, -103.5], [53.8, -102.1], [52.4, -100.7],
            [51, -99.3], [49.6, -97.9], [48.1, -96.5], [46.7, -95.1], [45.3, -93.6], [43.9, -92.2], [42.5, -90.8], [41.1, -89.4], [39.7, -88],
            [38.2, -86.6], [36.8, -85.2], [35.4, -83.7], [34, -82.3], [32.6, -80.9],
          ],
          closed: false,
          gates: [],
          from: 2,
        },
      ],
    },
    works: {
      shipyard: { kind: 'shipyard', x: -16.1, z: 85, rot: 1.505, w: 24, d: 28, y: 2.3, drop: 2.29, shore: -6 },
      dock: { kind: 'dock', x: -29.6, z: 41.7, rot: 0.588, w: 20, d: 26, y: 1.06, drop: 1.05, shore: -5 },
      battery: { kind: 'battery', x: -95.8, z: 34.9, rot: 0, w: 18, d: 12, y: 0.59, drop: 0 },
      granary: { kind: 'granary', x: -7.3, z: -41.4, rot: 0.175, w: 22, d: 16, y: 2.28, drop: 0 },
      beacon: { kind: 'beacon', x: -58, z: 20, rot: 0.175, w: 14, d: 12, y: 13.75, drop: 0 },
    },
    fields: [],
    roads: [
      {
        to: 'waegyo',
        points: [
          [-5.3, -29.8], [-8.9, -31.4], [-12.5, -29.6], [-16.3, -28.6], [-20, -30.2], [-23.1, -27.6], [-26.9, -26.5], [-30.9, -27.2], [-34.8, -26.9],
          [-38.3, -25], [-42.2, -23.8], [-45.9, -25.3], [-49.9, -25.8], [-50.5, -21.8], [-51.1, -17.9], [-54.6, -15.9], [-56.2, -12.2], [-58.5, -9],
          [-60.2, -5.4], [-63.3, -2.8], [-67.1, -1.8], [-70.2, 0.7], [-73.3, 3.3], [-76.4, 5.8], [-77.3, 9.7], [-78.3, 13.6], [-79.4, 17.4],
          [-81.3, 20.9], [-85.3, 20.7], [-89.3, 21.4], [-90.4, 25.2], [-93.7, 27.5], [-97.5, 26.4], [-101.1, 24.5],
        ],
        width: 3,
      },
    ],
  },
};

/** Each fixture's ground: the grid's first sample in the site's frame, its spacing and size, the heights (Int16 cm, little-endian, rows of x). */
const GRID: Record<FixtureId, { x0: number; z0: number; step: number; nx: number; nz: number; heights: string }> = {
  yeosu: {
    x0: -138, z0: -159, step: 3, nx: 102, nz: 103,
    heights:
      'DQHzAPgAZgHSAZYBEwEZAY4BVwIkA6cD8QMjBKkDuwI9Ap4C/wKjAvYBOQFcAaAB7gF7AlECqwH5AKYAIgEfAlYDEwSsAwUDDgNFAykDUgMzA5ACLQJHAs4CsAKzAcsAXABcAP4ADQIf' +
      'AzMDdQK4ARkBNAE0AbUANAA/ALwALwE+AfwApwBbAIIAlABmAGwApwD6ACABZgFbAVcBSAEFAdoAugBrAFEAOAAeABcAMgBLAGQAYABKAFcAZQBrAGQAXABSAD8AKwAfAB0AxQDHAMkA' +
      'AAFUAWABAQHyAFcBTQIJAyIDKANCAxcDgQL2ATgCWwL5AXsBBQHtABoBRgGGAY0BDwGmAJMAEAHtAe8CpwMoA4sCqwLvArACjQKfAjoCwAEoArMChAKeAdEAUABPAPUA8AHXAtQCHQJK' +
      'AbsAwwAAAbIAOgBPAMkADgEPAeYAkABIAFkAawB0ALAA8ABbAfsBcgKLAnUCNQKvASsB1ACCAGkASgAhAA8AKwBMAGwAcgBZAEYATgBUAFIASgA8ACgAIwArACoA5ADHALsA1QAdATwB' +
      '7gDMAAYB0QFUAmQCZwJOAkIC+gGbAToCjgIKAnIB8gC2AMcA/QAUAQYBrwCBAIoACQG6AbgCaQMRA0cC/gEzAkQC/AHSAbcBeAEJAooCOQKHAbIAQwBOAOQAzAFUAk0CuQEOAX0AbwCa' +
      'AH4ANwBhAOcAIgEoAcQAagBCAEkAYACzAPUAUAEkAjADxgPUA44DIANeAoEB6gCYAHIASQAgABAAGwA8AF0AWgBGAEwAOQA9AD8AOAAmACAALwA5ADgANgHrAKkArQDTAPkA6QC6AMwA' +
      'MQGmAbMBvgGfAX4BTAE8AfkBogKGAusBPAG4ALoA9QDjALUAjABrAKwADgHDAaQCaAMRAz0CtwF6AZ4BngFuAUMBPwGaASYC8QFQAYoAOABLALMAYwG2AfgBrgElAaUAjwBzADYALQBo' +
      'APsANQESAaQASgA9AEIAZQC6ABEB9QETAy4E8wS0BO8DMgOKAsYBFAGtAHEASAAfABMADwAtAEMANQA8AFcATQArACwAIgAdACwAOgBHAEYA1AFqAecAowCUAL8A0QC4AL8ANwGTAX0B' +
      'rwGzAWAB+wD3AJ4BZQK+AjECYAHcALAA9gDWAJ8AfQCAAL4AJgH/AeoCyQN0A3wCuQEpAS0BOAETAf4AAAErAXsBmAEWAWYAGwA/AJUAyQAWAbAB1AFUAeQA4gC+AFwAKwBiAMQA3wCn' +
      'AGMAOwA8AE4AZgCyADgBNQJvA7EEewUdBUAEpAMTA3gCdwHXAHUARgAfABUADwAdAB4AIwBBAF8AYgA+ABsAGgAoADUAQwBRAEsArQIgAmkBxQCNAIcAmQChAMEAOwF7AU8BfQGbAT8B' +
      '4wDOAD4B5wFsAicCTQHaAMoACwHiAJAAcQCeANQAVAEnAk8DRwQcBAMDCgJVAQsB1AC+AL0AwQDLAOkAFwHKAFAAHQArAGwAigCjAFMBzQFzARABKAHwAHYAIwBGAGEAZwA2ADAARQBb' +
      'AGoAfgC1AFcBZQKnA+sE1wXrBXkF5gQ1BC8DHAIVAYMASwAgABgAEQAIAAsAKwBRAGAARQAmABYAFAAcACgANQBCAEMAygJuAsEBGwGWAHQAdQCCAKoAKAFAASYBPQFQASkB2gCvAOgA' +
      'IgFtAVIB3wCeAMoAHgHpAIkAhQDAAAkBgAFPAnwDPQQsBHUDWgKcASsB3gCnAIoAmQCrAJMAqgCYAFsAHAAwAF4ASgBTAO8APAELARABAAHXAG0AKgAlACwAIAAgADkAbQCDAJAAnQC5' +
      'AFQBWwKRA7EE8gXXBsYG9AXWBLgDiAJXAZgASgAgAAsAAQD9/yMARgBNAEYAJwAYABkAGAAVABkAJQAyADYAYgIlAsIBKwGoAGMAagBxAIkAyQDeABsBNAFBAQwB3QC7AJsAqgC9AJwA' +
      'fQCDALgA7AC3AG8AygAkAWcBogFqAlQDrAOyAz4DdQLOATUB2wCwAIMAhgCNAHUAWgBdADIAFgAgAEUAPwAtAG4AngDBANYAuQCVAHUARwA/ACwAJQAoAFYAfAB/AIMAiACuAC0BBAIP' +
      'AxcENwV2BrQGywWRBIADXgI/AaQARwAjAAsA+P/5/zMAOwBCACgAGwAcAB0AGwAZABYAFgAiACYAGgIIAm0B3wCIAFwAZABuAHYAmADFABgBbgGvAY4BMwEfAeAAnACAAHAAagBoAJMA' +
      'ggBlAHAA0gBQAakBugGBAgMDEwMfA70CCgK9AUEB0QCqAAEBJQEIAY8ATQAnACAAGwAZACYALAAjACMAXQB/AJYAbwBoAGoAlACKAHIAVgA6AEIAUwBOAE0AcwCiAPoAsAHIAqYDIQQk' +
      'BXgFuATkAwgD7QHzAIUAOAAoAAUA9f/4/yIAMAAoAB4AHwAfACAAHwAcABoAFwAUABYAwAHkAVwBqAB4AIEAegB7AIMAiwDEAAoBfwG7AZ0BSwFkAX4BGQGjAGQAYABcAFgAUABIAGIA' +
      'wgBLAZYBhAESAncCiAKDAjkCpwFwATMBwwC0AFEBBgLrATABfABAACUAHwAeAB8AIQAiACEAIwBQAHQAXwCWAK8AygCiAIYAYwBiAGUAZgBiAF8AZACUAMcAUAFGAqUC+wJ4A7oDRgPn' +
      'AmMCnwHBAGMALwAgABMA/v/7/wcAJAAhACEAIgAjACQAIgAgAB0AGQARAP//iwFfAfsAggCJAKgAogAPARwBEgH4APIA/AAYAR8BOgGPAdkBdwEAAYwATQBJAEUAQQA9AE4AnAAhAWQB' +
      'OgFzAcwB/gHuAegBkgEnAeQAvwDQAG4BJAJRAqsB4QB8ADwAIwAiACQAYgBzAD8ASgA/AFIAcgC3AOQAswCDAFMARQBfAHUAkACQAI4AkQB8AKsA2QCKAdwBcgLpAtwCIgLTAYkB/QCH' +
      'AEYAKAAUAP3/+//8/wYAFwAYACQAJQAmACcAJgAjABwAFAAMAAMA5wFBAc4AbABYAJQADwHQAQQCowHyAJsAowDYABMBTwGXAbMBhwFSAd4AXwA6ADYAMwAwAD8AdQDwADAB/gDsAEoB' +
      'qAHJAcoBggEnAfYA5QAAAV0B8wF6AjUC0QETAZ4ATQAoACwAkQC6AGgAewCDAEwAcwChAJUAawA/AC0ALAAzAEgAZQCIAJkAewBhAI8AvgACAdgBkQIvA+MCCwJOAc0AeQBRADAAHgAQ' +
      'AAIA/f/9//7/CgAHAAgAEwAjACoAKAAhABoAEwANAAMAuALjAe4AaQBVAKQAMgEPAl8CtQHVAHMAmwDKAAABLgFLATwBFwHoANIAdgAwACwAKgAoADYAZADlACUB6QDJAAIBTQGOAZkB' +
      'bgEwARwBLAFbAZEBBwKiAvICqwLNAegAbABAADIAlQC8AHoAggCLAGQASABZAEUAKQAlACMAIQAmACsANABhAIMAYQBFAG8AlADZAFkBLwLwAskCGQJLAZIAVAA1ABQADgACAP7//P/9' +
      '//7///////////8BAB8AIQAfABkAFAAQAP3/tAISAhkBdQBgAKkAKwHuAfcBNwGMAHUApADPAPYA9QDqAMYAoQB+AHsAWQAyACMAIQAfAC4AXgDHAOsAvQDQAA4BVQFKAWIBPgE3AUQB' +
      'ZQGIAcQBTQIFA4sDKAMjAigBlwBoADcAjgDBAIgAbgBpAFQAOAAqACEAHwAcABkAFwAbAB4AOABeAGwAUwAwAEUAagC1AB0B9wGZAi4CjgHsAHAALwASAPz/+f/6//3//v/9//3//P/9' +
      '//z//P8AABQAEQARABIACQD///3/PALaAREBfgBZAI8AIwGSAV8BsABWAHgAoADHAO8A8gDbAKwAegBrAFAAQQAzAB4AGwAZACEATACTALAAwAD0AH4BjQGOAYoBXQFaAWQBWwE9AakB' +
      'CAKUAvkC/wI9AlUBpABcAD4AWwCMAHYAXQBJADMAHgAPAB0AHQAUABAADAAPABkAPQBNAFMASAAhABoAPwCXADQBPwLEAksCaAGjAE8AGwANAPf/6f/0//z////+//z/+v/6//3/+//9' +
      '//7/AgAIAAkAAAD+//3/vQFcAcUAXgBLAGcAvAAZAc0AZQBHAGcAlQDAAOgA6wDOAKYAiwCUAH4AXwBGABsAGQAbAB8AYwDVAOYA2wBHAdIB9gH6AesBqAGDAYQBNAH9AFABkgGhAb4B' +
      'zQGsAREBrgBwAEgALABJAFcAbgA1ABYAAQD//xkAHQATAAkAAQD//x4ALQAyADgAPAATAP//OACNANkAugFvAi8CSgF6ADQA8P/n/+L/4v/x//z/AAD+//v/+P/4//r/+//7//z//f/+' +
      '//7//f/7//z/XQELAZ8AVQA8AEcAWQCaAHgAQgA8AE8AfQCrANcA3gDBAKkAsQC6ALIAfQBUABkAHAAfACIAeAAWASwBBAGKARICfAJoAkkCDgLUAaQBFAHHAOgAEAH9AOcA4QDkALQA' +
      'hQBjAEMAKwBRAJIAgAAvABMACQDu/wMAHAAMAP7/AAD4/xkAEgAXAB0AKAAMAPz/QABiAHwA0gBRAUkBqABXABQA6P/m/+r/8P/3//3////+//v/+f/5//r/+//7//r/+v/5//n/+f/6' +
      '//z/YQFNAdEAfQA8ADEAMwA0ADkALwAxADgAYgCEAKEAsgCzAJcAiQCaAKAAhgBXABYAGgAeACMAlgAwAWUBVQG4AVcCwgKeAkUCAQLHAYQBAQGbAK4AxwCtAIUAgACSAH8AUgAzADQA' +
      'SQBfAIMAbQAlABcACADx//7/EwAIAP7////7/zEAHwD//xUAGgD+//7/JQA2AEEAgQCLAJAAdABhAFsAUwBUACIADAAHAAAA/P/8//z/+//7//v/+//7//r/+f/4//f/+f/7//z/5QH3' +
      'AWcBtwBPACoAKgAoACcAKAAqADYASQBWAGYAdgCGAIcAcQBZAE0APgA2ABIAFwAcACEAfQAsAcABrAHZAXsCxgJrAgUCuAF6AUsBzwB6AHIAfgB+AFwATwBUAD8AKgAxADUAOAA7AD0A' +
      'OwAcABAAAwD4//7/DwAGAP3/AwAVAOL/+f/4//3//P/+/wkAEgAeACcAWABTAF0AmgDNAPgADgGgAHwAOQAxABMA+f/5//z//v/9//z/+//7//r/+f/4//j/+v/9//7/HgJqAusBBgGA' +
      'ACIAIgAjACQAJQAmAEgAcQBxAFIAUgBeAGoAWQBAACkAIAATAA8AFQAaAB8AYAANAfIBSQJHAssCIwPCAhoCwQGCARwBnQBbAFIASQBJADcAKwAiACIAJQAlACQAJAAjACMAJgAcAA4A' +
      '///9//7/BQAFAAAA/f/6/xMAFgD6//3///8JAAkACgAIAA0AIQBPAJQA2gCVATAC/AFyAdwAhgBaADMABQD3//z///////3//P/7//r/+v/5//n/+//+/wAApAEwAg0COgGOACUAJAAj' +
      'ACMAIgAiAFUAiwCGAF8AQQBBAE0APgAnAB8AGgAOAAoAEgAZAB4AWQDxAOsBkAKKAs0CDQPlAlwC2AFrAewAawA8ADMALQArACcAIQAcAB4AIgAiACEAIQAhACMAKgAqABYACQD///3/' +
      '/f/8//z/+//7//v/+//9////CgAKAAUA/v/8//3/KABhAJwA4QCyAXgCrAJLAqUBFgGsADQA/f/4//r//P/9//7//f/7//v/+//7//v/+//7//3/4QCBAYgBHwFlACoAKQApACcAIwAg' +
      'AE0AhgCDAFYAQgA6AC8AJQAbABcAEwAJAAcACgAUABwAVgDbAKIBFwI+AkUCXQJVArYBNAHjAJQANwAhACIAIwAjABwAGgAWABsAHwAfAB8AHgAgACcALwA4ACQAEgAHAP7/+v/5//n/' +
      '+//7//z/+//9/wQACgAMAAEA9f/1/wEASQBiAHsAtgAzAeUBewJxAhoCWwGzAEIAFQABAPj/+//6//3//f/8//v//P/9//z/+f/0//T/iwC+APkAuwBDAC8ALAAoACQAIQAdAD4AcgBs' +
      'AE4APwBOAC4AHAAVAA8ACwAGAAMAAgAFABIAOQCEABgBawGsAboBmgGAARcBvgB0ADUAHgAaABoAGwAbABAAEAARABgAHAAcABwAHAAkACwAMwA7ADsA4v8UAP3/+f/4//n/+v/7//v/' +
      '+v/7////BwABAAQA6v/1/xQAZQDFAAIB+ABSAccBNwIrAgECdQHDAHAANwANAPj/9f/7//z//f/7//v//P/+//3/9v/t/+3/aQCEAJYAUgAzAC0AKQAmACIAHgAaAC8AUwBLAEEAPQBf' +
      'AEgAOwAwACUAFQD///r/7f/2/wwAKgBSAKUA6AAlAToBIwHoAK4AZwBBACwAGQAXABUAEwASAAIA//8PABQAGgAZABoAIQAoADAANwA/AFEA4v/i/wQA+P/4//n/+f/5//j/9//5////' +
      'BgD+/+v/4//7/zIAoQBKAeYB2gHzAWICwAJ+Aj8CpgHyAJwAOQADAPX/+P/9//7//P/7//r//P////7/9f/p/+7/kAB5AF4ARQA1ACoAJgAiAB8AGwAXACAAMQApAD4AUAB3AGcAXABM' +
      'ADgALQAiABYA///9////FAAuAGAAiQCnALEAsgCIAFYATgA7ACYAFQAUABIAEAANAP3/AAANABEAFwAXAB0AJQAsADIAMwA5AHgAIAD5//v//v/4//f/9v/1//b/9v/5////BQD7/+f/' +
      '4//9/ykAkgA5ASwCuAKcAngC2AIaA/ECLwI+AZsANADz//X//P8CAP///P/7//v//f////7/9f/s//n/uACwAIMARAA3ACwAIgAeABsAFwAUABMALABgAIUAhwCQAIQAdQBhAE0AOAAk' +
      'ABYAEAD+//v//v8OADoAQwBVAFIASQA4AD0APwAwAB8AEgAQAA8ADgAAAPb/+f8IABAAFAAYABoAGwAbABwAIgBZAGcAVgD4//r/BwD2//T/8v/z//X/9//6////AgD5/+r/7P8IADYA' +
      'bwATARwCyAJwAtoBQgIhA3MDnAJlAaMAQwAHAPj//v8EAAAA/P/8//3//v////3/9//5/xoA6wD2ALwAUgBCAC8AIwAaABcAEwARABUAYQC0AMEAvACcAIQAcABcAEgAMwAfABUAEgAK' +
      'APz/+v/8/wgAIQA8ADUAJAAnACgAMAAZABMADgAMAAsAAgD4//H/8v/5//3/AQABAAMABAAFAAkALwA9AEMAhQD6//f//f/z//D/7v/w//X/+P/6//3//v/7//j/AwAXADwAZQDlAKoB' +
      'IgLRAW8BywG/AjMDaQJzAc8AZwAWAPj//v8CAP///f/9//3/+v/5//r/AAAaAEcAKQEsAc0AYwBjAEsAMgAbABMAFgAZABwAQQC2AN8AwwCZAH0AawBXAEMALgAaABMAEAAPAA0A/f/5' +
      '//v/CQAeABgAFAAdABwAGwAPAPT/+f/9/wUA/v/4//P/9f/8/wAADwADAPr/9f/4/wQAEwAaACIAMgD6//b/9f/x/+3/6//u//L/9f/2//b/+//+/xEAPABMAFoAUQCGAOYAQgFLAUwB' +
      '4wGEAmsCwgElAZYAYgAKAPn/+//9//7///////j/6//p//j/FgBBAHEABwEWAbcAcwCEAGwAUwA3ABoAFQAbACAAJwBvALsAwACWAHUAYwBRAD4AKQAWABIAEQAYABcAAAD8//v//f8A' +
      'AP7/CgATABQAEAAHAPz//f/+//7//f/9/wAABgA0AEgAOgAeAAMA9//0//f/+////wcABQD6//f/9f/w/+z/6//t//L/9P/z//P/FwAbADEAaACMAJwAhgBYAHAAkgDKAE4BBwJRAsMB' +
      'JQHEAOL/SAAAAPn/+P/5//z/AAD9//f/4//i//b/KgBcANIAswC+AHUAagCSAIgAbABPADEAEwATABkAOwCLAL0ArQCOAG4AXABKADgAJAATABIAGgAiAB8ADAD+//j/9//9//3//v8K' +
      'AAwACwAKAAYA/v/6//v///8NABsASgCCALYAugBOACkAMgAAAPj/+/////7////+//r/9v/x/+7/7v/x//b/+v/6//T/CgAnAE8AvAAFAeIA1QCAAE8AXACRAN0AcQF2AR0BqwBqAEwA' +
      '4v/9//v/+f/5//r//v/9////9//s//j/QQB/ANsAPAA0AC0APwBZAFsAVABXAEEAKwANABoAUADIAOkA5wDIAI8AcwBSADIAHwATABsAIgAmAB4ABAD9//T/9P/7/wIA/v/9/wIABgAG' +
      'AAIA+//1//n/DQApAF4AlwDPAAUB8wCIAEgAUQBnAGgA/P8BAAQA+/8DAPz/+P/y//H/8//4//3////9//v/BgBKAJUABgGXAa4BKAGnAG4ARwBZAIwAjgCoAHYAUgA9ACcABAD7//z/' +
      '/f/7//n/+v/+/wAAAQD5/wwAYQDTAEsBLgAuACsAJAAgACkAOQBFADoAJAAOADQAbgAeAUIBQQH8AL0AsgCAAE8AIgAVABMAGAAaAAEA///6//X/9//+/wQA/f/6//z//v/+//7/9v/w' +
      '//j/IwBpAJoA5QALAdsAugCLAD4ASgDi/+L//P/+/wIA/v/+//3//P/1//X/+f/+/wAA///7//3/PACNANsAWgEGAiECmgFGAa8AhwBnAGkAbABMADEAKgAhAAgA+v/6//3////8//j/' +
      '+P/5//T/6f/r/ygAtgA8AfQBMQAwACkAIgAaABQAHwAuAC0AHQAkAEwAswCJAboBSAHWAIsAigBoADsALgAhABUADgACAP//+/8BAAoAAAD6/wAA/v/9//3//v/+//v/8v/u//j/MAB1' +
      'ALkA2gCsAJoAtACIADcAIgAPAP7//v////r/9v/3//n/+v/6//v//f////7/+//6/xIAQgCDANQAYwHqAXICegILAjwBuQBqAGAASgAVAAQA/v/+//r/+P/6//3//v/7//j/+v/+//T/' +
      '6f8RAEQAzwBeAe8BNAAsACQAHAAUAA0ADAAUABcAFgA3AFkAxwDVAfIBRwHOAIIAagBUAEcAOgAsACAAEQD+//f/9f/8/x4AHgAaAP///v/+//3//P/8//n/8v/w//z/EgBQAH8AgABk' +
      'AJ0A0gCiADoADgAKAAQABAD//+7/4v/m//L/+v/9//7//f/9//7/DwAfADYAWgCQAMUA9QCCAUMC4gJ8AqYBDwGlAE4AJgABAO7/5v/t//X/+v/8//z/+//4//j/AQAhACoANQBeAH0A' +
      '2ABaAbQBWQAzACcAGwAQAAQA//////X/AQAxAGUA1ADiAVgCuQHrAJgAhwB4AGUAUQA+ACoAEAD6/+//8P/4/wQADgACAP3//f/+//z/+//7//j/8//0//7/DgAOACYAKgA9AG8AdABb' +
      'AC4AAAD+/wIAAwD9/+X/4v/i/+7/+f/+/////P/4////HwA/AF0AdgCnAP8AIgFOAecBYgJBArwBWAHcAGcALgADAOL/4v/q//j//v/+//v/+P/1//j/DgAwAFYAkAD2ABgBGQFqAWsB' +
      'ggA/ADMAJAATAAEA/v/5//f/EgA7AGUAwACzAWYC5AEIAa8ArACeAI0AegB7ADsAGAD9/+//+v/4////BwD///z//P/8//v/+v/5//j/9v/3//7/DAD2/+7/AwAZADIALAAjAAAA8v/1' +
      '//n/+P/x/+r/6f/v//b/+f/6//r/+f/3/wEALABMAGwArAA1AfABDAIZAlMCLALaAZEBXAECAZAAPgAQAOb/4v/u//z/AQD///n/9P/z//n/EAA3AHIAGgGvAQYC5wGJAVwBYABNAEsA' +
      'QgAvAA8A/f/3//b/BwAxAFgApwB5AQMCowH1AL8AzQDRAMYA0gChAE0AJgAMAPv/9f/5////BgAAAPz/+//7//n/+P/4//j/+f/6//j//f/5//v/9P/s/+z////3//n/+P/6//b/8P/4' +
      '////BgAPABMA/f/y//L/9v/5/wsAMgBaAI0AKwHwAesCZwN5A3IDEQORAh0CwAEwAbgAVQAhAPj/6v/0////BAD+//j/8//0//r/CgA5AL0AbQEtArMCdALUAX8BNgBUAHIAbAA3AB8A' +
      'CwDy/+z//f8kAEgAlgACAScB1gCiAJUA0QASARoBDAG1AF8AOQAhAAsA/f/9/wIABQD+//3//P/7//r/+P/3//j//P/9//n/+P8FAAcA9P/i/+L/4v/+/xoAEQANAAgABwA1AD4APQA5' +
      'ACEAAQDn/+b/8v/8/xcAQABtAPYAigFvAlgDSwTBBNYEPwTTA3MD2wLVAR8BfQA4AAgA9v/6/wEABAD9//n/9f/1//r/AAA5AMEAkAGRAkAD8AIIAnMBXwCQALcAkABKACsAEwDs/+L/' +
      '8v8WAD8AggCbAHcAaQBpAIQAvAAWAYoBkAE6Ab4AVgA3ACEADgADAAcABQAEAP///f/7//r/+P/3//j//P////7/AgAPAA4AIgAeABkAFgATACsAKwAnACIAMgB5AJIAdABqAEYAEQDi' +
      '/+L/7//8/yAAVQCLAB4B5QHLArQDwwSdBcwFFwWVBAkERgMYAlMBmgBUACEA/v///wMAAAD///v/9//4//n/+f8bAHAAOAFmAj0D2QLUAU0BigCtAMcA6wCTADYAFgDo/+L/5P8LAE4A' +
      'lgCvAFwAQABWAH4ArgBOAesBFgKtARgBmQBUADkAJwAVAAYA/P///////P/8//f/9//4//j/9v/4//7/CgAaADwAUgBQAEsATgBMAE8AVABQAEgAgQAIAUQBLQG8AFoAJADi/+L/6//3' +
      '/xEAaQCmAEMBNgJmA4EEdwUxBmQGbwVZBKcD7ALWASABiABQAB0ACwAKAP7/+v/7//v/+f/5//n/9P8AAFUAvQCiAWkCGgJzAQwBaAB4AJkABgHRAFUAEQDo/+L/4v8EAFQAowDCAGQA' +
      'JgA/AF4A3QDMAUgCawI0ApQB8wDMAHQARgAwAPv/6v/8//7/+v8FAPL/9v/6//f/7v/p//P/BAAqAG0AgQCCAH0AhgCNAKsAugCnAGEAdAAfAeQBrQECAWIALgDi/+L/5v/u//z/TwCy' +
      'AHwBiwLgA0EFRAalBnEGUwVFBFwDcAKbAeQAfwBIACgAIgARAP3/9v/5//v/+//7//r/8f/2/y4AbwDoAKMBlwEoAdAAPQBEAGwArwCTAC0AAgDs/+L/5P/8/y0AWwB+AFoANwA8AFMA' +
      'CgH4AWkCcwJYAsgBVgFDAf0AfwAzABoACAAOAA0A+v/9//D/9//9//n/7P/2/+n/AQBDAJAAsACyALQA7QAOASIBBQG6AG8AcAAAAcQBpQHeAFQAEADi/+L/4v/i/+v/WQDHAJgB4QI/' +
      'BI0FWAYyBsMFDQU9BFADOwJcAcoAdQBHAD4ALAAOAAUAAwACAAIA///+//3/8//x/w8AMQBqAOEAQgH/AN4AIgAmACgASAA8ABwA/f/x/+z/7//4/wYAMABNADoAUgBdAGkA5gC4AScC' +
      'LAIkAtUBjwFOAf8AgAAwABkAGQAVAA8A/v/4//T/+v/+//z/9f/5//3/HwBZAKcA4wDiADoBtgHRAZYBPwHiAIoAsADzAGQBKAGMADUA/v/i/+L/4v/i/+L/cQDeAMYBLAOIBIoFnwXh' +
      'BJwETwQABFYDJwIvAb8AbABXAEMAKwAiAB0AHAATAA0ACQAEAP//+P/1/woAIwBBAFkAwQCZAJsABQAHAAkADQAJAP//+v/2//b/+P/6//3/CwAoAEQAZgB3AJ0A/AB9AecBAQIrAjIC' +
      'GQKPAQQBggA0ABkAFQASABEACAAAAP////8DAP3/9f8LADUAZQCZAPEAMAGCASMCwQKEApQB9QChALUACgE5ASoByABZACMA9//i/+L/4v/i/+L/TwDyAA0CZAOkBCMFvwQBBJcDSAMr' +
      'A/ECNAJGAbYAcwBaAEYAOwA3ADQAJgAaABEACgAEAP//+//6//7/CgAcACkAOQBHAEgA9P/v/+3/7//x//T/9v/4//r//P/+/wEAPQBiAI4AiACXANgAEQFvAbYBygECAlICXQIBAm0B' +
      'rQA7ABcAEAAOAA0AFgAhACMAEwAJAPz//P8YADYAdwAEAZkB9wFqAgoDOAN6AmoBtgB1AKIA3wANAdsAeABHABcA8v/i/+L/4v/i/+L/LADCAN8BaQN8BFAEBAS8AwQDYAJVAjsCqQEg' +
      'AaMAfwB1AIkAcgBSAEMANAAiABYACwD8//j/+/////3/8//u//X/IABHAEMA7//o/+X/5//t//L/9//4//j/+v///ycAZwCeAMoAwQClAMYABQFRAaQBywGcAbQB9QHZAVYBuQBNACgA' +
      'DAAKAA4AKgAyAEYAOgAUAAQAFAApAEEAdwACAa4BDwJyAhYD4ALtAf4AkQC1APIALQEzAcsAWQAyAAoA7v/i/+L/4v/i/+L/BQCHAFMBpAKPA1wD8QIcA9YCIwLNAcgBYgHeAIYAgADb' +
      'AAwB4gCUAI4AfgBXAC8AFAD7//P/+v/9////+f8JADwATwB/AH0A8f/t/+3/7//z//f/+f/3//P/9f8IADQAfADFANgAxgC0ALsALgGjARcCQwLxAYwBvQGlAUwBDgGjAEEAGAAMABQA' +
      'QABAAFIAZAASABsALgBBAF4AuADxACwBogFFAvcCyQKoAd8A2AAnAWwBqgFrAeYAWQAlAAIA7P/i/+L/4v/i/+L/9P9MALYAdwFHAhAC5QEbAhAC5AF9AWsBKAHMAKsAtQAMAUABBQHV' +
      'AKsAnwBxAEQAFQD0//L/+f8BAAwAHQAyAFEAmgDoAOsA+P/3//j/+v/7//z/+//2/+7/8v8IABcAWACgAKoApQCVAI8A6QB+ASQCcQItAosBrAENAgMC9AFnAY8AOwAiABoAVQBZAFUA' +
      'SAAcADAARABZALgAUQFvAYQBtwGLAv0CeAJaAdwATAHUATYCFgKsAUABmgA1AAMA6//i/+L/4v/i/+L/4v8OAFUAsAA8ASEBKQELARsBFgEJAQIBIwH6AOkAAgE5AW0BSgElAbsAngBx' +
      'AEcALAAHAPv/+/8DABYAKABCAF4A2gBFAVYB/v////7//f/9//3//P/2/+7/8v8DABIAMwBtAHQAcQBtAGcAvgAwAbsBGAIFAm0BqQFWAjUCygFdAX8ARQAsACwAcgB8AEcALwAyAEcA' +
      'XQCQAEcB6gEgAi0CCgJbAp8C1gEfAeUAYwFDAr8CfAIMAnwB0AA/AAMA6v/i/+L/4v/i/+L/4v/m/xEAZQCnAKMAogCZAIMAnQCwAO4AGgFCAWUBigHOAfkBoQF1Af0AyQCVAHYAUwAt' +
      'ABkA/v8QACIANQBJAGYAtAAqAU4BCQAHAP7//P/6//v/+v/3//H/9P8DAA4AGwA3AD8AOwA4AEkAwgBfAbgB0AHUAUsBgwEIArgBGAGvAIAAYQA2AFIAmQCPAEkAMgBLAGIAlgDiAHAB' +
      'PAKmAqQCTwIeAicCkwExAT8BawEQAscCggLVAUUBrwA9AAIA6f/i/+L/4v/i/+L/4v/i/+L/BgA8AD4AjQDQAKgAugD0AE0B4gESAgcCjALlAhIDiQL1AX8BUwEtAcgAkABIACkAEAAe' +
      'AC8AQQBUAG8AnQD5ABcBGQAOAP7/+f/2//f/+f/5//f/+P/9/wkAEQAKAAkACAAPAD0AigAvAb0BywGtAUcBLAFjAQ4BvgCaAJ0AnwBcAEUAiwB4AFUARQBhAJwADgFRAXIBAQKNAqoC' +
      'YQIZAtUBgQHBAfEB2AENAqMCbgKbAQ8BlgA9AAEA5f/i/+L/4v/i/+L/4v/i/+L/4v8fAIYA7gBWATwBBQEcAYgBggLOAsMCQQMfBEsElgPIAjsCBALNAUMByABdADkAIQAvAD0ATgBg' +
      'AK8AKgGDAZYBHAAOAP7/9//z//T/+P/7//v/+//7//7//v/8/+7/6P///zAAYgDtAIYBkQGHAWABKQHrAL4A5gAMAfsAwAB3ADcANwA7AEEATwBqAP0AmgH6AfQB6QFUArQCuwI7ApoB' +
      'wgFFAlkCwgG+AQMCqgFCAbcAeQA8AP//4v/i/+L/4v/i/+L/4v/i/+L/4v9CAKcADwGYAc8BpQFUAaMBYAISA2UDlANeBMUEOARQAxoDFQNYAnEB7ACGAFkAMgBAAE4AXAB6APkApgFe' +
      'Am4CGQALAP7/+f/1//X/+P/8//3//f/6//b/8v/r/+L/4v/z/x0ATQC2AEYBbQF/AVABEAHQAJoA8wBHASUB1wB8ADwARABMAEUAWABpAN8AkwEgAjICEQJzAv8CFwNUAt4BIAJqAhYC' +
      'VAE6ASIB7QCfAIAAVwAgAPf/4v/i/+L/4v/i/+L/4v/i/+L/4v9EAMgAUgHcAVACCQKAAX0B7gG/Ao0D2gNQBK8EWgTRA/wDGQQlAw0CSAHTALkAhgBRAF8AcADHAFMBBQLPAgsDGQD9' +
      '//z/+//5//j/+f/7//3//f/6//X/8P/r/+b/5v/x/wkANgBmANEA+AAMARMB+wDHALkA7QA4AU4B8gCMAE4AVgBQAEsAYQBhAJ0AIwFyAbAB+gGVAhkD4QJgAhoCkwKhAhkC0AGVAUoB' +
      'pABrAE8AMwAOAPD/4v/i/+L/4v/i/+L/4v/i/+L/4v82AM8AVQHbAWECOgJ8ATABpgFaAkQDxwMOBJ4EjQRIBAIEAQSMA28ChgExARUBygByAHcAxwCcAVIC6gJyA2cDGAD6//r/+//7' +
      '//n/+f/7//z//P/6//f/9P/z//P/9P/3//3/GAA8AGQAcACVAMUA7wDHANwADwFEAXcBQAGyAF8AXABUAFIAYABYAIMAzQAQAT4BhAH8ATkCHAIGAkcC/QIdA9kCngICAl0BxQBDACEA' +
      'BAD3/+f/4v/i/+L/4v/i/+L/4v/i/+L/5P8kAFYAewDTAFkBiAEeAQoBtQE1AsQC6QJUAwsERwRHBKYD/gKjAtwBgAGJAUIB2QCZAMkAdAFlAjID6ANpBEQECgD9//3/+//7//v/+v/7' +
      '//v/+//7//r/+v/8//7//v/9//z/+/8UAF0AdQB9ALoA4gDyAAsBIQElASQBCAG4AGkAXwBXAFsAWABQAHQAqQDlAB4BSgFoAXMBkwHmASoCxwIeA9oCWAKqARMBtABJAPr/7P/j/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/7P8SADQAPgBXAJIAnwClAN8ArQHxAegBAgJVAsQCEgNaA+kC/QF0AQwB8AAfAf8AnACpAE4BHgLcAosDNQS4BLYE/f/8//z//P/7//z//f/8//v/+v/7' +
      '//z//f///wMABAD+//f/AQAYAEkAhQCnALYAyQDVAOAA5QDaAM8AxQChAIEAaABbAFgAVgBZAHwAwQDzACABSQFCAUYBfwHSAd8BAwIWAu8BjAEGAb4AlwA8APD/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/7P8AABEAGwAlADQATwBuAJwAEwFAAR4BKQFIAXwBvwH2AaQBAAGlAIAAYABmAGwAWwCWACcB9QF0Au4CYAO0AwYE9//4//v//f/9//3///////z/+v/7//3//v/+' +
      '//7//v/9//j/+f///0YAcwBmAGkAgwCYAKEAqACfAKcA5gD6ANMAowB4AHAAbQBwAKAABAFEAXEBeQFQASsBWgGBAW4BWAEbAfIAxgCpAKEAkwA6APn/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/5////xsAKgA6AEIARwBPAGAAiQChAKsApAC0ANsAAwHzAMEAfQBEAC0AKwAzADwATgCYAPQAVgG7AQACQgKvAjoD9v/3//z//v/+//7//v/+//7/+//8//3//f/8//v/+//7' +
      '//v/AAD8////TABCADkASABtAHAAdwCQAMQA+AACAdMAqgCvAKcAlwCJAMUABQFMAYEBaAE+AQkB+wAlAV4BMwHSALAAxQACAdsAkQBLAAcA4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v8AACoASgBYAGsAdQB+AK0A0gC3AJkAkgB/AGwAjACYAGMAQwAnABAAFQAdAEAAyAArAZ8BEQJFAkMCWwLEAlcD+f/6//3//v/+/wwA//8FAP3//f/9//3//f/7//n/+P/7/wAAJwAZ' +
      'AP7/NAAcABwAcQCwAHQAfwCMAJkAqgC+AJ4AoQDHALEAfwBqAHcAsAD6ADYBOgFRATIB3AAJAUMBKgH6AAgBXQHaAbIB5gBjABsA6f/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v8PAEgA' +
      'agDIAB4B+wDvABIBWgE5ARQB5AB0ACEAPQDi/+b/5v/x//n/CAA1AGcAGgHIAYMCIwNtA2oDTQOtAywE/P/8//z//P/8/wIABwD8/wAAAQD9//3//f/7//n/+P/8/wkAGAAcAAgAIgD7' +
      '/zsAoADnAJMAcABXAEoAXQBxAG8AiACnAHYASgBIAEgAXgCnAPAAWAHFAX4B+gDnAOwA6wD0AE0BngHXAZAB6ABxACQA8//i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v8mAGIAnQAtAdsB' +
      'pAFqAZ8B4QHEAZ8BOQG3ABMADwDi/+L/4v/i/+L/FQBZAKkAUAHyAcoCqgNgBJgEWQR2BMwE/v/9//v/+f/5//r/EAAFAPr/4v/+//7//f/7//r/+v/9/wcADAAOAAYA8P/w/ysAnwAO' +
      'AccAgwBWACEAPABPAJ0AuwDOAHsARgBDAFEAbgC2AAMBZAGPAU4B3gDAAL4AwQDeABABXgErAdUAagBJABAA+P/r/+P/4v/i/+L/4v/i/+L/4v/i/+L/5P89AHAAnQBYASUCPwITAlgC' +
      'YgIlAsYBQAG8AG8AIwAMAO//4v/i/+L/FwBnAP4ArgFYAiMDAATrBFsFQAUbBUwF/v/8//j/9v/2//j/BwAFAP7//f/9//3//P/7//r/+//9/wIAEQAQAPz/7f/0/z0ArAARAQIBkAA3' +
      'ABoARQBiAAcBOAE7AdkASwBQAG8AjwDJAPQAEwEkAfcA0QDcABoBLwHaANQAFQHTAG0AMQAWAP7/+P/y/+v/5f/i/+L/4v/i/+L/4v/i/+L/5/8tAGsAiAAOAdMB/QEmAlsCbAI7AtgB' +
      'fAFGAeoAewBkAC4A4v/i/+f/OQCGAEgBFALJAmMD+QP0BKoFZwU0BRsF/f/6//b/8//0//f/+//+//7//f/8//v/+v/5//n/+v/7//7/IAAQAP7/+P8HACUAcAC9AKgASQAvABgARwCy' +
      'AFgBqgGBAcsAPgAxAEsAYQB9AJsAvgDwAPUAKAFaAYoBsAEcAdEAFQG0AE0AIwAFAPr/6f/w/+z/5v/i/+L/4v/i/+L/4v/i/+L/5v8AABcAXACXAPMAKgFjAXYBkAGsAfUB4QHBAVMB' +
      '4ACVAFcA4v/i//7/PQCTAH4BVAKZAq8CZgNgBLIEWwRbBEMEAwD4//T/8v/z//f/+//9//7//f/8//v/+f/3//f/9//2/xAALQASAAUACgA0AFUAYQBWAD8ANAAqADEAVADLAI4B7QFN' +
      'AZsAOwAnABgAJwA/AF4ArAAUAS8BgwHTAc0BWQHKAJsAtACeAEAAIgASAAYAFwDq/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/w/woALQBkAJIApwC9AN8AKQGPAekB3wHUAYIBHgGrAEUA' +
      '4v/i/w4AUACWAE0B+wHYAeABpAIeAzEDDQMnAwwD+f/2//P/8//0//b/+v/8//7//v/9//v/+P/1//T/8//w//P/HgAdABkAIgBkAIQAoQCGAGkAWwBLADwAXgC1AEQBSwHSAFEAJwAg' +
      'AA0A/v8EAEoArAACAVEByQFGAtgBFAF7AEQARABEAEIANwAsACAA///i/+L/4v/i/+P/4v/i/+L/4v/i/+L/4v/i/+n//P8rAFgAtwD+AGkBwAExAmgCZQJkAgwCYwGnAB8A4v/i/wkA' +
      'RACFAOkACwEJAToBrQEaAucB3wEEAv4B9v/0//P/8//0//b/+f/7//z//f/8//r/9v/y//H/8P/u/+3/AQAaACIAOQCBALYA2ADgAMsAtQCPAEUAaADJADcB/QCJAC8AAgABAP//9//w' +
      '/xQAUgCnAAEB0gEgAmsBnABDADcANgA2AE8APgAwABYA9f/i/+L/4v/n/+b/4v/i/+L/4v/i/+L/4v/i/+L/4v/9/1MAuwBsASwCoALsAu8C0AL/AssClwGaAOT/4v/i/wgANAB3AKwA' +
      'xADUAGsBxgGUAR0BPAFGAVYB9P/z//P/8//0//b/+P/5//r/+v/6//f/9P/x//D/8f/w//H//v8bAEYAdACxANMA9AAoAWQBTgG+AGIAjwDtACIBwwBYAPz/5//y//v/6//i/wQANABk' +
      'AMIAYwGCAecASwA6AC0AKQAwAFoAVQBTADYA7v/m//P/9v/w/+j/4v/i/+L/4v/i/+L/4v/i/+L/4v/n/x4AXgDyAL8BVALWAqwCXgJYAiYC/QBnAOT/4v/o/wgALwBfAH4AoQAgAaYB' +
      '3AFVAeAA0gDkADAB8//z//P/8//1//b/9//4//j/+P/3//X/8v/w//H/8//1//v/GwBPAIEArwDHANUA5AAuAY4BlgEHAXgAbwCqANIAiAAtAOz/4v/s//f/7P/i//j/IgBLAHcA8ADJ' +
      'AGkAPgAxACQAGwA0AF0AgwClAIYADgAeABsACgD7/+v/4v/i/+L/4v/i/+L/4v/i/+L/4v/i//n/LABgAKkAJQGZAb4BagE0AeIAlwAxAOf/4v/u/1IAXwAyAGEAqwAPAXsBhAEFAaUA' +
      'hQCxAG0B9P/y//L/8//1//b/9v/3//f/9v/2//T/8v/x//L/9v/8/woAOgBxAIkAnACpALYAxwDuADsBVAH+AIYAPwB7AIsAUwATAO//5f/u//f/8f/s//j/DgAuAEoATwBXADMAOAAq' +
      'ABwADgApAEUAbgClAKsAewBNADUAHQAFAPH/5f/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/AQAiAGEAjQCnALIApwCZAI4AYAAHAOL/4v/x//T/WQAOAAIAdwDNAFMBUwHYAGoAPgCTACgB' +
      '9v/y//L/9P/1//b/9f/1//X/9f/0//P/8f/w//H/9/8RACMAUwBmAGkAcQCAAKIAvQDjAAIBLAHVAIsAPgBlAHMASgAVAPj/8f/0//j/+P/2//r//f8KABIAFQAfAA8AKQAmAB8AHwAd' +
      'ABoAPgBwAIgAggB4AE0ANQAdAPn/6P/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/0/y8AHQBUAFUAUAA5AD0A+P/i/+L/4v/u/+v/4v/i/wwAZgDHADQBaAHqAHgAPABwAJ8A9v/x//L/' +
      '8//0//T/9P/0//T/8//y//D/7//u/+7/9P8eADwATwBUAFwAaACrAOkA4gAEAQ4B6QCQAFQAOABFAFwAOwAXAP3/+v/5//r/+//8//z/+P/t/+L/4v8CAPz/EwAvADEAMQAuACgAIAA5' +
      'AF8AYgBuAHIATgA2APz/7P/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/o/+L/4v/i//L/dAC2AMwA6QCxAHsAMAA5AFsA9v/y//L/8//z//P/' +
      '8//z//L/8P/v/+7/7P/r/+z/8/8QADkASgBSAFsAcgCVAOoAEQEgAfEAowBXAEAALgApAD4AHwAIAP7//f/8//v//P/9//3/9f/l//7/FgARAO3/KwA/AEQAQgA3ACYAHQAqADcAQgBO' +
      'AFkAZABOAAoA8P/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/TAByAG4AZgBfAEIAHgAlACoA9f/z//P/8//y//L/8f/w/+//' +
      '7f/t/+z/6f/o/+3/9/8BADAARwBQAGEAewCWAAQBQgEuAeEAewBNADcAJQATABwA///7//z//v/9//v//P/8//v/9f/t/+P/8P8bAOf/BQA6AFUARgA1ACMAGgAnAEQALgA4AEEASwBN' +
      'ACEA9P/n/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/8P8gADgANQAmAA0ADgAVABYA9f/1//T/8v/x//D/7//t/+z/6//s/+v/' +
      '5v/m//L//v/9/ysAQwBPAF4AbQCwAGIBywFuAfAAmACBAFcALAAJAP3/8//0//r//v/9//v/+//7//n/+P/8//3/9v/v//r/CQA7AE0APwAxACAAGAA/AFUALwAgAB8AHgAdAA4A9//s' +
      '/+T/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+3/+f/4//b/9P/z//P/9//2//T/8f/v/+7/7P/r/+n/6v/s/+v/4//k//f/' +
      '/f/y//L/iQC7ALIAdgClAFEBoQE8AdYAswCnAIwAVwAfAPj/8f/y//j//v/9//v/+v/6//n/+v/+/wQA/v/4//n/CwArAD0ALwAhABQAJgBUAHEAYABXADEAGgAAAPz/9v/v/+j/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+X/5v/i/+L/+v/2//P/7//t/+v/6v/o/+j/6f/s/+v/4//j//b///8YAH0A' +
      '5AAjATQByAB1ALsAFAEAAakAjQB/AHUAXAAhAP7/9v/z//j//v/9//v/+v/7//v//f///wAA///9//3/DAAVACoAHwASABEAMQBaAIkAngClAIIAMAD9/wEA8//w/+r/4//i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/+//2//H/7f/q/+j/5//n/+f/6P/q/+r/5v/k/+n/8f8xAOYARgGXAYIB' +
      '3QByAGQAgwC4AIsAbwBUAEgAPQAqAAAA+f/1//n//f/9//v/+//8//3//v/+/////v8BAP//BgANABQAEQAQAA8AMgBWAIsAwADNAJsARQD2//X/8v/w/+r/5P/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/+//2//D/7P/o/+b/5v/m/+b/5v/n/+n/6v/m/+L/4v8+ANgAZAGkAVgBuwCAAHsA' +
      'kgCzAKEAaQBNADoALwAjABYA/f/5//r/+//7//v//P/9//3//f/+/wAA///+//7//v8AAAAA+//6//3/IABpAIsAqQCpAGkALwD8//b/9v/z/+z/5f/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/+v/1//H/7f/p/+b/5f/l/+T/5f/m/+j/6//n/+L/4v84AHAAzADkAPAA0gDDANcA4QAJASAB' +
      'vQBsAEQAOAAsABgAAAD+//v/+v/6//v//P/+//7//v/+////CwAAAPz/9v/6//7/9f/8/wkAWADjAOQA8gAiAcUAUAAYAP7/AAD8//D/5v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/+f8EAPP/8P/s/+n/5f/j/+L/4//m/+j/6f/m/+L/6f8pAFgAfgCiANkALAGYAbMBcQGHAVcB/gDCAJAA' +
      'aQA9ACEADAD+//v/+P/5//v//P/+/wEA/v/8//3/DQAGAPz/7v/0//7/+f/i/+L/oAD0APkACgGtAWMBjwA3AB8AEwAGAPX/5//i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+P/4v/i/+L/4v/i/+L/4v/i/+L/CwAmACQA9f/w/+v/5v/i/+L/5P/n/+j/5//l/+f/8v8cAGMAgAC6AAsBfQEKAi0CvwG2AYUBdgFQARoB4gBsAC4A' +
      'FgD///r/+P/5//v//P/9//3//f/8//z///8HAP3/8P/o/+r/8/8EAEUAgACMAJEAugAgAQUBsQBbADcAJwATAPn/6P/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/GgA5AAkA+//0/+3/5//k/+P/5f/o/+j/5v/l/+n/9P8qAGgAnwDfABkBeAEZAlEC6gHwAb0BkwFjASsB5QCLADwAHgABAPn/' +
      '+P/5//v/+//7//v/+//8//3//v/+////+P/j/+L/BwBAAFwAeACnAOQA0QC7AJIArAB8AFoAOwAkAPn/6P/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/GgBJACEAAQD5//D/6//o/+f/5//o/+j/6P/n/+n/8v8vAHkAwgADAT0BbAHxARoCAwIuAgICggEQAbsAkABOADQAGwAAAPr/+v/6//v/' +
      '+//7//r/+v/8//3//f/7//z//v8AABUATABmAI4AAQF8AYUBSwG/AIkAmgCeAH8AYQAtAPP/5v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/RQBYAD0AGwD+//X/8f/v/+v/6P/o/+n/6v/p/+j/7v8SAEUAjwDoAAcBFgFMAWkBoQEkAkUC8wFvAdsAdABFACcADgD9//r//P/8//v/+v/7//r/' +
      '+//8//7//f/5//b/DwAxAF0AlQDrAG0B1wE6AgECZQG/AKEAtwD9APUApQB6APP/4//i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/egB2AFQAKAABAPv/9v/0//D/7v/t/+3/6//n/+P/6f8EACsAUwCRAK0AlwCJAJEA2QBaAeIBMQLRATABoQBUAC0ACAD3//n//v/9//v/+v/7//v/+//8//3/' +
      '+v/1//P/FABuANAAHwHMAYwC1AKBAtIBKwEEAecA+wBHASEBlwD2/+P/4v/k/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/jwCEAGIAUQAgAAEA+//2//b/9//3//P/6//i/+L/4//9/yMAUwBZAHYAQAAUAB0AUgCUAPYARgFgAS8BtABPAC8AKADy//f//v/9//v/+v/7//r/+v/8//3/9f/u//b/' +
      'MwC1ABcBQwHxAZoC1QJEArYBlwGJAUgBPAFKAdkASwD9/+X/4v/l/+T/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/fABzAFUAVQBMACIA/v/5//z///////v/8v/o/+L/4v/8/yMAVABaAFYA/P/i/+P/GgBlAH8AhgCpANkArwBKACkABgD0//n//v/9//v/+v/7//r/+//+//z/8f/p//7/QgDMADgB' +
      'QQFvAQoCRgIkAtcByQGWAUEB+QDLAIMANwAHAPD/5//m/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/WABK' +
      'AFkAXQBVADUADQD7////FAAMAAMA///4/+r/6/8pADQAVQBVACwABADj/+j/DAA1AEkAVgBlAIMAegBDACQABQD9//7////9//v/+v/7//v//P////3/8P/o/wMAMQB2AO8ANwFSAY0B' +
      'sgGFAVwBFAH2AMEAfABeAFsAPwAaAP7/7v/k/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/OwBXAIIAYwBZ' +
      'AEIAHQD6//7/DwAgABYADwAAAPX/8v8RAC0AUwBJAEAAOAD9//7/CwAaACUA/P/s/+v/HQBKADkAHgD+//3//v/+//v/+v/7//z//f////3/8f/1//7/GQBIAJgA+QBgAZYB1QFhAf0A' +
      'yQC1AKQAZwBhAIQAVwAvAA8A8//j/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/kADBAO8A9ACGAE8AHwD1' +
      '//r/CgAiACoAJAAZAA8ALAAEACMASAA4ACIAFAAPAAgA/f/t/+X/6//r/+L/9f8ZAD4AMAABAPj//v////r/+f/7//v//P/+//z/8v/r//3/GwBmALIAcgG8AewBCwK7AWkBWwF3AUYB' +
      'GQG8AJ8AXwArAA4A8//j/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4QAVAV0BigEiAYIAPQDt/+//DAAk' +
      'ACYAJQArADgAQQAXABsAPAArABUAAAD///3/9P/i/+L/7v/9//7/GQAmADsAOgAUAPr//v/+//v/+v/7//r/+v/8//z/9P/v/wEAVACmABoB/wFqAiECLQJOAlMCdwKaAjgCvgEpAYQA' +
      'QgAdAP3/7v/m/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/FwHyAF0B6gGrAckAPQDr//D/DQAUABIAHAAy' +
      'ADEANwApACMAMQAeABEABgD///r/7f/i/+L/4v/k/w0APABNAGgARgApAA4AAQD8//7//v/7//n/+v/8//3/9//z/1wAnQDuAEAB2wE1AvABxAFxAt0CHAP6AlQCqQH7AGwALwADAOz/' +
      '6P/p/+f/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/9gDFACQBhwFpAbsAPAAHAP3////4/wkAMAA3ADQANQA2' +
      'AEEAOQAeABIABgD+//X/7f/k/+L/4v/i/w0ATAC9APYAaABEACYAAgD4//3//v/7//r/+//9//7/+f/2/xYAWACkANsAJwFoAU8BeAEJAl0C0QLPAuQBOAGVAEoAFQDr/+L/4//s/+z/' +
      '5P/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/EAH5AP4A0gCxAIgAXQA5ABcA9v/x/x4AQgA8ADcAPgB1AKQAjQA6' +
      'AAwA///+/wcA9f/y/+P/4v/i/w0AdADtAEkBsABdADoAAgD1//X/+P/7//3//v////7/+f/4//r/HgBJAHAAlgCsALYAIAGYAfcBwALQAhECQAGsAGEAHADw/+L/4v/s/+z/5P/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/GQEfARoBzADIAPIAugBsAEAA+//w/0YASgBAAEUAgAC9APYAzwBLAAAA+//8' +
      '//3//f/9//j/8P/x/xAAagC9ANMAYwBIAEgABQD2//H/8//6//7/AwABAP//+v8iACcAKgAlADMARABVAHUA2ABvASUCpAKaAhQCLQGkAFgAKQAIAO7/5//q/+n/4//i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/8QAWAV8BYwGmARcCtAGpAGAAJADv//z/HwAZAEEAeQCjAKIAgAAqAPv/9//7////BgAX' +
      'APn//v8AABgANABNAEsAOgAlAD0AJgD9//j/9//7////BQAFAAIAGgAvAB4AGAAVABkAKQA3AFwA5wC1ATACAgLjAbcB+QCUAGkATAAwAAYA8P/p/+X/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/5QAkAaMBLwJ+ArcCWwLuAHsAPADo/+L/7/8OADoAYwBlAFIAOwAPAPn/9//7/wAAIAA9ADAAGAAT' +
      'ABIACAASABIADQAWADAARQAXAP///v///wQACAAGAAUADAAVAAcAAAACAAAADgAfAFEAxABkAV8BMQE7AXwBIQHZALIAgwBnACEA+P/n/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/7gA0AeUBqAKJAlsCBgLyAHYAIgDi/+L/4v8BABYALgA0ADIAJgAGAPr/AAD9/wIAKQBSADwAGAAbACAACwDt' +
      '/+r/8f/8/w8AJAAAAPv/BQASAAYA/f/5//z///8FAAIA/P/1//X//v8bAFEAsAC1AJYAlQDDABcBaAFuAWIBGwGbAEQA+//j/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4wA8AQ4CkAIfAnEBEwGtAHAAMADi/+L/7v8AABUAHQAhABsAFgAOAAEA+v/8////HAAzACMAIQAsADYAQwD+//z/8P/y' +
      '/yoAGwAGAAEABQAXADwAVAAMAPP/+f/+/wwADAAKAEQA//8bAFEAfgByAE8AbACuAP4AOAGiAdoBdwH1AHYA+v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4AA7AYcBrwFZAc8AtgCNAGAA7v/i/+f/9P/+/wQACwASABAAEAD//////P/8////BAAQABYAIgAxABUAEgD///7/+P8CABYALwAn' +
      'ACIAGgAIAAMAEQAEAPT/8P/3//3/FQA1AEcAMwAsADAAOwA1ACwAPgB6AI0AlwAPATYBFgGzAEAA9f/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/nwDbAMUA0ACZAH8AcAAxAOL/4v/j/+3/8//2//n//P/8/////v/+//3/+//7//v/+//8//z//f/7//f/9v/6/wAABgATACQAOQBPAEcAKQAH' +
      'APX/+/8AAPv/+v/7//7/EQA1AEcAWQAqAAsABAADAA8AFgAbACsAKwBLAGAAbwBeAA0A7f/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/WQCBAFcAPwAwACcA4v/i/+L/4v/q/+//8P/v/+//7//v//H/9P/3//j/+P/4//b/9f/z//P/8v/x/+//7//0/wUAJwA6AE4AcgCmAJEAVAAcAAUAFwAw' +
      'ACoAHQATACUAHQAyAEcAUABGAAQA8/8BACEA+P/y/+v/5f/m//L/BwD8//P/5f/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/',
  },
  busan: {
    x0: -204, z0: -132, step: 3, nx: 102, nz: 86,
    heights:
      'FQFwABoAGAAYABgANgCUANQAugB7ADkARQBcAH0AkQBlAEIAgQCTATYCfwFBAcIC6gOVAycC9QB9AT4DMgQlBBkEGAQeBEsE3gSxBWMGmwbqBfIENwR3A3sCsQFLAbAB+AHTAUYBvgBu' +
      'AHIAuQAQAVcB1QFJAvwC6AMIBfIFBgYXBWsEhgRpBHEDigLrAYgBVQGQAecBGwLeAsQDcQTWBD0FcAXcBLMD6QKaAikC4AHQAcYBagEgAUIBWwFiAWkBMwH2AP0ANAFmAVABQAGsABwA' +
      'GgAYABcAGAAgAGoASgA6ADMAawCVALoA4gCuAF4AWQAsAdsBdgEGASACJAOrAq4BywAdAXsClQObBGwFpgV8BScFZQUSBk4GJAbjBYkFRgWWBGIDLwI/ARIBUwGMAQwBhwBOAIQA4gCA' +
      'AdUBJAKMAksDFwT1BLQFkQXJBPYDlAOZA4YDpgLpAY4BVwGSARECXgIOA6ADNQTMBCIF/QRcBH8DvAJgAi0CIgIuAuMBfAFEAUwBUgFXAVMBPAEhATUBaAFwAYUBzwB1ABcAFQAVABcA' +
      'GAAXABUAHQAgACIARQBzAMUADQFCAcoAZQCkACcBMwHHAE0BCQKtASgBkQDkAO4BAgNWBKgFmwZOBowFWQVsBUMF0QSjBOMESAUoBeUDaAJtAeoA8QAwAewAZQBOAI8A+gCnAS8CLgJg' +
      'AhUD8APOBFUFGwX0BCIEOQPRAgsDrQLdAY8BXgGTAQECWwKWAv4CXwP/A64ETATSA2UDCAOsAkoCMwIkAqABSwEtAS0BQwFIATYBJgEiAWQBdQFHAVYBTABEABMAEwAUABYAGAAXABkA' +
      'LQAmABsAJABBAJYANQHPAVMBmABcAHUAngB9AMMAAAG5AJEAbgAAAWgCfwOMBNgFowYDBscEKgQdBPwDdAM8A5oDJARFBHkDTQJKAcUAuQDcAMYAWABjAIQA5gBvAbQByAFJAkcDLAQK' +
      'BfkEkgTABIQEcQOdAnMCTgLBAYEBfAGUAecBEgI8AoACEAPLA3UESwTDAyAD+gKmAiUCzgGWAU0BJwENAfcAEwEzASkBGgERAUwBMwHrAAEBEAAQABEAEgAUABYAGAAbAFIATAAvAB8A' +
      'EwBBAHkAKgH+Ac4BDgGEAFAAQAA7ADwAQwBCAD4AVwAaAU4CjAPmBMkFFwZzBQ4EAgPCAsUCTAInAl4C1QI6A8kC6gFXAeMAjgCOAIoAVQBmAIsAtQD0ADkBlAGDAr0DsgT5BHoECgRm' +
      'BHkEsgO6AikC8QGxAYMBngG6AckB5wEWApoCSAMjBJQEmgQUBDwDvwJzAiQC8gFvASABHAEJAfkA+AAPAScBEwEAARcBBAGwALIAEAAQABEAFAAVABcAHABaAL8AswB/AE4AMgAeAF4A' +
      '7wDKARUC6QFVAbMAZwA+AC4AJgAfAB0AWAC+ANYB/QL9A54EHAXhBKgDSQKhAY0BXgFbAZUBOwK7ArkCQwKiARUBqQBqAFYAPgBtAJoAtgDgAEgBzgHfAhUE8gS3BNEDiQP6Az4EuwPI' +
      'AiQCvAGSAaIB0wEkAv0B/AEIApECHAPWA14EdQQlBIED8AKmAoACRwKnAQsB4AABAQYBCAEGAQ0BFAH2AMoAygCPAIcAEQAQABIAFAAXACAANQBmAMwAEgEAAbsARQAoAFQA2gDTAYkC' +
      'qwIqAnMB6gB5AC4ANgA3ACIAKgCJAEQBMgLQAkED5wNsBKQDPQIwAesA4ADfAGEBNgIVA2cDwgIfAnsBvgBbAEEAPgCSAAgBOwFBAXoBGQJAA04ErwQ1BEYDPAPQA8wDQgOkAvIBlAGE' +
      'Ab8BSgLnAtkCVQI2AlACtAJAA8wD/wPzA6ADUQMKA50CIgKEARcBvgDWAOEA6wD2AAEBDAHnALkAigBrAGgAEQAQABIAFQAXADIAVwCLACIBuQGxAfUAeQBEAFkA5QAmAkoDXwNyAowB' +
      'BwGbAEsAhACzAHkALABDAMoAdAHdAUoCAgMBBNIDZgIpAaYAoQC9AFIBXgI7A1oDxAI2AnkBsgBeACsATwDYAJUB8wHTAcQBWgJNA+UD3wOTA/4CMgOLAyQDmAJeAr4BZgFyAbgBdQJv' +
      'A3wD/QKQAm4CYQKzAi8DhwPTA3EDBAO9AmcC/QGQASMBsACqALUAxADXAOoA8QDLAJ4AcgBMAFMAEQAQABMAFQAXABgAYQDsAKABHAI1AnsBAQGjAGsA+QByAgAE7QPWAugBVQHUAGkA' +
      'uAA3AfIAWQAlAFcA0QAcAWEBPwJkAzED/gH/AIAAawCkACgBLgLYAogC3gGhATsBoABHADcAUQAIAcMBSAI7AjECoALhAv4CSQNJA60CtwIBA3MCCwLaAYsBcQF1AbYBKQL1AnkDbwMN' +
      'A5gCIgJDAs8ClAPpA0gDfgI4AuwBwgGcASoBsgCNAKIAtQDIANsAzwCtAIEAVQBPAFIAEQARABMAFQAWABgAPwCnAEIBogEDAvIBwQEQAbQANwHQAp8EyQS4A2UClgG9AHwAGgG1ATMB' +
      'hgBEACcAVwB+AN4AtwFOAs4BNgGzAFwASQCYAAQB0AFLAiYCTgHtAMEAcAAwAD0AZwDXAHIB1gH3AQACDgI7ArwCiwOBA8wCZAJJAuQBuAGWAZABrwHVAQECLgJ8AgADCQPiAnIC9QED' +
      'ArkCwQPuA0oDggL2AaYBggFhARgBoAB4AIwApAC5AMgArgCOAGMAUQBUAFQAEQARABQAFQAWABcAIQBvAKQA7QBJAbMBxAFFAfQAoAFRAwsFbwU9BM8CjAGgALkApAH7AUkBsQBvAEIA' +
      'JAA+AIQAIwEqAcQApACEAD0AXgDkAKcBcQLGAnYCgAH9AH0APgA0AD0AqAADARUBWgGPAZwBngEIAgED+QPeAyADZwIIAs4BpwGKAQoCUAKQArQCrQJXAnUCXwI4AgQC1wEUAuICsgOD' +
      'A+wCawIXAsYBgwEoAQEBlQB0AHMAigCgAK4AjgBtAFIAUABMAEcAEAASABMAFQAWABcAGAA/AHwAswALAV4BWAH4APwA0AFUA+oElgWfBPgCdQGhAA8BHAKJAgECUwEKAcAATgAkAEQA' +
      'WgBiAE0ANQAqAG8A2gC3AbwCQQMPA1sCYQG+AFMALQAtAF4A5QBwAWUBPQFQAWsBoAExAj0DAAQKBE4DygIyArUBcwGWAUYCDgNnA8IDRQNUAt0BsQGdAbwBPQJ8AuwCcQMbA3MCKAIR' +
      'AvkBrwFDAdgAkQB0AF8AYgB0AIEAiABlAFwAQwA/ADsAEAASABMAFAAUABUAFwArAFUArQAJAVMBMAHTANoAsgHvAkQE2AQHBJUCSgGsABMBIALyAs4CRALsAW0BuQB1AG8AWAA4ABwA' +
      'HQAzAN0AzQGdAlcD7AL8AU4BtQBNACwAKQApAFsAzQCIAdUBtwF+AZ4B+gGTAkUD7QPTA3IDLANuArABTQGbAWMCRAMkBEsEgwNRApQBQgFNAb8BQQKlAtoC4gKnAjIC9AHKAboBjwEZ' +
      'AbsAmgCCAHAAXwBMAFMAXgBiAHMAWgAyAC0AEAARABIAEgASABMAFgAqAGwAtwAKARkB6gC5AL4AeQF3AoEDyQMDAwACPQEZARkB/QECA/kCswLNAhMCRwH6ABcB+ACYAEUAHQBOAFYB' +
      'qgJsA/wCygHbAHAAPAAwACIAHQA0AFMAkQArAdABCALbAfMBUwK/AigDeANeA5cDXwOfAqwBUwGgAYcCgQMOBDMEZQNWAmcBBQEKAUoBrwEbAjcC7wG4AdEBwQGEAXIBOAHwAKQApwCR' +
      'AIEAcgBdAE4AVABIAIgAgABLACEALQAjABgAEAAQABAAFQBVAKMA3QDYALcAiwBxAJMAJgHuAU8ClgJlAs8BwgH+AaoBOALVApgChgLJAhACQAHaAB8BbQEYAaYAPQBBABABfQLxAt4B' +
      '6QBdAEkALAAiABgAIABBAJwAqgDKACMBcQFTAZEB9AFaAsMCBAMrA14DFANeAnsBMwGkAXICDgN+A9YDaQM/AnUB/QDfAPAAIAFoAYYBKwEEASEBPAFGASAB4QCpAKsArwChAJIAgwBu' +
      'AEcALgAjAIAAjAA6AAUAWQBQAEYAOwAwACUAEwA5AGoAfwB1AFUATQBQAGcAtwAWAT4BdwHeAR8C0wL9AlkCIgJqAggC3QH/Ac8BIQGiAL0A/wDqAJcAPABKAPkAzgHZARYBbgAvADkA' +
      'HAASAA8AJgCWAFoBfwEkAd4A0ADdAC4BkwH6AWACqALJAuUCuwL3AT8BTwHGAVUCugJFA+4DyQOYAp8BDwHSANEAywDdANgArgCRAKQAywD5ANcApwCFAI8ApQCaAH4AYwAuABQA+f8H' +
      'AGMAYgAaAPL/hQB+AHMAaQBRACMAEwAYACkASQBxAGUAbACVALIAxADEAMAA4gCWAWUCUQNYAzkCkgG9AbIBWwE7ASYB2QBuAGsAgQB1AHEARwBVAOoAlwErAYAALQAWABEADAAMABMA' +
      'QQDeANYBYQIgAnEB4gDAAAEBgwHzAV0CVAI8Ak0CBgJvARkBSgHkAXYC+gKdA1cEOwT4AuoBNAHvANkA0gC8AMQA1gDnAAcBNAH8ALwAhABiAHAAfwCCAFcANAD3/+L/4v/i/w4AMgAQ' +
      'AOL/cQBvAGQAVgA/ABgAHABBAEIAcwC7AM0A8ABEAVoBdQFnAQ4B4QA7ATUCDQP8AiICagEoAVYBHgHaAMEAjwBYAHUAmwCXAHYATwBKAKoAIAG6ADoAHgAMAAkACAAOABYAZgAUASAC' +
      'LANQA2gCcgEHAfcAZwH7ATkCIwL1AbgBagEVAQsBxQHCAo4D4QMXBKIEXgRUA4sC7AFMAR4BLQFWAXsBmgEaAmUCKwKYAQABoQBLAEwAWQBnAEQABADi/+L/4v/i/+L/4v/i/+L/MQAy' +
      'ACsAGgAVABUAVgCKAHQAagCoAOQAcAHwAScCMwIwArUBEAENAdIBXAI3AgoCbwHSANcA5ACbAGYAbwC6AOIABgHkAKoAhwBMAD4AYQBBAE4AQgAWAAoADAARABgAhgBVAX0CpAM7BIwD' +
      'TQJ0AScBRQG7Af0B5wG6AXcBKwHhABgB3wEpA1kEagQ0BGEEFwTQA3YDuwISAgYCGAI6AmUClAJtA5cDvQKpAfUAigBVAEEARgBPACcA9v/i/+L/4v/i/+L/4v/i/+L/KgAhADwAKwAd' +
      'ABoAUQCQAIcAdABtAKUACgG7AWICwgLFAiwCXwESAYABrwGQAXwBBwGlAJYAsgCSAIMAywBOAVkBCQHKAPYAGgG4ADYAKAA5AFgAcAA3AAsADwAVACQAoABzAYcCpAO/BLQEdgM8AokB' +
      'UAF7AaMBygG9AVQB7wDVABoB3AHmAqYDlQNmA80D7QPcA8QDMAPnAuICuQKHAmgCzQKpA+cD/ALQAQgBjwBvAEsAUQBMABcA8v/i/+L/4v/i/+L/4v/i/+L/LwAqAGMAewBmAD4AQwBj' +
      'AFgAWABhAIEAtgAYAe0BxALpAh4CQQEpAZIBgAFTAScBBwHtAAEBMAEMAcUAMQGtAWsBHgEVAXkB7AFLAW0AHAAjADsARgAnAA0AEAAUAFEAvwCeAYYCoQPgBJwFuQRSAzECmgGNAakB' +
      'wAG3AU0B1wDKACsBiAEnAnQCfALjAtAD7QOAAyUDuwLFAtsCZgLgAcIBCQKyAiwD+QINAhcBigB/AHEAXgA/ABcA8f/i/+L/4v/i/+L/4v/i/+L/RwA9AHcArgCJAFMAOgBJAGEAcQBr' +
      'AI4A3QDuAKQBjQK8AvMBTgE7AYEBmwHAAYUBXQF6AWwBvAFoARYBjAH1AZIBqAGxARECmwLuAdoASQAeABYAFAANABAAEwAXAHYA/ADfAcQC4QMkBf0FqAVbBAkDaQLrAaEBhAFhAQ8B' +
      'rgDLAB0BgAHQAeYBGAIBA/QD7wMmA30CEwIpAj0C3AGNAVwBVwGcAQECNAK8ARcBggB3AGwAagA/ABcA8//i/+L/4v/i/+L/4v/i/+L/UQA8AFIAbAB6AHQAgwBxAIEAfAB2AMYAGgEC' +
      'AYcBZQKaAvYBtQHDAawB2QEiAuIB3QEDAtcB8wGSAXABDwJGAuoBNAJRAoECFQOVAoMBkAA8ADkAEAAPABMAFgAzAJkAVAEyAhADOARiBfsF1QXIBA8EjgO1ArwBSQEHAcsAsgDGAA4B' +
      'ngHLAb8B3AHAAiYDGQOcAu0BnQHUASgCIAKyAUcBBwEFASEBUwEuAdcAegByAHMAdQBCABcA9P/i/+L/4v/i/+L/4v/i/+L/PQCPAJ8AXgBxAKsA2gDVAKgApgCWAMgAEgEyAaYBUQKO' +
      'AhQCOQJ2AgsC5gEUAisCWQKPAlEC5wGbAcIBbgLBAnUCxgLwAuYCVwMLA9oB4QCCAFgAGAASABYAGQBWAM4ArAGWAoUD0QTmBSgGewWfBEcEJAQrA/MBOQHkAJsApQC/AAUBZQGbAZ4B' +
      'ogHTAQsCBwLXAX4BmAH9AX4CXALdAV8B/QC0AMIA1gC4AIMAbQB8AH4AgABMABcA9P/i/+L/4v/i/+L/4v/i/+L/bwDlAAABsQCgANQACwFPAf0A3QCzAK8A+QCOAdoBHAITAsABIAKi' +
      'AmYCFwIuAmoC3gJQAw4DaALlATIC2AJhAxsDQwN9A0IDJAN7AlUBowBqAEMAFAAVABgAHAB1ACABAwL5Av4DUQVtBn8GmgWPBNcDnwPzAusBKgHaAK8AlQC9AAQBTQFdAV4BYwFsAZUB' +
      'fgFcAV8BmwEXAmMCawIOAo4BFwHjALgAnAB5AGIAXABzAIgAjABYACAA8f/i/+L/4v/i/+L/4v/i/+L/XQAIAZEBVwE0ARMBcwHUAaYBLQHOAKUA7gBvAbMBmQF+AU4BtwGSAtsCfAKC' +
      'Ar8CQwMHBPkDNQOPAqUCXQP3A7sDYgOMA0IDmgKqAcUAXQA5ABsAEwAVABYAHwCHAG0BWgJUA3gExAWzBp8G0AXABL8D6AJLApcBCwHpAMEAmQDHABgBagFiASgBJAEfATUBHgEpAT4B' +
      'WgGlAfkBHwIEAsIBSgETAfsA3wCYAE0ASwBiAHgAjgBZABwA7P/i/+L/4v/i/+L/4v/i/+L/SwDvALoBCgLlAckB/gFSAk8CrQEDAfcAAQFSAV4BLQEBAeMAaAFzAvoC/wLkAhoDfwN5' +
      'BLMEMwSJAxADbgPAA3UDywIIA/sCIgIhAYYAOAAqAB8AFAAPABEAIgCLAGcBhwKcA60E3AV6BnEG/wUdBQUE+QIkAm8B9AD1AM0ApwDHACkBgwFTAScBLQEHAesAAwEdATcBUAFoAZAB' +
      'xAEFAucBoQGuAZ4BOAGuAEgALAA+AFMAXQAqAAMA4//i/+L/4v/i/+L/4v/i/+L/SgDAAI8BKQJLAmwCkAJxAi4C3QGLAW0BdwGOAWkBHQHGAL0AFgH7AbgCAQPBAu0CKAMcBM8E2wSN' +
      'BJYDGwMdA8cCKwIyAooCMwIyAZEAPQAxACcAHQASAAwAJQB3AE0BfwKtA8sEjwW6BdIF6AUxBQwE8wINAjkB7wD6ANoAtgC7ABABTQFBATQBbgEoAQYBEgEeATEBUgGKAcAB+QE9Ak4C' +
      'WwJqAvoBJQGXAEYALQAaAC0AKwD//+3/4v/i/+L/4v/i/+L/4v/i/+L/TgCcADMB/gGPArMCWgLpAYIBgwG+AdEBswGdAX8BeAEKAYgAyAB1ATMC7QKVAlMCowJvAw0EogScBIMDsgLH' +
      'Ap8CCwKYAdUBAAKBAbsARQAwACcAHQAUAAwAJQB1AEMBdwKrA4EE8ATiBE0FoQUbBeoDyQLhAR8B3gDvAN0AtQCpAPoAGQERAXUByQGqAVMBMwFBAU4BgwHoARYCPQJ1ApkCgwJfAsEB' +
      'AQGCAEkAMAAYAAgA+//k/+L/4v/i/+L/4v/i/+L/4v/i/+L/VwC4AF8BGQLKAq0CDAJjAeUAEwFeAWUBWAFBAZQB8QFXAY4ArAAUAeMByQKuAggCBAKUAiUDtgPxAzcDdgJWAnYCKgJy' +
      'ASsBnQG8AfYATQAuACQAGwAUABAALQCnAKYBtgLpAz8EKARdBPEEUgUtBRkE4wLHARIBxwDTAM8AsQCXAM4A4gAiAa4BHQIaApQBhAF1AXYBggHcAUACfAJ5AggCvgGeASUBsABeAFoA' +
      'SAAoAAcA7v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/XQDmAM4BfwKuAlsCAQJSAcIAnQDdAPkA6wDwAIcBNQKJAaQAiwAJAdABugLEAg8ClAG4AXYCPgN2A/4CfwIoAv4B6gE8AQMBkQHS' +
      'AS8BWQArACIAGwAYABQATAAbAUsCXwPJA6cDZgPpA3sE8wQQBU0ECwPIAQgBrAC4AL0AoACHALsA7gBpAfgBWwI+AugB6gGjAaUBrQHEASoCTAL5AXABLAEMAeMAkABQAFIAXABaADoA' +
      'HwAHAOL/4v/i/+L/4v/i/+L/4v/i/+L/XQC5AKcBlAKZAhUC1AF/AR4BmABuAI0AlgDLAKkBaQLQAb8AbQDqAOYBsgLRAhcCNgErAdEB0wIvA68CZAL6AZkBqwEQAfQAqQG5ASoBiAAp' +
      'ACMAHwAcABgAdQCQAbwCOgP7ArsC2wJhA+sDTAS3BDAECgPEAQMBkQCdALoAoQCOALoA9QCqAUIClALAApUCLQLOAdQB2gHYAQ4C/AGyAW0BHAHvALYAcQBLAEwAUQBdAGkASgD5/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/YwDDAHkBcgLVAg8ClgGiAXwB/wBsAEoAaACyAI0BQgK2AZgAWgC/AI8BXwKRAvABBQHCAE4BbgIVA6AC7wGHAUUBkAExAcEAKgE4AdIAYQAkACAAGwAW' +
      'ABoAYgBLAe0BKQL7AUIC5AJQA4sD9gNbBOwD0AKvAfcAdgCNANcAxQCWAK0A1ACJASUCpgISA+8CLAKpAccB8gHrAcABwAHlAbIBRgH1AJkAUwBFAEcASQBSAFYAVAAUAOL/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/bwDOAFgBUQKqAuwBXQFsAZ4BKgFgAD8AXgC/AGcBpwECAWsARQCbAB0BzAEyArgB2gCRANYA0AF/ApACAwJIAfcAcAFhAbcAyQCjAHsAUwAcABMAEgASABsANwDW' +
      'AAQBRgHTAaICQQOnA8sD1gP3A2YDgAJ5AagAbgCTAO8A/QDFAI0AyQBgAdgBJALCAssC+gF4AVQBcwF3AZgBIAJwAjwClAHiAIQARABdAF8AYQBKAEMALAD0/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/dgDKAGkBOAKBAtABNQECARMB0wBLADsAfADDACAB/wB5AD8AOQBTAJgAAwGKAS4BegBTAHMAEAGzATgCGwJUAagA4QAVAZwAUAA9ACwAFgAQAA0ADgAPABwANwBpAMoAVwEy' +
      'AhED6wNFBCgEIgSnA8kCBQIPAX0AbwDJACEBIwHOAIoA5gBTAYIBogEVAgsCtAFRARoBCAEbAWgBKwKmAmACkgHhAIMAUgBdAI8AuQBuADwADADi/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      'kgDVAGYBKwJLAgMCWAG0AJoAgABLAC0AQwB4AKoAaAA/AC8ALAAtAFQAgQDHAJkAVQAvADsAgAAWAbcBqwEzAZAAWgBmACwAHQAaABgAEwAPAAwADAALACEAQQCOAAMBxAG8AsUDsATs' +
      'BKoEYQR6A3gChAHVAHMAbADtAHQBXAHxAIgAwAD0ACcBUwFMAU8BFgH9APsA7gD4AFgBAAJpAhcCcwH0AI0AYgCLAA4BHAGiAD0A/f/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/rwDtAHAB' +
      'IgItAt0BSAGlAGsAbwBnAEQAOwA2ADsAQQA8ADAAKQAhADIASABcADkAKgAuADIARgDDADEBHwHNAG0AIQAcABsAGQAYABcAEwAOAAwACwAMACsAUADnAJQBQgIsA3cEPgVXBf8EkwR7' +
      'A0ECVQGrAGsAZwAJAbYBlgEHAXgAeACsAPoAPgEjAeYAyADfAB4BLgEyAVYB0QEwAgwClAEMAZ8AfQC4AEMBHQGWACsA6f/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/ywACAWEBxwHgAWkB' +
      '/QCHAFMATwBkAFsARQAqAFkAggB2AGEAVQAdADEAQwBCAD8AHwAlAC0ANABaALEApABWABsAGAAZABkAFwAWABUAEwAOAAsACgAVADMAdQAvAQYCqQIzAzYE6QQXBRMFtQS2A2MCLAGH' +
      'AF0AYQD8AJ4BiAHTAGcAWACGANcAHAHjALcA4gAiAXQBmgGhAaAB0QHpAR0CyQE4AacAnwCgAMMAlQBkABsA4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/7wAVAREBOwFGAfsAmABuAEcA' +
      'LwBEAFAALgAXAD4AbAB0AHQANgAfAC4ALAArACoAJwAWAB0AIgAdACIAIQAaABAAEgATABUAFQAUABMAEQAOAAoACgAeADsAnQAwAeABVQK4AkID6wNYBIgEbQSNAyoCDAFoAEoAXQC2' +
      'ACUB8gCLAFsAVABSALYA1wClAOEAJAGAAeAB/QHgAdMBmwGhAacBfwEpAbQAlwB7AFQATAA9AAkA4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/dQGwAWgBJwHZAJQAYQBMADkAJwAmADUA' +
      'FgAQAA8AIwAuADUAEQAYABcAFQAUABMAEQAPAA0ACQAJAAoACwAMAA0ADAANAA4AEAARABEAEAANAAoADQAnAEMAqADgAFEBfAHPAUAC1gJbA6EDdgOhAowBqwBlAEAAaACPAK8AhgBX' +
      'AE4ATQBKAHEAiAC3ABABogEBAm8CQQLWAasBeQE6AR0BAwH2ANMArwCDADEAEwAEAOL/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/jQK+AloCegHGAHkAYABOAD0AKwAZABoACwALABEA' +
      'EgAKAAgABwAHAAcABgAGAAYABQAFAAYABwAJAAsADAAMAA8AEAAOAAwACwALAA0ADgAMAAkAFgAxAEEAYwCKAL8A8gA1AY0B9wGSAswCSwKAAc4AZABAAFIAgQCkAIEAaABRAD8AOwA+' +
      'AGMAoAAIAdIBuwIQAxEDXQLsAccBmgFJAfkAvADKANoAxwCBACoA+P/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/hANzA8sCtAHeAHQAYABPAD4ALQAbAAwAGQAlADEADAAJAAgA' +
      'BwAHAAcABgAGAAYABQAGAAcACQAKAAwADAALAA4AEgAUABIAEAAOAAwACgAKAAkAGgAkAD0AdQCyANkA2AD2AEEBugFWAk8ChAHZAHoAQwA7AGoAmQCRAGwAfACJAFYAMwBVAMMANgHW' +
      'AdsCyQMdBHgDpQIXAu8BugGPARQBlgCSAKQAywB0ABcA4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/oQMIA30CtwHiAHMAYQBQAD0AKgAWABcAOQBHADUACgAIAAgABwAHAAcA' +
      'BgAGAAYABgAHAAgACgALAAwADAALAA0AEQAWABcAFQATABEADwANABYANwBRAHoABQGwAe0BiwFRAYkBEgJgAvQBEQGRAFwANQAqAE8AcQBZAF4AfQCJAFoAOwCVADQBBALPAsYDYQRp' +
      'BMYDBAOEAtoBcgE8AfcAeABeAIMAvwBqABUA4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/aAN9At8BRAHKAHIAXgBKADcAIwAQACcASgBhACgACQAIAAgABwAHAAcABgAGAAYA' +
      'BwAIAAoACwAMAAwACwALAAwAEAAVABkAGgAYABYAFAASAC8ATwB3AN0AwAHEAkcDqgIfAiQCgQIwAmMBswBwAEsANAAnADAAOQBCAFIAaABYAEoAawDoAKkBiQKyA3wEmgQuBLwDaQPq' +
      'AhMCRQHRAKYAWwBEAHEArwBwADwA4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/lwPRAvMBKQG1AHMAWABEADAAHAAYADgAWABHABsACAAIAAcABwAHAAYABgAGAAcACAAJAAsA' +
      'DAAMAAsACwALAAsADwAUABgAHQAdABsAGQAXAEgAdADUADMB7wExAzIE0wP6ArwCrAIJAg8BhgBhAEoAMwAkACkAKgAzAEUAQAA0ADgAgQAgAdIBFANPBNsEZASeA2EDUQPYAgwCUAHF' +
      'AIQASQA2AEkAhwBZACcA5f/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/bwMwA1MCVwGmAHgAVABCADIAIwAfAD4ASwApAAsACAAIAAcABwAHAAYABgAHAAgACQAKAAwADAALAAsA' +
      'CwAKAAoADgATABgAHAAhACAAHgAcAGIA6QBhAbYBXwKRA40EewRLA5cChQL+ASEBiQBgAEkAMwAhACIAIgAjACkAKQAvADUAigAtARwCiAPBBMYEygP5AvUC4gI9AocBIgG6AHgAQgAt' +
      'ACEAXwBFAAUA4//i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/0AKkAiYCNQGtAIIApgDEAJgALAAaADMANQAVAAoACgAIAAcABwAHAAcABwAIAAkACgAMAAwADAALAAsACgAKAAoA' +
      'DQASABcAGwAgACQAIwAiAHkAIAG8AS8CFQM4BOEESQTkAhEC5gGuAfsAxgBxAEgANAAsACoAKgA8ACoAKwAvADMAlgAjASkCawNYBBwERwNuAlsCQQKaARkB7ACuAGwAOgAuAA4ANQA0' +
      'AOv/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/+QG9AVoB/QC8AMYA+gA8AecAVwATABsAIAAMAAsADAAJAAcABwAHAAgACAAJAAoACwAMAAwACwALAAsACgAKAAkADQARABYA' +
      'GgAfACMAKAArAIoAFgGrATgCQAN8BPEECwS4AtMBhwFAARMBBAGrAE0ARwBFAEUAcgCeAFYARQBGADQAWQD5AMwBywI/AywDwgISAp0BcQEXAd8A8gDEAGEAMwApAA4ADgAsAOL/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/+QGhAVkBAQG6ANkA5QDeAJwAOAAQAA8AEgATABMAJAAmAA0ABwAIAAkACQAKAAsADAAMAAsACwALAAoACgAJAAkADAAQABUAGQAeACIA' +
      'JwAzALUAbwHkAYICkAOMBKYEvAOdAtsBOwHzAAUBBAG4AFMAQwBTAGsAtAAAAagAXwBHACYAUAC4AGsB+QEzAlQCDAK0ASgB9AC+ANQA6gDkAHIAJgASAPz/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/AAMyAnsBFQHLALUAlQBfAEAAJQAiAFcAhQBtAGIAfwCWAEQAIQAKAAkACgALAAwADAAMAAsACwAKAAoACgAJAAkACwAPABQAGAAdACEAJgBBAN8A' +
      'uAFFAvAC3QMnBJsDtQITAsgBIQHSANYApABoAEsAZAB9AJUAvwAAAacAaAA+AB4AJABmANkANQFmAZUBUAECAbcAnQClALgA0QDpAH0AHwDy/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/EATiAgQCtgGTARUBhgBPAC0ALwBCANYATgFVAfgAGwEgAcMAawA5ABMACwAMAAwADAALAAsACwAKAAoACQAJAAkACgAOABMAFwAcACAAIQBOAPcAvwGAAiwD' +
      'jgMRA3cCzQF6AWABBwGzAIUAbwBjAGAAowDUAO0A7QDoAKcAbgA1AB8AGQAlAEkAhADBAAUB2wCmAIMAfwB8AJ4A2QDlAIMA7f/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/+wTBA/MCxgKQAsUBCAGcAHMAVwBQAAcB3AEdAsQBgAFlAVcBGAHFAFQAKQAMAAwACwALAAsACgAKAAkACQAJAAgACQANABIAFgAbAB0AHQBbAO0AmgFHAucCCAOHAuMB' +
      'TQHyANIA0QCQAH0AfABwAKIAOwGbAbMBxAG6ASoBdgA8ACQAHQAXACUAPwB4AMgAmQBjAFkAVgBwAKwA5ADQAIAA4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/gQWxBCwEBgSdA7oCxgEmAeAAowCHAPIAuAFFAt4BTgECARsBRQEPAZUAQAALAAsACwALAAoACgAKAAkACQAIAAgACAAMABEAFgAYABcAGgBIAMgAaAEGAnMCggIZAnIB6wCuAJsA' +
      'oABxAG4AbwBxAP4A1QFYAnEChgKHAncBjgBRADEAJgAfACMAIQBWAIMAUQA5AD8AUAB/AMcAwgCMAEkA4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/OgUq' +
      'BSIFEQWCBK0DsALbAYUBTQE9AWMB6gEVApsB6QB3AIAAuQCpAIwAKgAKAAoACgAKAAoACgAJAAkACQAIAAgACAALABAAFAATABIAGQAsAK0AIQGAAdMB2QF/AQABsgCSAH8AcQBdAF8A' +
      'YQBkAPMADALYAs8CzgKUAqwBvwBdAEoALwAdAPL/BAAyADMAFwAPADkAVwCOALsAhwBRAO3/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/CARNBNAE7gR/' +
      'BKcDfAKVAXABfgFLASMBeQGpAUcBlwA7AC8ALwA1ADwAFgAJAAkACQAJAAkACQAJAAkACAAIAAcABwALAA8ADwAOABMAHAAmAEEAlwD3ABwBHAHEAKsAjAB4AGsAbwBNAFEAVABXAN0A' +
      '7AGuAmoCEwIVAqIBuwBEACIADQAYAAgA6f/i/xcADADi/+b//v8uAHoASgD+/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/2QLMAncD3AOuAwcDBAJa' +
      'ARAB7gDDAK0AtAD0ABUBowA7ABoADwARAA0ACQAJAAgACAAIAAgACAAIAAgACAAIAAcABwAKAAoACwAMABUAJQA0ACUAUgCFAKkAxgDNAMoAvACvANIA+wCCAEAANQBGALYApQErAroB' +
      'WwFdAVwBtgA+AAkA6//j/+L/4v/i/+b/7P/i/+L/4v/i/+X/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/+QHqAVoCtAK6AqICPgLuAYcB9QCq' +
      'AJgAjgDFAAkB0QBNABMADAARAA0ACgAOAA4ADQAMAAsACwAKAAkACQAIAAcABwAHAAcABwATACMANABDAEEAbQCxAPUALQEtATEBMQE8AW8BaQHZAGoANgA/AJgAHwFtATEB+gDUANsA' +
      'iAA7AP3/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/PwE9AaIB/gFUArMCpAJ7AvYBOQH/APIA1AC/' +
      'ANkA1gBNAB4ALAAVAA4ACwARABMAEgASABEAEAAPAA8ADgANAAsACAAGAOv/AQAZAC4AQQBZAK0ADgGaAQQCUgI8AhsC+gHiAQ0CtQERAWkASwA2AGAAqwDZAN8AuQCTAHAAVAA9AAsA' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/2ADEACAB0AGVAq8CXgJQAtgBmwGLAXQBhQFbAdUApQBL' +
      'ADIARQA9ACQAGQARABgAGAAXABYAFgAVABQAEgAPAAsACAAGAOL//P8TAFIAwAAsAQABWgEjAu8CZwOQA0oD1AJFAg8CewHfAF4AQgArAGEAoACWAIgAbwBZAEMANQAhAOn/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/kwCEAO4AzwFuAhQCrAHkATgCiwKEAmECRALCAQoBfwBSAJUAqQBv' +
      'AE4AcABeABkAHQAcABwAGwAZABUAEgAPAAwACAAFAOP/AgA8AJgApQEUAqABiwEGAsICjAPIA6ADIANWAoIB3QBrAEQAOwAlAGYAlgCEAHIAWwA+ACYAIgAZAPH/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/YgBSAI8ANgGKASsBAAF3AUQC9gInA+wCaQKbAdoAbwB+AA0BJwHWANQAKgHd' +
      'AHUAIwAiAB8AHAAZABUAEgAPAAwACAD7//r/KwBwAPsAJgLsAqkCcwJ8An4C8gLvAjMD+AIJAhQBgwA5ADMALQAfAGIAhABzAGAATQA4ACwALAAgAC4AMQDi/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/VQA0AEMAfQCxAJ4ApAAuAdIBjAJ5AiICuAEDAa0AigCvAFgBkgFmAWQBjAEeAZgAJQAe' +
      'ABsAFwAUABEADgAKAAgACQAHACAAWQC8AGABhAJ1A34DoANDA6ECIAIUAmsCcQKVAa4AUwAtACYAHgAXAD8AWQBeAFcAUwBFADsANgAqAGYAdQD0/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/cAAxAC0ANABKAGcAwABbAdAB4wF3AR8B+ACxAKwA5QAjAZQB4AGyAWgBMwGjAC8AEQAVABIADwAM' +
      'AAgABwAIAAgADAATAD8A1gBtAUMCKAOHA8IDGwTHA1ECegFaAbgBywEMAXUARwAgABoAEwALABIAKwBWAIoAjwBUAG8AWgBWAJUAuQAxAOL/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/oQBBACEAPAB3AMIAIAGZAdQBjQEKAawAbQBoAIkAAQFOAXYBVAH3AMMAcwA4ABoA/f8NAAkABwAHAAcABwAI' +
      'AAoADwAgADgAzQDSAcECJAP6Ai0DuQN1Ay0CDAHtAC8BegHZAGYAOgAUAAYABAD//wIAJwBaAIMAeQBeAHwAhgBkALgACQGcAOL/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/uQBjAC4AdADoACsBLgF/AaoBcAERAbQAZgA1AHAA0AAYAdkAlABUADkANAAcAAAA//8GAAcABwAHAAcACAAJAA4AEgAd' +
      'AC8AlQBrARICOgJBAsAC9gKrAsQB4gC0ANQAFgGjAEsAGAD0/+L/4v/s/wcAKABNAFkASAA5AHoAmQB9AN8ABgGkAOL/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/3gBwADYAjQATARYB6QDbAB4BJgESAcsAfQAvAGsAyQDaALkAZQAjAAsADAACAPX/BAAHAAcABwAHAAgACAAMAA8AEAAbACsAUQCi' +
      'AAgBUQHRAS4CGQLsAXkBAgGHAJoAuwCLADMAAgDi/+L/4v/i//3/FQAzACcAGgA0AIQAlgCYAOEA1gAHAOL/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/pABWADIAcAC1AKkAkgCEAJUApgChAJYAagAuAHEApgCSAHoAUAARAA0AAQD6/+3/BwAHAAgACAAIAAgACgAJAAsADQAZADEAVQBiAI0AvwAg' +
      'AUcBRAE+AWUBIAGqAF4AXAA+ACMAAwDi/+L/4v/i/+7/AAAOAAkAIwBYAI8AgQBpAHgAhgDi/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/OQAlACcANgBMAFYAdABiAEgANgA1AC8AHAAeACAAMAA4ACEAFgATAA4ABwDs/+n/BgAGAAcABwAHAAUA/f8GAAkACAAqAFQAfACfAJUAhgCgAMUA6gA+' +
      'AWYBNgG+AEkALgAkABkAEAASAB8AFQD9//3//f/3/wYAKwBSAGoAUwAzACcAKwDi/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/JAAVACgARABhAE4AggCaAE0AFQANABMAFgAYABkAHAAeABoAFAASABEADQDi/+n/BQAGAAYABwAHAP///f8BAAsA+v8NADcAdQC1ALkAoQCoAKEAzgAmAWIBfgHt' +
      'AFoAIwAWABsALgBJAIYAfABIACYAMQAYAP7/BgAlADUAMgAOAPj/9f/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/EgARAE4AdwCHAEoAWgBqACsA/P/9/wwAEQASABQAFQAWABIAEwASABAADQDi//3/BgAGAAYABgAFAP3//P8HAAAA5v8IACMALgBNAGIAjQDDAKwAgACxAAsBowFYAXsAIAAW' +
      'ADgATwDHACQB6AC3AGEANAASAO3/6v8AAAsAEgD+/+//4v8DAOL/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      'EAASAE4AoACPAB8ACwATAPn/7v/k/wgACwANAA4ADwAKADoA+v8OAAwA/f/i/wEABwAHAP///v8DAPv/+//6/+z/4v8JABYAJAAlAEUAhgCuAIIAWgBSAMoAfgFNAYwAPwAVADIAogB5' +
      'Af0BsAEZAYIARgAbAOL/4v/w/wgACwAAAO3/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/EQASAE8A' +
      'nwB/AP3/6v/i/+L/4v/i/wAA/f/8//r//f8KAOL/KQAAAAcA9P/i/wUACAAIAP///v////j/6v/l/+L/6P8QABcAHgAoAEUAjQB5AEwALQAuAGYA1ADOAG4A/P/i/y0ApgDDAYQCMAJZ' +
      'AZkAWQAbAOL/4v/z/wQABwD+/+3/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/CAARADIANwACAOL/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+P/6f/9//3/5f/i//3//f/9//3/+//7//P/5P/i/+L/6P8nAGsAgQBuAFQAngCbAEYAJwAcAGEAlAB6ADMA/v/i//X/lQBpAToCJAJlAaMAYQAj' +
      'APL/GAATAP7//v/4/+z/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L//v/9//n/8P/i/+L/4v/i/+L/' +
      '4v/i/+L/KwDi/+L/4v/i/+L/4v/i/+L/4v/k/+j/7//1//j/9v/0/+3/4v/i//z/4v8hAHcAxQCeAIQAvQC6AE8AIwAdAFUAlwCFADoA+v/i/+v/YQCyAEUBawH+AKQAeQBAABQAKgAT' +
      'APb/8f/v/+j/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/9//z/+z/7//i/+L/4v/i/+L/4v/i/+n/' +
      'KwA6AOj/FADl//v/8//i/+L/4v/k/+3/9v/5//X/8P/s/+b/4v/i/+b/4v8uAJsA+QDqAK8AwADFAGQAJQAfADkAjgCPADoA8v/i/+L/9f8+AGQAlQCKALwAkwBPADYAOAANAOz/5f/m' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/8f/p/+L/4v/i//v/7/8mABgAXACUAEsAAwBVAHQA' +
      'WwDu/+T/4v/+//z/8P/j/+3/8//0/+//6P/j/+L/4v/i/+L/4v8fAIoA+QANAbAAhACeAGMAMQAmAB0AUQCFADkA6v/i/+L/4v/i/+L/4v86AMQAoABqAFgARgAWAOX/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/6//i/+L/4v/i//z/SAB2AI0AqwCYAEUA8P/4/wkAJAD5/+b/' +
      '4v/i/+L/4v/i/+f/6//8//7//f/i/+L/4v/i/+L/4v8XAF0AygC1AHkATwBgAGYAPgAiAP//NQBzAAcA4v/i/+L/4v/i/+L/4v/i/54AgACmAOsAtQBKAOL/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/08AogAhAVMBEQGPACcA+P8YADEAGAD+/+r/4v/i/+L/' +
      '4v/i/+L/4v/9/+L//v/i/+L/4v/9/+L/4v8NAGQAowBrADUALAA1AEIALAABAPb/WgAbAOL/4v/i/+L/4v/i/+L/4v/i/+L/6v+wABcBKAEZAOL/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v9HAKQADQG9AfIBawGPAEIAagCYAGMALgADAOn/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/0/2cAcwA8AB0ACwANAAkAKwD2/+j/CgDz/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v8vAPoA2wDi/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/7/4UAwQCPASUCwgHiAJ8A2gAKAaUALgD2/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/l/w0ALAAWAAIAEADq//r/MQD9/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/xQA4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/x4AdwAMAcYBBQJvASoBVQFqAdMA7//i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v8hAPX/4v/i/+P/AwDi/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/wEASACTAD0BvgHHAeEB4gFmAc4A4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/AgA3AAcA4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/8P9iAK0AIwGjATUC6wEpAVQA4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      'GwDs/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v8uAGkAAQH4AYICywHGACgA4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/5f/m/+f/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/5AANwFUAqICswGZABoA4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v8TAP//4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/IABqAMkAbQH6Af4BJwFtAO3/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/',
  },
  noryang: {
    x0: -120, z0: -153, step: 3, nx: 95, nz: 120,
    heights:
      'fwfRBgsGVwVTBDYDyALKAoACQgIaAu8BYQLWA8gEEQRTA5kDKwT4A9gCTQKxAmECUQHoAA8BWgH4AVwCaQJEAqwBLgEvAfoAkACEAN0AMAETAecAxwCtAJcA4wA+AW4BSQFMAR8B7QDj' +
      'ANkArQCsANAAIAEtAegApgCLAHMAfgCKAJ8AxADjAM8ApgByAEMAPwA9ADwAOgA3AD0AigDoAE4B4gCFAOUAhgG8AVwBxAB2AFQAQwBIAE8AWABvAJcHnwanBeYEAARLAwQD9QLfAtMC' +
      'fgIwAlwCigNKBPwD+AMxBEIEfwOVAuUB0gF4AR8B4QADAVsB8wFUAm4COAKqATQBTQH9AJEAkADMAAEB7gDgAL4AqADLAOYAFQEdASEBTAEdAekACgH9AM8ArADwADoBOgEhAeEAugCn' +
      'AKMAegB3AJoAsQCRAIQAVQA9AD0APAA7AD4AYABYAF8A0QAoAdQAigC8AFwBvQGJAf0AmwBkAFcAUQBHAD0ARQB2B+kGIQYQBS8ElwM7AwUDYQP4A50D0gKwAhYDzgMcBKwEyQRZBKUD' +
      'GAM/Aq4BSQEEAeAA/QBaAesBPAJfAjQCsAE7AUkB9ACiAI4AhgCoAK4ArwC0ANwAAgEcAS4BCQH7ABMB7ADeAAgBEAHcANQAEQEqARQBDAEFAfQAAQH9ALYAawBtAGgAXQBeAD4AOgA6' +
      'ADoATgCCAKMAewBPAH4A1QDFAIQAhwARAXABXQEfAbQAZQBVAEwAQQA6AEYAOwcRB4cGlAUvBZ8E+AP/A44EIAWMBJwDRgNeA8QDQwToBPsEeAT9A50D0gLTAVwB8gDcAAABgAHaAQoC' +
      'DALvAZ0BPgFGARMBqACFAH8AegB+AJUAwAAJATkBSAFWAUUB6wDRALIAxQDjAOgA4wD8ACkB8wDdAAcBAQEOASIBCwHDAHgAYwBhAFUAQgA5ADsAPQA/AGgAtADRAK0AeQBKAIAAhgBe' +
      'AG0A0QAkAQ8B7wCwAFQASABCADsAPQBhABIGlwafBnEGPQa3BRwFPAXYBSoGWQVfBNIDdwNhA+8D/wQWBY8ExwMqA24CtwE2AewA2QAbAc4BKwIYAsgBfgFbASMBPwFTAeIAiwCNAIcA' +
      'eACQAM8AGAE/AUEBWAFtARwB0gCtAKAAugC6AMIAGwEPAdcAzQADARUBHwEYAfIAwgB4AGMAcgBrAF8AWQBSAEwARQBxAKoA4wDiAKUAYwBVAEkAWABnAKgAxAC0AJ0AdwBCADwAQgBI' +
      'AEkAdADnBG0F+gVcBmwG/gWeBeUFjwacBrUFsgTVAxgD8gLUA+8EAgVvBHsDqgIkAokBMAHpAN0AJwHnAUECDwK/AXABIAEcAU0BeAEqAbkAngCLAHgAlQDdACQBSwEYASQBSgFNAfoA' +
      'zgCiAJAAmQCjAOAA9AC+AMEA8ADmAOIA1AC1AKcAdwBiAHIAeABtAGEAVQBJAFIAZwCeANQADgH1ALsAkQB4AIQAkQCBAGEAXgBHAEoAVwBeAGUAZwBiAGwACQRXBOoEawWrBU8F8wRa' +
      'BcMF0QULBVwEdgO3AtsCuwOXBM4EOARtA4kC7wF1ASYB6gDPAP4AmQEAAt8BjwE/ARABFwFXAZQBcwEJAcoApQCBAKMA6gAxAVkBLQEAAR8BRgEmAfcAvwCoAK8AoQCYALQAsgC/AMIA' +
      'sgCoAKoAlgB7AG0AYABnAG0AYwBYAEwASQBmAG0AlgDMAA4BZgE8AVIBJwEpAUMB/wB/AFYATwBkAHcAggCEAIYAggByAFEEpwMGBGAEmQSXBEEEUQSlBLcEHwS0A0kDuQLEAmQD6AMy' +
      'BDgEtgOgAvEBZAEuAfcAwQD5AEwBvwGuAV8BMAELARIBUQGGAaQBZQEcAe4ApQCPANYAHQFSAV0BMgH+ABsBPwERAdMAswDZAMkAigCWAMAA0gC6AKgAxwDJALYAmAB4AFcAWQBfAFoA' +
      'TgBFAF4AegB/AI0AxQAOAWgB9QFLAh0C/AEJAp4B7ABlAE4AXgBtAIAAlACkAKIAkQD7BOEDhgOLA4wD1AMVBPYD4QPSA2cDFwPbAowCuQJbA1gDVgO0A4kDkQLjAU4BMQH8AMoABAFR' +
      'AYgBfgFPASoBBQELATMBVQF3AXQBSgEGAbwAfgDCAAQBOQFNAVIBFgHqABEBFQHnAL0A5QDgAKAAkADEANgAuACrAMAA3QDVALgAjQBtAFMAUQBRAEUAVAB0AI0AkgCXAMIACwFeAQQC' +
      'vAIdAwYD2AJFAnoBswBzAEQAUQBmAHoAjwClAKUApAUDBWkEkQPjAj4DAgT4A8YD0QO4AzYDqAJTAoECEwP4ApIC6wK5AiwCpAE2AR4BBAHUAPAAWQGCAYABRgEcAfoA6gAEASQBRgFk' +
      'ATsBAwHLAIoAqwDrAB8BKAFCARgB1ADtAAYB4QDGAPUA8QCvAIEAsAC0AJ4AkQCWALEA3gDQAKIAgwBoAE4ARwBLAGoAiQCfAKQArAC+APwATAG/AX8CEAPpAp0CUgK2ARcBuQBXAD4A' +
      'SwBfAHQAiwCiAIEGJgaaBT8E4QLfAugDTARjBJcEewSjA8MCMwImAqACgwI1AjEC+QG+AWsBDgH8AOoA1wDcADUBeAGYAXEBDAHzANgA6QACARsBOAErAfUA0ACtAJUA1QD/APMAHAEU' +
      'AdIA5QAAAd0AwQD3AP4AvgCBAJkAlwCCAHYAdACCALEA3QC3AJkAfwBkAEMAWAB6AJwAswC8AMYA2wD1AEUBxQGEAvsCywI4AtEBgAEXAckAZwBNADwARQBaAHEAhgAqBvMFxgV+BAID' +
      'lAKpA6QEBgUNBZoEqgPKAkgCCwIKAvcB8gH1AfABzAF0AQIB6ADWAMYAywDrAC8BbAFSAf0A5gDOANAA6QAJASsBIQEeARIB2QCFAMMA8gDVAOgA4gC7ANEA8gDgALkA0ADvAMUAigBw' +
      'AGkAZQBcAGAAZwCNALUAywCtAIAATgBDAEYAZwCJAJoAtADOAOUA8gApAdcBdAIRA1ED7gJnArMBDwHOAHYAXABLAEAAPQBRAGUAiQUpBeEEqgOLAmUCkAO1BFYFTwWEBIcD4wJfAigC' +
      'FgJLAnMCjgJvAiICqQEwAd8A0QDdAOoA4QDpACUBGQHxAOkA2ADEAPIAFgEzAfkA9ADqAM0ApgCiANAAxgC2AK4AoQCtANIA7QDFALMAzQDVAKYAcwBmAFoAVABUAFcAdgCXALIAkABd' +
      'AEcARwBGAFIAawB3AI0AqADDAN8AAQGEAQIClAIWAyMD0gL2ATYB2QCFAHgAeQBvAFcAQgBEAKgEQwTLA7QCEAJgAoMDjgQ4BYEFtwTnAzYDfAJJAqwCEANPA/cCaAL2AZMBMQHgAOkA' +
      '+QAIAfcA4ADtANsA2gD6APcA1QDWAA4BOQEpAe8AwACqAJUAhwCgAKIAlgCOAIkAigC1AOwA0wCrAMcA7gDBAIkAbABjAFsAXQBrAFQAYQB7AGwASwBKAEoASQBJAE4AVgBnAIMApgDP' +
      'AAYBawHQAQsCLQJJAi4CywEwAdIAigCnALEAnACCAGcASQBLBOEDcwN/At4BPgI+A0gEGwWkBTcFeQSiA68ChgI2A5gDnwPmAioCvgF1ATMB9gAAARABDAH0AOAAzQDBAMEA4wAJAe4A' +
      'xwDwACcBWgEvAeYAtQCmAJ0AmACvANIAuQCcAHkAlQDGAMoAqgC/AO4A0QCUAG4AawB7AJsAhQBaAFYAUgBRAE4ATQBMAEoAUQBZAFkAVQB/AKgA1gAUAWIBZwFyAY8BywEFApQBMAHH' +
      'AJIAsQDOALYAmgB9AFcAWgSVA1MDYwLTASACKQNKBD8FcQUwBb0E2wPeAsUCdAPBA3MDyQK1AggCiAFKAQ4BGAEfAQYB6wDVAMMAsQCoAMgA5gD0AM4A0QAEASwBKwHtAMMAuwDTAOIA' +
      'BwE2AQkByAB9AH4AlACrAKUApQDJALoAiwBlAG8ArwDOAJgAZABYAFIAUABPAE4ATQBMAFwAZwBjAFQAfwCsAN8AEQEeASUBKwFRAY8BzQG2AWMBBQGkALAAzwDMALAAkQBlAF0ENgPH' +
      'AjECwwEvAgEDBgTGBNkEiwSLBNUDFAMmA74DpQNLAzQDggPUAuABYgElAS4BGgH/AOQAzQDFAMcAuACmAL4A2ADXAMQAywDvAAgB3wDTALEAogC+APQAQwEMAbUAhACAAIYAewCMAIUA' +
      'mgCKAHkAXwCVAMgA1wCiAHoAZwBTAFEAUABPAE4AVQBnAHUAYgBSAHcAfwCgAMkA2wDmAPUAFQFSAYUBoQGYAUEBwwCuAMwA4QDGAJ8AcwDUBEUDmwInAsUB9wGGAi4DngPQA+UD7wOb' +
      'Ay8DiQMFBNIDuAMHBFoElwN3AqsBPQEvARUB/QDqAOIA7QD6AN0AsACkAL0AxgC/ALQAuADZAPEA4wDOAJYAjAC3APsA/QC3AIEAfQCKAIoAbwBrAGkAYQBlAGoAnQDOAN0ArgCjAJUA' +
      'awBSAFEAUABbAHwAiACAAGIATgBaAGQAdACaAOMAGwEKAQMBFAFSAZwBowFLAd8ArgDLAOkA2QCtAIEAMQX8A0cDkgL8Ac8B8QEwAnsC+gJFA1oDZgNVA84DSwRkBHAErARxBJMDlQLa' +
      'AV0BMwEcAQ0BDQEHAeYABQHzANEApwCiAKYApwCfAKAAywAKAfoA4gCrAH8AhACVALEAwgCEAHsAiwCaAIoAcQB8AIoAlQB+AJ4A0wDnANkAzAC3AIsAWwBSAF0AgQCjAKsAjwBxAFcA' +
      'TgBWAG4AnQDpAGABcwFyATwBVgGMAZEBTQHwAK4AzADrAOcAuwCPANsF7wRPBIwD1gIQAo8BaQGxAXMCBAPXAt8C/QK0A3kEogSvBKUELgQ6A3sC1gGCAT4BMgExAS8BKwEGAe8A2wDG' +
      'ALwAsgCnAJ0AjwCTAMIADAEBAb4AmwB+AHwAgQCAAHsAgQB8AIwAmwCkAJ4ArQC8ALcAnACcAM4A2gDIALUAoQCEAGcAXAB/AKUAygC8AJ0AfwBoAFwAUAByAKIA7QBOAaQBvwFfATsB' +
      'WAFgATUB4gC5ANIA8gD3AMsAmgAkBuUFUQWmBNsDCgM2An0BSwEKAsoCnQJfAn8CFgPxA0QEwwOhA6gDbAPhAi8CoQFqAVYBVAFSAVABMQEjARkBDwEFAfsA8ADNAKsAnwCyAPoA1gCZ' +
      'AIYApACqAIQAewB5AHsAlgCiAK8AsQDFANQA4AC9AJgAoQDEAL0AqwCZAIcAawBlAHEAdQCYALMAwQCrAI0AeQBtAFoAiAC2ANUAJQF5Aa4BXgEfARkBJQEpAQMB5ADbAPkABgHPAIgA' +
      'mAUNBq4FJgV7BMwDwAK8ATMBrwGWAo0CEQITAp0ClAPkA/8CgQLAAvIC5AJeAsQBmgF3AVYBUwFZAXMBawFgAVQBSQE+ARAB1QDFAKAApADQAJ4AgQCwAMwA1QDXAK8AggCVALUAxgC1' +
      'ALEA2QDrAN8AswCZAK8AxwCxAJsAhgBvAHEAgACMAI0AigCMAJcApgCbAIkAdgBjAI8AtADXAP4ATgGaAVwBHQHiAPkAFAESAQ8B/AAPAQ0BuwCGAHsERAXcBFgEBATVA88CwwE0AYUB' +
      'ZQJVAuMB0QFZAmED1wPdAg4C/AE2AlgCNwK/AZcBbgFFASkBSAFnAXUBXAFLAToBKgEXAeEAxwCiAJYAngCEAIMAwgDzAPoAAwEDAcwAsgDRAMAAnwC5AOIAAAHYAKoAqgDQAN0AxwCv' +
      'AJIAdQB5AJoApwCjAJ0AlgCZAJ0ApQCmAJMAfQBpAIwAygAJAVQBUwEVAdgA5ADqAPQACAE0ATYBOwEeAcEAlQCXA3EEPQRkA2kDgAPGAsMBMAFOAcABDALNAbIBdAJrA9cDJwMjArkB' +
      '3AHmAb4BvQGeAXoBUgEhATMBVAFvAVUBNwEkARYBBwHwAMkAowCIAH8AdwCAALQA7wDtAOcA9wD0ANgAzQCxAKAAyADyABQB5QC7ANIA9gDtANAAsgCVAHgAdwCbALMAtQCvAKkAowCm' +
      'AMQA5ADIAKYAdQCDAM0AEgFDAQwBzgDTAOkA+QDzAAsBLwFZAWkBMgHuAKwAzwKjA98DLwPtAuECXQKYAUMBEQEzAYUBqAHBASUCLQPrA3QDdwLlAY4BhAF2AacBsgGNAU0BIQEaATsB' +
      'YAFVATEBLAFTAU4BRAElAegAjwB/AHwAgQCgAN0ABgHkAMoAygDGALYAnACyAN0ABwEpAfwA2AD7AO4A2wDIALUAmAB7AHUAlQCwAKUApgCpAKwAtgDgAAUB6wC1AHwAZgCuAPkA+ADF' +
      'AMMA2QDuAAQBDQEtAU0BZwF5AVIBEAHOADACBgNyA+QCYgI/AvwBKgLwAVEBEAFTAXYBuQEYAskCsgO9A9ICRQLmAXkBTQGFAcABjAFGASEBGAEdAUIBRgEgAQ8BTQGKAYgBbwEoAbwA' +
      'owCWAKEAmwDTAA4B7wC8AKQAowCcAJ4AsADvABoBPwEXAf8A+QDWAMMAsACdAIoAdwBwAIsApgCkAJUAlwCbAMMA8AASAfQAuwCCAGQAkAC9AKAAqAC8ANEA5wD9AA0BHgEvAT8BWQFY' +
      'ARUB9ADUATECxwLrAn0CLwJjAqwCMAJhASQBhQFmAZEB7AHMAqsDqwPrAnsCJgK5AUsBZgGLAaMBegFRATsBKAESAf0A/QDzACcBTwF1AXcBTgHqANQA0gDRAKUA0gAJAQgB0ACWAI4A' +
      'oQCnALIA6wACAQgBFAEHAdMAvwCrAJgAhQB1AGUAagCCAJwApQCTAIUAoQDKAOgA8ADyAMAAiQBmAG8AewCNAJsApACxAMYA3ADfAPUABwEYATwBWAEuASsBrAGPAQUCRAKyAuMC/wLM' +
      'AvsBJwEiAbkBlQF+AQsCCAO/A2YDswJAAjICzgFrAS0BMwFVAWYBiQF8AW0BVgE+AR4B8QDlAA4BNQFaAVsBFwELAfUA3gC7AM0AAwEeAd0AnAB+AK0AvgC0ALQAvQDMANYA3gC6AKcA' +
      'lgCGAHUAZQBVAGQAfACVAJ8AjQB4AIUAogC/AMkA6wD7AMEAhwB+AG4AgQCNAJYAnwCoALcAuADFANwA9QAYATwBOQEkAfEBZwFrAeIBkALyAhADzALTARUBCwF9AW0BYgEdAgIDKAPP' +
      'AkICDAI9AuMBhgFJARkBAgEZAVEBlQGzAZgBagE7AQ0B7QDTAPQAEQEfAQMB8wDjANYAwgDDAPkAJAHtAKsAegCnALQAmQCeAKMArQC3ALcApwCWAIYAdgBmAFUASABeAHcAhACFAHsA' +
      'agBxAIgAtADPAPgAKwH/ALYAqwB9AHUAfwCIAJoAswDKANoA6gD+APgA4QD5APcA7gBRAroBRQGUASQCWAKyAngCtQHtAOcAIAEoAU4BNgL2AqUCGgLBAb4B7wHzAaYBagEvAQcB8wAO' +
      'AVMBkgF7AUYBDwHfANoAyQDNAMYAxwDJALwAugC5ALYAuQDqABoBAAHSAJ4AfACSAIMAiACUAKMArwC3ALMAlgB5AGYAVgBFAEAAWABjAGwAawBhAFcAbwCwAOwACAEwAU0BIAHcANQA' +
      'owBtAI0AqQDGAOIA8gD6AAEBCQEFAesA0QDmAPwAkgIPAooBRwGYAcMBPwIWAl8BzACiAMMA4gBBAT0CxwJyAuMBjAF8AbMBwQF1AVABNQETATQBNAETAUMBNQEHAdcAqQC1ALAA9AAC' +
      'AewA0wDiAOEA4ADaAM8A3QD8AAAB/AC8AHUAcQBuAHsAigCZAKYArgC2AKMAhgBoAEwANgA4AEIATABVAFAASwBcAHgAxwAUAWsBmgGCASwB/AD/ALQAcQCgALwA2QDZAMMAwgDDAMkA' +
      '0wDbANEA7AAgARICFwKzATgBHwFKAZoBawEIAaQAoQDBAO4AOgEvAsECcAI6Au0BmgGCAXoBZwGAAacBmAF+AaYBWgH9AOUAwwCsAKsAngDcACIBQAEpAQwB9QAoATEBKQEUAekAuADB' +
      'ANIAywCIAFUAYwByAIEAkACdAKUAoACKAHAAVQA7ACcAOAA+AD4APgBMAGAAdACIALMA5ABGAbsBrwFEASgBLAHVAHoApADOAM4AtACaAJsArwDIALoAxADNAPYAPAFcAW0BdgE0Af8A' +
      'zwDkALAAlgB4AKMA7QAuAUEB7wFZAnMCbQItAuYB4wHjARcCEQIzAhkC1AH+AfwBdQEEAeAA3wDbAJ8A7ABIAWkBWwE5AfsAFwFTAU4BJQH3AMQAmQCmALEAdgBVAFEAZQB3AIYAlACS' +
      'AH4AagBRADYAIAAnADYAVgBpAGoAeACIAJcAqQCmALcAEAGcAbwBbgE5AT0B7QCVAJUAwAC0AJwAngC8ANUABgHtAMwA0ADZABoBMwHjAPAALAEOAesAwwBxAG8AnQD5AGcBcwFjAeUB' +
      '8QEPAicCRQJMAmIC3QJGA/4CbwI6AhYCRgJ2AvABRgEmARYB5ACaANwARwGSAXkBWAERAQ0BSQEkAQcB6wDOAJIAhACSAHgAXgBEAEsAXwB0AIYAcABcAEgAMQAZAB4AJwAyAFQAegCa' +
      'AKsAvADVAOkArwChANkATQF3AWIBQwE5AQMBsQCDAJcAmQCiAMIA4QACATgBOwEaAf0A6ADtAJ4BAgHDAPYAHQFeAT0BmwCEAPkAsAHuAYsBfwHSAa4BrwHDAeUBTQIZA7ID9AOCA9oC' +
      'fQJkAp4CugI+Aq8BUQEoAd8AmgDEAC8BigGEAXABOgElAUEB+gDZAM8AvwCJAGcAfwB/AGUASwA9AFgAdgBuAFcAPwAoABIAGAAjAC8AOwBIAGoAjQC4AO4AGgERAckAtQDCAPMAKgFb' +
      'AVABQwETAcAAdwCTAK8A8QAGARcBNAFqAaQBigFqAVIBUgG/ARoBmwC6AAIBegF0AbwAmwBRAQMCQwLEAYEBnAGHAV8BcgGkAU0COwP8AxcErwNqA0gD/QIFA/0CiwL/AXMBKwHnAJ8A' +
      'pQAOAVYBQQFIAWUBRQE9AeUAwwDEALAAegBYAG8AggBqAGQAZgBpAGwAVgA/ACgAEQARACAANQBCAE4AVwBeAHcAqwDnABsBEAHbAOMACQEUATABXQFfASsB6wCiAIMApADiADEBawF4' +
      'AW4BnAHtAf4B5wHTAeUBVQHtAHkAiwC8ACwBSwHMAKIASwH6AQwCmQFVAVQBXAFiAXwBvAFsAg4DngORA2MDiwPIA5sDZwP5Aq0CRQKeATQB7gCkAIYA3QAiAQ0BFgFeAWYBMwHYAK0A' +
      'uQChAHUAVABlAH0AdwBrAGEAVwBNAD4AJwAQABAAFQAbADIASgBgAGsAcwCEAKwA3AAVAQcBHQFCAWoBdQFcAXMBbAEzAe8ApwCOAMEADAFZAagBxAG+AdgBYQK5AocCMgJqAj8B2AB6' +
      'AGUAcwC6APQAmADPAGkBGwLsAXUBOgEoAUsBngG2AbkBYwLPAsMCZAJIAqkCbwOfA0cDuwJCAvMBpAE9AfYArwBtAKkA7gD6AOQAJgFzASYBygCMAKgAmQB3AFUAXABwAGMAVQBHADkA' +
      'KwAeABAAEAAUABkAHQAsAEQAXAB5AIsAswDiAAcBJwFYAXwBngHKAdABlAF+AXQBYAEPAb8AnADQAPMAEAFkAYcBhAH9AcICPgP5AtAC/QI4AdwAiQBcAF0AXACAAJ8AFAEEAnUCAQJk' +
      'ASoBBQFTAacB2AHeASwCcgJBAqkBiAEcAtUCUQMSA6gCKQLWAYQBKwEkAe8AoQB0ALQA5wDiANgAHgEMAbwAbwCMAJ0AewBYAFUAXwBRAEMANQAnABkAEAAPABsAGAAcACEAJgA9AFMA' +
      'YACaAOYAFQEWAVYBigGxAeIBKQIoAr8BfgFTASIB4QDKAMsApACvAMUA5QANAUEBrwFTArACygL9AlEDwgDQAJ4AXABHAFEAfwDAAJ8BowLOAh4CYQEoAfUALQGKAdUB1wHeARgCAwKI' +
      'AU0BzQF3AqUCaAJMAiQCygFkAQgBEgErAd8AjgB5ALoAxwDNAM0A5ACZAFIAfwCiAIAAVwBQAE0APwAxACMAGQAUABAAFAAdADMAJwAlACkANwBEAEcAhwDkABwBHQFUAZgBvgH7AUwC' +
      'SALjAaoBZQEYARMBCQEmAfQAwAC+ANEAHAGmAc0BBgJTArcC4gI4A0IAWwCDAHcAXABwAMYAPQEvAgID8AI1AnkBOgH1ABcBcgG9Aa8BlwGjAcEBfAEuAW4B2wH7Ad8B0AHVAaMBPAHw' +
      'AAIBIgEQAcIAdwCBAJ4ApwCwALgAfgBKAHQAogCBAFIARwA7AC0AIwAeABkAFAARABgAHwAxAEsAQQAyADIANgBDAFkAqAD1ACQBLwFzAcsBAwIEAjACEwLkAYMBRwFPAUgBbwFVARcB' +
      'zgDwAGoBLwJVAnIC7wI3A14DaQMYAC4ATABpAGAAlwAxAesBsgIaA54C1QFfATYB8wADAVUBiQF1AUkBMQFRAWYBEAEdAVgBhwFnAVEBWQFjARYB6ADMAO8ACAHlAKAAVgB0AH0AhwCb' +
      'AHQASABnAJsAewBNADgALQAoACMAHgAZABQAFgAdACMAKwBFAGAAXABOAFUAUwBTAG0AuwD/AAcBOwGSAaQBxQEAAioC8wGVAXgBgAGJAboBswEXAeUANAGwAaMCHwMpA0sDKgMhA24D' +
      'GQAjACcAPQBXAH4ABwHYAYkC6wJwAqoBMQEOAekA6gAgAVQBJwH7APcANQEpAe0A4QANATYBGQH3APAA/wAVAe0AwgC6ANAAsgCUAG8ASwBWAGcAgwBqAE8AUgCOAG4ARQAxACwAJwAi' +
      'AB0AGAAUABoAIQAoAC4APwBaAHQAmQDBAK8AfQBhAH4AswDKANUABAEvAYsByQG8AeABtAHcAdYB4wEGArsBFwEFAWgB/AH6AqwDyAMjA3ICTQLCAhoALwA9AEEARABiAOkAfgEfAqYC' +
      'XwKEAR0B/wDbAL4A6gAcAfIAxgAaAWEBMAHtALwA1QD6APYA0gCtALsA7gAAAc4AnACGAHoAbQBhAFkAVABSAG0AagBOAE0AgABoAE0AMwAsACcAIgAdABgAGAAfACUALAAzADoAVABu' +
      'AIgA4wAmAQcB0gCkAHkAjQCbAK8A7QBMAWQBTgGZARUCXgJcAj4CNQKyASEBIwGOAT0CFwOIAyoDVgK5AbMBEwIgADcAUABXAFoAaAD2ALwBhALeAkECVAEJAfQA2QC7ALMA4wDUAL0A' +
      'BgFGAUQB/QCwAJ4AugDLALIAkgCFALgA8ADkAMAApQCYAIwAhAB9AGIAQgBXAGEASABTAHEAbgBWADwAKwAmACEAHAAYABwAIwAqADAANwA+AE4AaACCAKoAEAGQAbwBXgHIAK0ApgCU' +
      'AL8A8wAIARsBlgE3AoUCtAJ8AjACowE4ASIBSgG8AZICwgIyApsBTgFOAZ0BKABAAFgAbQBgAFsAzADQAcICsQIGAiIBBQERAfAAswCTALYAxwC0AO8ACAEeARIBwwB0AIIAnACjAIwA' +
      'dgCJAMsA3gDoAMUAuACwAJUAeQBcADQAPgBKAEEAVQBYAFgAWABEACwAJgAhABwAGgAhACcALwA2AD4ARQCIAJIAnACvAOIAlgEvAkACjwElAeMAsgCvABkBZwFpAXIB1QELAlYCdAJI' +
      'AvkBkAE9AUEBUQGrAa0BfAFHAWMBhAG7ASQAIwBAAFkAXABFAJ8AowFhAjACiQHgAAcBNgEXAdkAlACOAJkAoQDEAPgAGQEOAbkAaQBfAG4AhgB1AGEAigCqAKIAsADIAKsAhwBrAF4A' +
      'QwA8AD0ANwA5AD8APwA/AD8APwAzACUAIAARAB0AJwAxADkAQQBIAHgAzgAvAVoBKwEpATcBrgE5Ak4CygE9AdAAoAAKAYkBsgG5AaIBkgH2ARUCMwIjAsMBWQFyAXcBQgFgAYcBlAG2' +
      'AckBIgIpABwAHgAuADsAPgB1ACwB2wG2ARsBuADnAB4BIwHjAJ8AcQCIAJ4AxgD4AAAB2wCbAGQAWgBSAFoAXgBdAJUAkQBzAJcAuQCOAF0AUABCACsARgBMAEYANQAxAC8ALQArACoA' +
      'KAAhAAQABAAbACYAMAA7AEUAaQDSAIABDQIlArQBugGXAWYBjgHgARICtAE/AcQAzAA0AZ0B1AGeAXMBoQGOAbUB6wG+AXABjwGYAVgBpAHyAQ0CygHnAaACUQAtACAAGgAiACsAbgDY' +
      'AHIBaAHqAJ8AwwAGAe8AsQCdAG0AiwChAMkA5QDMAKcAegBgAFUATQBFAEIAYwCHAHQAVwCCAKoAjABuAFUAPQA1AFEAXABQADAALAApACgAJgAkACIADAD6//z/GgAlAC4ANAA8AG8A' +
      '6gC/AckCxgI9AkYCSwKvASwBMAGHAeQBfwH2AMsAxQD8AEIBGAFBAWwBbgGoAfoBuQGYAcsBvgFuAZ8B9gEiAvUBJQKXAqEATAA0AB8AIQApAIIA9ABNAUUB7ACRALEA7wDBAIMAfwBp' +
      'AIgApADEAK4AnwCNAHQAXQBQAEgAPwAzAEoAWgBFAEIAYwCLAJkAhwBrAFoAXQBhAGsASgArACcAJAAiACAAHgAZAAEA+P/7/xoAHQAkACoAPQB0AP8A0QHeAmID/wKxAqgCPQKLAQoB' +
      'VgG7AasBbQE2AfAAxQC+AOEAIwFTAZoBHgJDAgEC1AEGAtwBjAGuAQ0CZQJ/AoQCcwIXAc4AuwB4ACMAJwCMAA4BbgEwAdsAgACgAMcAlwB0AGoAegCZALgAxwC5AKsAnACHAHMAWAA+' +
      'ADEAJQAwACoANgBOAEsAYgBvAHwAggB8AHYAbwBhAEMAJgAjACAAHQAbABgADwABAPz/DgAdAB4AIAAhAEQAeQAHAYkBSwIDA3oDdwNjA7wC3QE/AVMBxwEyAgkCowFOARoB6QDqAEoB' +
      'hwGtAUECpwJ9AhIC7gHlAeQB0wFVAvYCTAPgAskCZAE5ATUBwwBBACcAlAAUAVgBGwHHAG8AhwCdAHEAZACBAMgA+QAZAS0BMgEnAQABzAC5AHUAUgA5ACAAEgAoAEAAWQBfAEwAVgBm' +
      'AHAAbABkAFwASwA4ACEAHgAbABgAFgAQAAgA//8AAA8ABgAGAA4AJQBHAHsA3gB0AS0C1gJ+AyME+wMbAyUCdQF1AVcCywKyAjgCpAFZAVcBMwFGAZMB8gE5AsIC9wJZAusBDQIyAgIC' +
      'aAJuA6wDDwMiA/YAzAAXAfQAUQAxAJ4ABQEaAf8AswBdAF4AdABgAIoAxgAXAZMB8QEjAioC9wGaAR8B6gCMAGoAUAAuAA4AJQBGAGQAdABcAEcAUgBZAFkAUgBIADUAIQAnACYAJQAj' +
      'AB4AAQD8////BQD+//7//v8UADMAUgB9AN0AmQF0AhsDoAPlA9wDPANtAsUBfQEHAqkC9QKvAvMBiwHsAeEBcgEPAq0CegK7AgsDmQIAAg0CSwInAloCNANHA+kCJAOwAHUAsQCwAFkA' +
      'QQC0ABMBKwHwAI8ARgBIAFQAkQDPAA0BqQGSAj4DjQNaAw8DfgKxAQMBpAB+AFYALQARABUANgBYAGoAVQBDAD0AQgBHAD8AMgAeACcANQA0ADMALgAnAAwA/v/+///////+/wMAIABA' +
      'AF8AfwD6AJwBCwJvAtEC+QJRAzwDpgLuAXYBiQEoAgEDxgL/AawBOQJcArQB3gF+An0CugLrApcCGwICAjwCRAJQAuYCGQMXA4UDtwCBAHMARQApAEgAzwAqAT0B0ABpADwAQgBOAKAA' +
      '9QCOAYEClAOaBKUEIwRtA8MC+AEzAcAAfgBVACsAFAAOACcARwBEADcATABRAC8AMgAtABsAJAAyAEEAQwA+ADcAMAAeABAAAwD9//z///8TACsASgBqAJgA5gA4AXAB0AEQAloC7gI1' +
      'A60CDgKrAW0B4QGxAqMCDwLxAVMCZAKpAYAB5AFAAq4CxAKFAiwC/wEvAmYCQALRAjUDfwP7A+gAxwDBAGsAIgBGALoABQHeAJkASgA3AEIAVgCaAPgAxgH4AjoEPQUuBVsEkAP3Am0C' +
      'mgHqAIMAUwAqABcAEAAXAC0AIQA2AFQAawBFACEAGAAhAC8APgBMAE4ARQA8ADEAJwAXAAQA/f/9/w8AIwA5AFUAfQDvAEoBqQHMARkCSgKvAm0D0wM7A20CCQLDAY4B4QEnAiwCDwJJ' +
      'AjIClgE5AUwBxQEoAi0CKwLaAbgB/AElAgoCmgJCA7AD+QMUARkBDAGWACYAQABtAI0AZQA3ADIATABcAHAAmwAaAQECPgN8BJQF6QU2BbsEHARUA0ICMwGbAFgAKQAaABMADgAMAB4A' +
      'PwBfAFcAOAAaABQAHAApADYAQgBIAD4ANAAqACAAFgAHAP//AwAZADEASABhAMMAKAGVAR0CRAJhAp4CKQPeA1gEtgMJA8wCeQLHAYgByAEHAkcCaAIrAqUBTAEXAUcBeAGTAawBbgF7' +
      'AcEB0QG3ATUCywKnAwgEHgETAfgAlQAvACUAPgAoACEAJQBSAHQAgQCOAKIAJgH+AUADdwS4BZMGkwYOBgkF7gPTAqgBvABdACkAEgAJAAAADgA1AE4AVAA5ABwAGAAYABUAGQAmADIA' +
      'OQA2ACwAIgAYAA4ABAD//wEAGgAzAFEAcgC6ABwBpAE+AoQCogIeAwYEjwTlBI0E8AOHAwEDFgKNAbUB6AE8AoICPAIAApwBPgFWAV8BXgFnAS8BOgFiAXMBiQHBAVICSAMMBOgA2QC1' +
      'AIwARgAxACQAIgAlAD4AdACNAJIAlgCiAAwBxQHRAukDDQVNBgwHXwYLBfsD2QK3AcQAXwAqABMA/P/4/ywAOwBDADoAHQAbABsAGwAZABYAFwAjACoALAAkABoAEAAGAP///f8BABwA' +
      'NgBhAIcArQAYAd4B+QKqA7gD3gPMBLIF6QWKBdIEowPgAigCqQHCAdEBGAJ1Ao4CWgLqAaoB6QE5AgwCjwFnAVQBXAFYAW8BkQHVAYYCTQOqAI4AcgBrAHkAewBlAE0AMgBBAF0AXQBb' +
      'AGcAlgDZAHoBiQKRAz4EOAX1BWMFXQSAA2ICVAGoAFMALAAMAPz/9f8fADAANgAfAB0AHgAfAB8AHAAZABcAFQAaAB0AHAASAAIA/f/8//3/BQAdACYARQB0AKMAIgEdAlQDiQT5BAgF' +
      'YAU1Bn4GAwa6BFMDgAIOAgsCUAJRAjsCagKgAlsC5AHZAZUCRgMKA2wC+wG9AbsBnwFrAXsBoAHlASECfgBdAHwAjAC7ALkAnQBwAFUAWQBaAFYAUgBcAIsAvABBASICzgIoA60DRwTv' +
      'A0kD2QIDAgsBiAA7ACUAGwALAPj/BAAlACAAIAAhACIAIgAiAB8AHQAaABQABgADAAIA/P/3//b/+P/9/wwAHAAlAC8AVACHAPoA1gEqAzkEVwX2BUQG7wWqBX0FhgQKAzACFQJFAqYC' +
      '9gLcArUChQJbAu0BywG6AtYD8AOPA/YCQQLcAdcBqAHFAbwBzQGOAVQAWACcANgAyQCYAGoASwBeAHkAgwCEAIEAgwCDAKQA1QCCAfcBVwLSAhMDkAIqAu8BbAGyAGYAMgAcAAcA/f/7' +
      '////FwAeACMAJAAlACYAJQAjACAAGAAQAAMA+//3//T/8v/z//j//v8PABsAJAAuADgAbwDUAIYBcAJqA64EygWtBZcEKwTPBGkE+gIyAmsClAKZAuACQQP4AqoCxQKFAhUCigLVA14E' +
      'FgR8A5MCOgIFAu8BLwJAAhsCzgFSAGQAoQCzAI8AYwA5AC4AOgBOAGgAiwCpAIwAbwCJALcA5wCaAU4C+AIdA0QClQEMAbsAZwA+ACkAFAAFAP7//P///wsADAAMABkAJwApACkAJAAc' +
      'ABUADgALAPv/+f/1//P/9//8//7/CAAcACkANgBCAHMAwgBgARAC+gL4A+AERQQ4A/kCGARTBAoDIwKUAugC0gLcAjgDOwMfA3MDCQNJAp8CiAO0A5IDOwOsApACYwIlAmkCiwJ/AjgC' +
      'cQBCAHAAYABBACkAJgAkACgALAA5AF0AhwByAFMAbQCVAMMAOwERAuwCIANrApIBwwBrAEkAIgAYAAsAAAD8//z//v/+//7//v/+/wQAFgAmACIAGwAUABAAAgD8//v/9//2//3//v/2' +
      '//T/HgA7AEgAUgB0AL0ATgH7AS4DIwQwBA4DVAJvAnwD+wPZAtQBPwINA2YDZAOSA6QDXQNzA+wCmALEAmoCVQKOAscCtwKhAlUCJQKAAr0CgQJTAmQARgBAACUAIgAfAB0AGgAdACEA' +
      'KwBQAHIAYAA/AEUAagCfAAYBlwF4AnYC4AFHAZ4AQwAmAAcA/f/8//z//f/9//3//f/9//3//P/9/xQAFgAUABUADgAHAP3//f/8//f/9//+/wEA7f/m/1MAiwBzAGQAdACgACEB0AHd' +
      'As0DRANHAt4BeQJ4A08DVQJ+AcYBmgJKA5UD4AMEBKcDHAOmAmgCUALEAWoBmAHxAeAByQGaAYMBHgI1ArEBkQFDAC0AGwAWACEAFwATABAAEgATADAAUgBYAFUAMwAbAEAAfQDoANkB' +
      'qgKIAq0B0gBvACYAFQDn/+v/8//7/////v/9//v/+v/9//v//P8HAAQACgAMAAgA/f/9//7//v/6//j//v/+//L/dwDoAEYBdAE4AdIAigDQAEoBFwJZAh0CuwECAtcCAgNlAqsBNQGH' +
      'AUQCqwLWArADUgQOBDIDXALsAccBdAEEAfAAHgENAQgBFQEEAWQBdwEmAQkBJAAPAAIAEgAgABYADAAHAAAAEgAyADgAPgBDACYABgAbAHYAxQCrAXoCeAKhAaoAVQAMAP7/4v/i/+3/' +
      '+f///////P/5//j/+f/7//v//P/+/wAA/v////3//P/+//3////8//f/AQBEAMUARwGsAd0BAwJtAdgAqgDNACoBQQF8AasBRwLKAkMChwEaAf4AbQH4ARICegJmA9ADqwMKAx8CfAE1' +
      'AfQAvwCeAIUAnQC/ANMAuwCwANcAuADOABkAAwDx//v/HwAQAAEA/f/6/xIAGAAeACMAKQAYAPz/IABqAIoA2wCNAbgBCQF2ADAA4v/i/+L/5v/x//r///////z/+f/4//r/+//7//v/' +
      '+v/6//v/+v/6//v//v8CAAQA/P/q/+v/TwDTAFYBaAGJAfoBFwJ8Ac8AsQCuAPEALQFlAc4B8AGDAfAAvADEAA4BfQGdARgCmgLrAvECmgLaASsB3gCrAJAAdwBcAFkAggC1AKUAgwBr' +
      'AHkArwAdAA4A8f/5/w4AEAD//wAA/f8RAPv/AAALACUABAD9/yIAOgBGAGwAngCsAJwAVABAADgANwAlAAIA/f/+//7//f/8//v/+v/6//v/+//6//n/+P/4//j/+v/8//3////+//T/' +
      '4v/i/xYAegDvABMBdgEXAkoC9QH3AJgAjQCMAJoAwwDYAPMA3ACNAJAAwwATAUABUQGWAfEBUQKOAjoCjgHiAJkAgACHAIkAagA8AFMAhwCQAGQARgBnAKEAFgAJAPj/+/8NAAkA/v8A' +
      'AO3/4v9AAPn//f8AAP7///8PACIALABZAGUAXwB2AKUApADIAI4AegAxACkAGAD8//r//P/9//3//P/7//v/+//5//j/9//5//v//f/9//v/9f/q/+L/4v8VAEUAhQD7AOgBoQKuAvQB' +
      'DQGAAHoAdgBxAGwAaABqAGMAcgCDALUADwFnAZYBwwEbAnACPAK0AR0BqABxAFcASABmAGEALAAcAFUAdwBEAB4AUQCLABAAAwD9//3/CgAKAAUA/v/7//v/CgD5//v//f8BAAUADgAO' +
      'ABIAMgAyAG0AswAdAcwB3QFdAc0AgQBPADYAGAD6//v//v////3//P/7//v/+v/5//n/+v/9///////5/+7/5P/j//n/AwAnAFwABQHSAUsCMgKEAagAYABaAFMATgBJAEAAQABEAFAA' +
      'cwCwAAwBdAHmASsCewKTAvcBXQH/AL0AYgA2ABMAJQACABQA9/8cAOL/JQAEADIAUwAYAAoA///+//7//v/9//z/+v/6//v//P/+/wMACgAJAP//AAD9/xsAWQCYANYAegFXAqsCQQKn' +
      'Af8AxQBGAAoA9//6//3//v/+//3//P/7//v/+//6//v//P/+//7/+v/x/+z/9f8DAAkA/f9JAJgADAFGATsB2ABxAEEAOgA0AC4AKQAzADkAQABNAKgA5wD5AC0BsAE5AroCpQLPASMB' +
      '7gDxAIsANQAJAPf/+f/9//j/9v/t/xsA8v8LAPn/JwATAAcA/v/8//r/+v/6//v/+//7//z///8JAAwACwD7//b/+/80AE0AagChABcB2AGJApECQQKRAeQATwAWAAAA+f/5/wQA/P/+' +
      '//z/+//7//z//P/6//f/9v/5/wAABAAFAAcA/f/4/+//BAAyAFEAZwBbAFEANQAiAB0AFwAXADQAQgBIAEAASgCpAMoAxwDxAE8B2QFCAkUCgQH3AAMBNQEFAWEAEgDy//v/FgA7ABkA' +
      '5P/i/+T/6f/w/zwAIgAUAP//+//4//n/+v/7//v/+//7////BwAIAP//7v/w////RQCFALMAyQAGAYQBCQI9AiwCrQHhAHIAPQAVAPj////9//v//v/8//v//P/+//7/+f/x/+3/9f8J' +
      'ACQAIgAVAAoA+//8//3/+/8AAAwAGgAcAB0AEAAAAAQAMABAAFAASQA9AEYAbgCKAMIA8AD0AF4BpAHPAWYB6ABVAf8BkQGYABgA8P/6/w8AQQASAOL/4v/i/+b/7/9FADUA5P8KAPn/' +
      '+P/5//n/+f/5//j/+f/+/wYAAwD0/+T/7/8JAGwA9wCVAaABpgESAooCbwIqAsEBEgGmAFoADgD3//X/+v/9//3//P/6//v//v////n/7P/p//r/HAA6ADsAMQAmABkAFQAIAOX/4v/k' +
      '/+r/6f/+/+L/5P8aABcAIAApAC8ALQBaAIYAeACdALUA3ADyADMBoAF7AREBlQF1AtsBrAAJAPn/9P/+/ysA6v/i/+L/4v/i/+z/VwDi//z/+f/+//j/+P/3//b/9v/2//f//f8FAAAA' +
      '7f/i//P/EwB6AAUB3gF+AocCfQLNAvsCzwJMAnIBuwBVAP7/9//4/wAA///9//v/+//8//7////5/+z/7/8KAC4AUABtAGwATgA2AA8A7v/i/+L/4v/i/+L/4v/i/+L/BADz//r/BAAh' +
      'AEEAjQDJAKIAhgC6APYA/QAsAaMBdAH4AFYBDQJ8AZ8ADgD9/+v/9P/w/+T/4v/i/+L/4v/q/28AnQD6//X/BQD5//b/8//z//T/9v/4//7/BAD9/+3/5f/8/yMAWADnANEBvAKyAhwC' +
      'NAIAA2wD0QK6AckAVQAKAPf/+v8DAP7//P/7//z//v////7/+f/z/wEALgBkAMMA/ADnALgATwD2/+L/4v/i/+L/4v/i/+L/4v/i/+L/5v/v/wUALABSAK4ABQHvANIA3wAFAdYAAwFP' +
      'AQcBnwDEAB4B3wB+AB0A6f/m/+v/5//i/+L/4v/i/+L/5/9LAKIANwD2/wEA+P/y/+//8P/0//f/+v/9//7//f/1//b/CAAsAFsAwgCLAUsCNQKJAbABkgJUA9sC1AHyAHQAMAD5//3/' +
      'AwD+//3//P/9//3//P/7//z/BQArAGUA6gCGAcMBUQGaADAA4v/i/+L/4v/i/+L/4v/9/+L/6f/i/+L/5v8BAC0AOwCOAOwA/gC/ALAAlgBwAIQAugC7AHoAZQCGAJAAWQAWAPv/5P/l' +
      '/+L/4v/i/+L/4v/i/+f/KAAHAPv/9//0//b/7//s/+3/8v/2//f/+P/6//3/AQAjADUAQwBQAHgA9ABgAZgBQwGYAUcCuQI3Al0B7ACGACkA+v/6//7//v/+/////P/y/+3/9P8IACsA' +
      'WQCiADAB1AHPARsBWAARAOL/4v/i/+L/4v/i/+L//v8UAOv/5P/i/+L/9/8WACIAeADLANEAjgBbAD4ALAAzAEEAWABDAEwAVgBkAFEAHgDw/+L/4v/i/+L/4v/i/+L/4v/s/wcAEgD7' +
      '//j/9f/1/+7/6//s//D/8//0//L/FwAKACAATAB2AIQAfQBYAIIAowDQABwB1gFoAiECfAEFAeL/YwAWAPv/+P/6//z////9//v/6P/i/+3/GABGAIcAFQFwAYQBFAGTADkA6v/r/+z/' +
      '4//i/+L/5v/s/wIAHgDv/+X/4v/i/+L/5/8CAEsAngClAGsAOgAOAPj/+f8GACkAOwBMAEwAVwBkAFkA5//i/+L/4v/i/+L/4v/i/+L/4v///wcA/v/6//b/9f/u/+z/7v/z//f/+P/0' +
      '//n/IAA8AHgA1ADKAM0AkABSAGEAjQDMAIUBzgF3AeoAjwBjAOL/DgD7//n/+f/6//3//v/+//P/6f/t/ycAYQCyACcBYwEKAY8AUAAiABsAIwAUAPn/4v/i/+v/8v8yABAA9P/l/+L/' +
      '4v/i/+L/6f8rAHQAfgBMABsA8f/i/+L/4v8ZAOL/FwBVAEsAawBrAOT/4v/i/+L/4v/i/+L/4v/s//b/BAD//////v/4//f/8P/x//T/+v/+//7//P///yEAagDKAE0BcgEwAbcAcQBK' +
      'AFQAhgCxAOcArgB8AE0ANwAZAPr//P/8//v/+v/6//7/AwACAPz/9f8wAIMA9gBnAT4BrgB7AFwAUgBVAEcABQDl/+L/4v/m//T/GgDz/+z/4v/i/+L/4v/i/+L/+P9WAFcAJgD+/+L/' +
      '4v/i/+L/4v/i/+L/4v/j/z4AQwDi/+L/4v/i/+L/4v/i/+L/7v8JAAQABAAFAP7/+v/4//T/9v/7//7/AgD///z/FABkALAAEAGyARcCpAEhAakAgQBYAHQAbwBnAEkANwAvABoA/f/5' +
      '//z//v/9//n/+P/6//v/9//x//3/fgDvAJ4BDQKqAZ8AagBXAIEAhQBxADcAGgDi/+L/5f/z/0UAKgDk/+L/4v/i/+L/4v/i/+b/9v8nAPz/7v/i/+L/4v/i/+L/4v8ZAOL/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/m//D/7P/+//v/+v/7//r/+f/5//v///8EAP3/9/8BACsAdgDIADsB3gFaAkoCAQJKAcMAdwBhAGQAMwASAA0ACQAAAPn/+f/8//7//f/5//j/+//z/+L/6P86' +
      'AJoAMwHEARoCgwF8AFEAUwCHALQAngCEAF0ASADt//L/8f/r/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/+//i/+L/4v/i/+L/4v/i/+L/4v/i/+L/6f/8//H/' +
      '9v/p/+n/8v/5//z//f/9//7///8AAAwAIwBDAHgArgD3AGUBOgK/AqUCywESAagAWwA2AAoA9P/s/+7/9P/5//v//P/9//r/+P/8/xAAGgAcADcAVwCvADIBuwG5ARMBWQAwAFMAhwC/' +
      'ANMArwCJAG4APwAlAP//7f/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i//D/AADx/+7/4v/i/+n/9//9/////v/6//v/' +
      'EgAxAE8AYwCRAMMA8gAiAcsBTwJ+AvkBdAH3AHwANwALAOX/4v/l//P//P/9//z/+v/3//b/AQAiAEQAagCcANUA6QBBAX0BRQGuAEEAIgBhAKEA4QD1ANUAtQCvAHUARwAeAPL/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/9//P/7v/r/+L/4//v//j/+//8//v/9//6/xwAPwBeAH0A6AB2AbIBzQEAAhQC' +
      '8wG3AXMBHQGkAEkAGwDq/+L/5//3//3//v/7//b/9P/2/wQAKwBLAMcAXAHGAb4BhQFbAQUBgAA4AB0AOQB5ALYAvACgALIA2QDcAGEAFwD0/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/5v/t/+j//f/+/wQACQD+//b/9P/2//j///8iAEwAawDUAG8BbAL/Ag0DDgPmAmcC9wGhASYBzABoACoAAADn/+3/' +
      '/P8EAAAA+v/0//P/9////yoAfgAuAd4BbQJvAtcBmQEbAYkANQAjACYAUAB5AH0AsQDAAOUA2gBtAA4A8P/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/k/+v/8f/y' +
      '//H/7P/l/+L/4v/i/+L/4v/i/+L/5f/i/ygAKAApACQABgDv/+j/8P/5/wcAMABXALIASQEMAgED1QNiBHUEEwSVAzUDpwIKAiQBqgA/ABAA9P/1////BAACAPr/9f/0//j///8uAJIA' +
      'RAElAuwCDAMjArMBNwGxADQAKQAsADEAcgDJABYBKgHIAJkAcQAFAOb/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i//H/IwBDAFEAVgBUAEAAIQABAOL/4v/i/+L/4v/i' +
      '/+L/4v9zAGoAYABKABwA5//i/+r/+f8QAD8AbgDoAIYBaAJSA0wEOAWlBSoFlwQ2BIkDdAKOAcoAXAAoAP7//v8DAAQA///8//f/9//5//r/EABYAAoBLAJBAzADPAJxASoBugA/ADgA' +
      'QQBKAKQAHAFWATABnQBhADcA/f/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v8sAEsAZAB0AIMAnQBeAEQAHgD2/+L/4v/i/+L/4v/i/+L/EAEAAcYAZQAvAOL/4v/k' +
      '//f/BQBSAIwA/ADXAdUC6wPuBN4FawbCBakEAQRSAzICaAG0AGMALwAHAAcA///9//3//P/5//n/+f/2//v/PgCgAKYBgwKEAuEBMwHxAKMAWgAqAEUAXgCVAOIAIQHQAGgAMQAQAPH/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/iwCmALQA2QBnAYYBOQGcAFoAKwAHAOL/4v/i/+L/4v/i/7sBugErAX8AQgDi/+L/4v/w//f/OwCXACcBFAJaA7UE2QVn' +
      'BpwGugWRBKYDwwLpAS0BmwBaACkAHgAXAP7/9//4//v/+v/6//v/9P/y/yUAcADZAKgB1wFRAfMArgCbAH0AMwAyAEgAXwCXANAArAB3AEQADQDt/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/xEBgAGnAeUBOgIuAsYBCgGzAJIAlABJAPX/7v/i/+L/4v+jAecBLQFzACgA4v/i/+L/5v/n/zEAnwBGAV0CvAMWBT4GiQYyBnsFeASrA6ECpwHzAI8AUQA7' +
      'ADAAGAACAP7//v////7////9//b/7/8EAC0AaADwAGgBLgHmAMsAtgCUAFAAHQAlADMAagCnAM0AtACJAFEALAAjAOL/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v82AcQB' +
      'CwJKAhkCjwE2AQcBxQB6AG0AZAAgAAYA9P/i/+L/UQFsAeAAVQARAOL/4v/i/+L/4v9IALYAXwGoAg4EQQXkBV0FEQW/BEEErAOEAnUB3gCDAFgASAA0AB0AFwAVABMADQAJAAYA/v/5' +
      '//P///8jADoAYQDGAMcArgCmAHYAcgBNABoAHAAkADwAgAC4ALcApACEAGcAVADv/+L/4v/i/+L/4v/i/+L/6P/u/+3/5//i/+L/4v/i/+L/zgAZARsBgwGaAQEBmQCUAJAAYwBLAHIA' +
      'ZABAAAoA4v/i/0AB/ACAADgAAwDi/+L/4v/i/+L/FADHAI4B7QJCBC8FMwVsBPcDqwN2A1ADgQKLAdYAfABfAEwAOAAzAC4AKQAbABIACwAGAP7//P/5//z/DQAhADUAQgBgAGAAVABJ' +
      'AEYAQAAdABwAHgAoADkAagBkAF4AZwBeAFoATwD5/+L/4v/i/+L/4v/k//D/PAAzAPH/4//i/+L/9v/i/z0AcACaAOEALwG9AHEAhgCRAIkAugD8AOcAgwAqAOv/4v8JAbwAWAArAP7/' +
      '4v/i/+L/4v/i/wEAqwCGAQcDUwS1BGEE8QNSA6UCfQKHAgQCaAHVAIwAZgBjAFkASgA+AC8AIQAXAA0A/v/7//r//f/9//j/9P/5/w4APwBAAEAAPQAzACoAMQBAADkALAAsAC8AOwBM' +
      'AF4AOgAvAFoAXADi/+L/4v/i/+L/6P/u/7QAngBnAPz/4v/i/+L/4v8CAEAAbwDCANcAcABcAHUAhwAmAZ8BlwFKAb8AVwAWAOL/3gBvAEIAHgD3/+L/4v/i/+L/4v/o/2kAJQGBAsAD' +
      'yQNaA0kDJQNSAugB5QGdARMBoACBAKMA7QDhAJcAfABwAFIAKwAWAPv/8//3///////4//P/CQBCAF0AXwBcAFsAVwBdAGsAeQBiAEAAQwBRADcARABSABgAAwAvADEA4v/i/+L/4v/i' +
      '/+n/+P+vALgAjgAoAOL/4v/i/+L/9P8UAEoAbACAAC0ARwBjAKMAXAGjAcYBmgEbAbYAaQAiAAgBfAAyAAwA8v/i/+L/4v/i/+L/4v9PAKYAjgFtAoYCNAJaAm0CIAKtAYsBYQHjAKAA' +
      'kwDnAC4BEwHOAKIArQCAAFIAJAD6//H/9v/+/wgACwAcADsAYgC7AM0AxwC3AIwAlAChALMAnwBWAHcAowBnAEAANAD5/+z/7v/s/+L/4v/i/+L/4v/m//X/JQB5ADAA7P/i/+L/4v/i' +
      '/+n//P8TABkAKAAWADMAUwB/ALoAAQE3AYsBcgEKAcEAlABSAb4APAASAPD/4//i/+L/4v/i/+L/BABTALIATgFaAUwBSQFRAWYBLQElASMB/ADaANIAEQFeAT0BHgHFAKwAfwBRACgA' +
      'CAD5//n//v8MAB8AOABTALEAHQE7AS8BDwHWAMgA3QDyAPAAgwD1AC0B/ACpAA4A5f/i/+P/6f/i/+L/4v/i/+L/4v/u//b/+f/0/+v/4v/i/+L/4v/i//z/9P/5//n/+/9JAFwAdgCY' +
      'AMMADQFQATsB7gAHAQMBpQH6AFUAEwDv/+P/4v/i/+L/4v/i/+X/FQBiALQAwgDFAMEApwCvALoA1AANAScBMwFWAYUBygGSAXIBCwG0AI8AcQBVACwAEgABAAYAGQAsAD8AWQCPABkB' +
      'XwFrAVIBJwEhAVUBcgEfAagAGQF8AUkB3ABsAOL/4v/i/+T/4v/i/+L/4v/i/+L/5v/s/+//7v/n/+L/4v/i/+L/4v/i/+b/6v/s//D/+f9WAIMAygACASUB/ADGAKMA8wAxAYcB9wBT' +
      'ABMA7v/i/+L/4v/i/+L/4v/i/+L/CABTAFgAYgCsAJMAlADGAAoBhQHSAdIBGgJ8Ar4CWgLjAW0BLQEbAbsAfwBQAC8AEgAVACUAOABLAGAAigDnABkBOAFfAU8BOgFeAWgB6ACPAOgA' +
      'MwFCAeUAiADi/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/l/+X/4v/i/+L/4v/i/+L/4v/i/+L/4v/n/+///f9UAKIA1gDwALMAigB7AJcAhwA9AcUAUQASAOz/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/BABdALsAGgEZAfEA/wA/AS8CowKLAtECoQMIBJADxgIkAtsBsgFTAd8AcgA8ACMAJgA0AEQAVwB7AM4ANAFTAUsBLwEZAf8A4gDIAJwArQClAMAA5QDXABAA4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/p//P/PwBaAG8A+wDkAKEAdABLAEAA6AClAFIAEgDp/+L/4v/i/+L/4v/i/+L/4v/i/xgAgADlAFsBrgGQAUABbwE5' +
      'AvICPQNXAxIEnwRqBIkD4QLVAnQCkAECAZgATwA1ADcARQBTAGQAuABPAQACRAL3AZMBUgEYAcEAswDRAO8AygCxAJ8AfQBOAOb/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/5v/s//P/+/9fANEA5gBXAI0AJQD4/5cAbgA6AAMA5v/i/+L/4v/i/+L/4v/i/+L/4v8PAJkAFAGeASgCGQKkAXEB1gGYAmgDrAMaBK4EiwTCA7IDAARM' +
      'AyQCVQHMAKgAgwBIAFYAZACNABEBqwFwAvgCmAIfAvsBvQEgAS0BlwG5AQYBdgA7ACYADwDp/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '5P/n/+f/5//i/+L/fgCoAOL/4v9lAEkAHgD5/+T/4v/i/+L/4v/i/+L/4v/i/+L/BwCuADcBvwFFAngCswEqAZUBKQIYA8wDDwSSBJsEXQQgBC4E5wO7AsMBIQEDAeMAegBmAIgADgHc' +
      'AXIC/wJDAwgDsAKIAvsBLAFSASECPgJ0AbMATQAoAPv/6f/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      'NwAbAP//7//i/+L/4v/i/+L/4v/i/+L/4v/i/wMAXQCDAPcAfQHXAXQB9wBuARgCxgIaA2YDEgR3BGMEAwRfAx0DYQK6AYQBXQH1AJYAlgADAe4BygJ3AwcEFgS/A1ADoQK4ASQBdQET' +
      'AmwC4AHVAFYAIQD5/+f/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/wsA9//s/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4/8CADsARQBfAJsAxAC9ANAAbAEFAiACOAJ6AggDXQO2A3wDdAL3AWQBFQFDATcBzwCWAPEAtQF+AloDFwSoBM8ESwRzA2oCfAFgATICogI9AoUBwgBLACEA9//j/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/8/+P/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+f//P8YACIALAA8AFcA' +
      'dACQAB0BeAFeAV4BegGxAfUBQQJIAnYB6wCvAI0AhwCfAHIAhwAUAdgBkAIWA5AD6wM9BAoENgM2AmEBkAF3AnwC2gEtAZAASwAhAPf/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/AQDi/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/j//j/DQAcACwAOgA+AEYAXwCeALwAsgCyAMoA6QAbARsB' +
      '/QCvAGoAPQAvADcAQgBEAG0AzQA9AawBBQJnAsoCMQNRA6oCzgE7AWcB4gGZASkBywBvAE0AIQD3/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/xcA5v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/1/xsAPABMAFMAWQBpAHsArACjAJoAiwB+AHsAogC8AIoAVQA3ABwAGAAgACoAdQDmAC4B' +
      'mwHzAQECGQJlAvkCUwOXApgBPAFqAbsBYwEwAecApgBVACIA+P/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v8tAPL/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/9/8uAFIAfgDOAN8AywDcAC8BIQH1AMkAlwA4AEkA4v/o/wYABAABAAEAHABMAMcAgAExArQCFwMTAwgDPQPSA+8D5gLDAW0B' +
      'rgH9AeIBKQLoAU4BuAA9APn/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/PAD5/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i//z/SQCEAOIAjAGIAUsBVQGnAaoBiAFWAdcASgASAOT/4v/i/+L/4v/9/0IAdAAQAbIBcQJMAwQETAQjBCEEoQRRBBMD8AGuAfoBPwLEAhcDiAK5AcsATAD5/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/yoA/f/s/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v8DAGAAkgAL' +
      'Af4BLwL0AQ8CRwInAt0BaAHkAFYA4v///+f/4v/i/+L//v9IAKUAWQEEAsUCogOGBCAFEgXZBC8FuQRkAygC3wEOAmcCIQNxA68CpwG3AE0A+P/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v8KAPv/8//s/+X/4v/i/+L/4v/i/+L/4v/i/+L/AgBeAIgA9ADBAR4CPQJaApACVQL1AXgBLgHr' +
      'AHwAWwBAAOj/4v/i/yUAaADpAMEBdQI0A9ADvgSRBZgFYgVjBccEmQNwAgACIgKgAm0DgwOiApkBogBGAPb/AwAWAOL/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L//f/6//X/7//p/+L/4v/i/+L/4v/i/+L/4v/i//b/PwBKAJEAEwFRAYgBpgHUAdIB9wHgAcABXAHmAIwAaQDi/+L/6v8iAHMAIQEd' +
      'Aq8CxQJTA1cEEQXVBLMEoARUBJ8DxAJGAk0CuwIhA+0CMgJkAaQANwDy//P/AgDi/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i/+L/4v/i/wIACgD6/+X/4v/i/+L/4v/i/+L/4v/i/+L/4v/v/xUAKQBjAJcArgDNAOgAGgFmAeQB4QHYAZcBMwHJAIAA4v/i//z/OAB8ACoB6gEiAhICowJMA7IDYQOCA2oDeANZ' +
      'AwQDpQK/AvkCigLzAV4BzAB4ACUA7v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v8eABIA5P/i/+L/' +
      '4v/j/+L/4v/i/+L/4v/i/+L/4//r////KwBbAIsA2QATAWUByQEzAjYCMAL5AXMBzQB0AOL/4v8BADUAcwDPAEsBQQFNAbwBMwI0Ah0CTwI5AmICmgJrAnAC8wIhA4UCoAHZAI0APQD9' +
      '/wcA4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/IgAFAOL/4v/i/+L/5//i/+L/4v/i/+L/4v/i/+L/' +
      '4v/i//v/NACOADcB0wFJAq0CzwLNAt0C0QIEAtsAGwDi/+L//v8mAGQArQDJANYALQGeAb8BZQFRAWIBYQGyAe0BvwH7AYoCiQLvAQQBjQBIAAAA6v/q/+P/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/yIA/P/i/+P/6//u/+r/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/yoAXADWALQBbQL6AgAD' +
      'uQKlAqcClwGhABEA4v/i//3/IwBUAIEAoADnAGgB9AGVAQ0B5AD9ABIBUwFIAS0BcgHQAXkB8gCGAEYABwDj/+L/4v/k/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v99AAsAAQATAAoA/P/t/+P/4v/i/+L/4v/i/+L/4v/i/+L/4v/y/yQAXgDMAEsB2gEbAsoBiAFuAcsAXAD5/+L/5f8QAFAA' +
      'QQBeAIMAAwFpAbYBRQHGAJkApQAyAZ0BSQHjAA0BDwG+AHIAWAAyAPL/4v/i/+L/5P/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i/+L/4v/i' +
      '/+L/4v/i/+L/4v/i/+L/',
  },
};

/** Whether a point is inside an outline (even-odd). */
function inside(poly: Vec2[], x: number, z: number) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, zi] = poly[i]!, [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
}

/** The ground of a fixture site in its frame: its grid's drawn heights, every pad flat at h0 inside its outline. */
export function fixtureGround(id: FixtureId): Ground {
  const { x0, z0, step, nx, nz, heights } = GRID[id];
  const bytes = Uint8Array.from(atob(heights), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const at = (i: number, j: number) => view.getInt16((j * nx + i) * 2, true) / 100;
  const terrain = (x: number, z: number) => {
    const gx = Math.min(nx - 1, Math.max(0, (x - x0) / step)), gz = Math.min(nz - 1, Math.max(0, (z - z0) / step));
    const i = Math.min(nx - 2, Math.floor(gx)), j = Math.min(nz - 2, Math.floor(gz)), fx = gx - i, fz = gz - j;
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * fx, bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return top + (bottom - top) * fz;
  };
  const pads = FIXTURES[id].pads;
  const pad = (x: number, z: number) => pads.find((p) => inside(p.poly, x, z));
  return {
    height: (x, z) => pad(x, z)?.h0 ?? Math.max(0, terrain(x, z)),
    water: (x, z) => !pad(x, z) && terrain(x, z) <= 0,
  };
}
