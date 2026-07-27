import { resolveRelativeDate } from './src/lib/server/datetime';
const ref = new Date();
const res = resolveRelativeDate(ref, 'Tuesday', null, 14, 0);
console.log(res.formattedExplicitText);
console.log(res.resolvedDate.toISOString());
