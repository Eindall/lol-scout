// platform : endpoints league-v4
// routing  : endpoints match-v5
// account  : endpoints account-v1 (pas de "sea" pour account-v1)
export const REGIONS = {
  euw: { label: 'EUW', platform: 'euw1', routing: 'europe', account: 'europe' },
  eune: { label: 'EUNE', platform: 'eun1', routing: 'europe', account: 'europe' },
  tr: { label: 'TR', platform: 'tr1', routing: 'europe', account: 'europe' },
  ru: { label: 'RU', platform: 'ru', routing: 'europe', account: 'europe' },
  me: { label: 'ME', platform: 'me1', routing: 'europe', account: 'europe' },
  na: { label: 'NA', platform: 'na1', routing: 'americas', account: 'americas' },
  br: { label: 'BR', platform: 'br1', routing: 'americas', account: 'americas' },
  lan: { label: 'LAN', platform: 'la1', routing: 'americas', account: 'americas' },
  las: { label: 'LAS', platform: 'la2', routing: 'americas', account: 'americas' },
  kr: { label: 'KR', platform: 'kr', routing: 'asia', account: 'asia' },
  jp: { label: 'JP', platform: 'jp1', routing: 'asia', account: 'asia' },
  oce: { label: 'OCE', platform: 'oc1', routing: 'sea', account: 'asia' },
  sg: { label: 'SG', platform: 'sg2', routing: 'sea', account: 'asia' },
  tw: { label: 'TW', platform: 'tw2', routing: 'sea', account: 'asia' },
  vn: { label: 'VN', platform: 'vn2', routing: 'sea', account: 'asia' },
};
