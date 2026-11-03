// Shared state metadata. close = approximate latest statewide poll close, ET (24h "HH:MM", Nov 3 unless +1 = Nov 4).
export const STATES = {
  AL:['Alabama','01','20:00'],AK:['Alaska','02','01:00+1'],AZ:['Arizona','04','22:00'],AR:['Arkansas','05','20:30'],
  CA:['California','06','23:00'],CO:['Colorado','08','21:00'],CT:['Connecticut','09','20:00'],DE:['Delaware','10','20:00'],
  DC:['District of Columbia','11','20:00'],FL:['Florida','12','20:00'],GA:['Georgia','13','19:00'],HI:['Hawaii','15','00:00+1'],
  ID:['Idaho','16','23:00'],IL:['Illinois','17','20:00'],IN:['Indiana','18','19:00'],IA:['Iowa','19','22:00'],
  KS:['Kansas','20','21:00'],KY:['Kentucky','21','19:00'],LA:['Louisiana','22','21:00'],ME:['Maine','23','20:00'],
  MD:['Maryland','24','20:00'],MA:['Massachusetts','25','20:00'],MI:['Michigan','26','21:00'],MN:['Minnesota','27','21:00'],
  MS:['Mississippi','28','20:00'],MO:['Missouri','29','20:00'],MT:['Montana','30','22:00'],NE:['Nebraska','31','21:00'],
  NV:['Nevada','32','22:00'],NH:['New Hampshire','33','20:00'],NJ:['New Jersey','34','20:00'],NM:['New Mexico','35','21:00'],
  NY:['New York','36','21:00'],NC:['North Carolina','37','19:30'],ND:['North Dakota','38','21:00'],OH:['Ohio','39','19:30'],
  OK:['Oklahoma','40','20:00'],OR:['Oregon','41','23:00'],PA:['Pennsylvania','42','20:00'],RI:['Rhode Island','44','21:00'],
  SC:['South Carolina','45','19:00'],SD:['South Dakota','46','22:00'],TN:['Tennessee','47','21:00'],TX:['Texas','48','22:00'],
  UT:['Utah','49','22:00'],VT:['Vermont','50','19:00'],VA:['Virginia','51','19:00'],WA:['Washington','53','23:00'],
  WV:['West Virginia','54','19:30'],WI:['Wisconsin','55','21:00'],WY:['Wyoming','56','21:00'],
};
export const NAME_TO_ST = Object.fromEntries(Object.entries(STATES).map(([k, v]) => [v[0].toLowerCase(), k]));
// 2026 elections are Tuesday Nov 3, 2026; ET is UTC-5 on that date.
export function closeTime(st) {
  const [h, m] = STATES[st][2].split('+')[0].split(':').map(Number);
  const nextDay = STATES[st][2].includes('+1');
  return Date.UTC(2026, 10, 3 + (nextDay ? 1 : 0), h + 5, m);
}
