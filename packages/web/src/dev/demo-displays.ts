import type { DisplayArgs } from '@ephemeralos/shared';

/** One of each component, shown in turn by the D key so layouts can be checked by eye. */
export const DEMO_DISPLAYS: DisplayArgs[] = [
  {
    component: 'list',
    title: 'A quiet weekend in Copenhagen',
    items: [
      { label: 'Hotel Sanders', detail: 'Kongens Nytorv · from 3,200 kr' },
      { label: 'Hotel Alexandra', detail: 'H.C. Andersens Boulevard · from 2,900 kr' },
      { label: 'Villa Copenhagen', detail: 'Vesterbro · from 2,450 kr' },
    ],
  },
  {
    component: 'card',
    title: 'Cardamom buns',
    body: 'Soft, fragrant and **best on the day**.\n\n- Warm the milk to body heat\n- Knead for *ten minutes*\n- Prove until doubled, about an hour',
  },
  {
    component: 'table',
    title: 'Copenhagen · next five days',
    columns: ['Day', 'Sky', 'High', 'Low', 'Rain'],
    rows: [
      ['Mon', 'Partly cloudy', '14°', '8°', '10%'],
      ['Tue', 'Light rain', '12°', '7°', '70%'],
      ['Wed', 'Clear', '15°', '6°', '0%'],
      ['Thu', 'Overcast', '13°', '9°', '20%'],
      ['Fri', 'Showers', '11°', '7°', '60%'],
    ],
  },
  {
    component: 'chart',
    title: 'Temperature this week',
    chart: {
      kind: 'line',
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      series: [
        { name: 'High', values: [14, 12, 15, 13, 11, 12, 16] },
        { name: 'Low', values: [8, 7, 6, 9, 7, 6, 9] },
      ],
      unit: '°C',
    },
  },
];
