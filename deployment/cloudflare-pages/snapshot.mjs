import {RANKS,validDate,validTriple,sourceUrl} from '../../lib/border-source.mjs';
const statuses=new Set(['pending','ok','partial','unavailable']);
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
export function validateSnapshot(packet) {
  if(!packet||!Array.isArray(packet.records)||!validDate(packet.serverDate)||!packet.sync||!statuses.has(packet.sync.status))throw new Error('Invalid shared border snapshot');
  const keys=new Set();
  for(const row of packet.records) {
    const key=row.date+'|'+row.close;
    if(!validDate(row.date)||row.date>=packet.serverDate||!['13','22','24'].includes(row.close)||keys.has(key)||!sourceUrl(row.sourceURL)||!row.ranks||Object.keys(row.ranks).length!==18||RANKS.some(rank=>!validTriple(row.ranks[rank]))||typeof row.checkedAt!=='string'||!Number.isFinite(Date.parse(row.checkedAt)))throw new Error('Invalid shared border row');
    keys.add(key);
  }
  for(const field of ['last_attempt','last_success'])if(packet.sync[field]!==''&&(typeof packet.sync[field]!=='string'||!Number.isFinite(Date.parse(packet.sync[field]))))throw new Error('Invalid sync timestamp');
  if(typeof packet.sync.message!=='string')throw new Error('Invalid sync message');
  return packet;
}
export function snapshotSQL(packet) {
  validateSnapshot(packet);
  const statements=packet.records.map(row=>'INSERT INTO border_days (id,date,close_time,ranks_json,source_url,checked_at) VALUES ('+[row.date+'|'+row.close,row.date,row.close,JSON.stringify(row.ranks),row.sourceURL,row.checkedAt].map(quote).join(',')+');');
  const s=packet.sync;
  statements.push('INSERT INTO border_sync (id,last_attempt,last_success,status,message,lock_until) VALUES ('+['daily',s.last_attempt,s.last_success,s.status,s.message].map(quote).join(',')+',0);');
  return statements.join('\n')+'\n';
}
