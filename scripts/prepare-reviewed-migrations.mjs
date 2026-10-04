import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function reviewedMigrationNames(names) {
  const result = names.filter((name) => {
    const match=/^(\d{3})_.*\.sql$/.exec(name);
    if(!match)return false;
    const n=Number(match[1]);return n>=3 && n<=30 || n===33 || n===34;
  }).sort();
  if(result.length!==31 || result[0]!=='003_live_release_authorizations.sql'
    || result.at(-1)!=='034_live_partial_fill_reservation_release.sql') throw new Error('REVIEWED_MIGRATION_SET_INCOMPLETE');
  return result;
}
export function reviewedMigrationFiles(names) {
  return reviewedMigrationNames(names).map((name,index)=>({source:name,
    target:`${String(index+1).padStart(4,'0')}_${name}`}));
}
// D1's remote multi-statement parser treats the CASE expression's END; as a
// trigger terminator. Keep the same conditional RAISE guard without an inner
// END token. Original migrations remain unchanged for existing installations.
export function renderReviewedMigration(sql) {
  return sql.replace(
    /SELECT CASE WHEN (NOT EXISTS \([^;]*?\))\s+THEN RAISE\(ABORT,\s*('(?:[^']|'')*')\)\s+END;/g,
    (_match,condition,message)=>`SELECT RAISE(ABORT, ${message}) WHERE ${condition};`,
  );
}
export async function prepareReviewedMigrations(root=fileURLToPath(new URL('../',import.meta.url))) {
  const source=path.join(root,'worker','migrations');
  const destination=path.join(root,'worker','.wrangler','reviewed-migrations');
  const files=reviewedMigrationFiles(await fs.readdir(source));
  const names=files.map((file)=>file.target);
  await fs.mkdir(destination,{recursive:true});
  const existing=await fs.readdir(destination);
  if(existing.some((name)=>!names.includes(name))) throw new Error('REVIEWED_MIGRATION_DIRECTORY_CONTAMINATED');
  for(const file of files) {
    const sql=await fs.readFile(path.join(source,file.source),'utf8');
    await fs.writeFile(path.join(destination,file.target),renderReviewedMigration(sql),'utf8');
  }
  return {directory:destination,migrationCount:names.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(await prepareReviewedMigrations()));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
