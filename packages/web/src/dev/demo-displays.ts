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
    id: 'weather',
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
    row_icons: ['cloud-sun', 'cloud-rain', 'sun', 'cloud', 'cloud-rain'],
    icon_column: 1,
    scene: { kind: 'weather', sky: 'partly-cloudy', intensity: 0.5, day: true, wind: 0.3 },
  },
  // Same id: the panel stays and its content changes, as when asking about another place.
  {
    id: 'weather',
    component: 'table',
    title: 'Aarhus · next seven days',
    columns: ['Day', 'Sky', 'High', 'Low', 'Rain'],
    rows: [
      ['Mon', 'Overcast', '12°', '7°', '30%'],
      ['Tue', 'Rain', '11°', '6°', '90%'],
      ['Wed', 'Showers', '12°', '6°', '60%'],
      ['Thu', 'Partly cloudy', '13°', '5°', '20%'],
      ['Fri', 'Clear', '14°', '4°', '0%'],
      ['Sat', 'Mostly clear', '13°', '5°', '10%'],
      ['Sun', 'Light rain', '11°', '6°', '50%'],
    ],
    scene: { kind: 'weather', sky: 'rain', intensity: 0.8, day: false, wind: 0.4 },
  },
  {
    id: 'weather',
    component: 'table',
    title: 'Tromsø · next three days',
    columns: ['Day', 'Sky', 'High', 'Low', 'Snow'],
    rows: [
      ['Mon', 'Snow', '-2°', '-7°', '80%'],
      ['Tue', 'Heavy snow', '-4°', '-9°', '95%'],
      ['Wed', 'Overcast', '-3°', '-8°', '30%'],
    ],
    scene: { kind: 'weather', sky: 'snow', intensity: 0.7, day: true, wind: 0.2 },
  },
  {
    id: 'weather',
    component: 'table',
    title: 'Brisbane · tonight',
    columns: ['Time', 'Sky', 'Temp', 'Rain'],
    rows: [
      ['9 pm', 'Thunderstorm', '24°', '90%'],
      ['10 pm', 'Thunderstorm', '23°', '85%'],
      ['11 pm', 'Showers', '22°', '60%'],
    ],
    scene: { kind: 'weather', sky: 'thunder', intensity: 0.9, day: false, wind: 0.6 },
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
