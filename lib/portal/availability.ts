export function isWithinBusinessHours(date = new Date()): boolean {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const currentMinute = hours * 60 + minutes;
  const startMinute = 9 * 60;
  const endMinute = 18 * 60;
  return currentMinute >= startMinute && currentMinute <= endMinute;
}
