// Calendar days in the user's timezone, including catch-up after a restart.
export const BACKUP_TIMEZONE = 'America/Argentina/Buenos_Aires';
export function backupDate(now:number) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:BACKUP_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=(name:string)=>parts.find(p=>p.type===name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function backupTime(day:string,clock:string) { return Date.parse(`${day}T${clock}:00-03:00`); }
export function firstBackupAt(now:number,clock:string) {
  const today=backupTime(backupDate(now),clock);
  return today>now?today:today+86400000;
}
export function followingBackupAt(due:number,now:number,intervalDays:number) {
  const interval=intervalDays*86400000;
  return due+(Math.floor(Math.max(0,now-due)/interval)+1)*interval;
}
